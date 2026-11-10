// Realtime collaboration contract shared by client and server. The WebSocket
// layer carries presence (who is here, their cursors and selections) and
// server-authoritative schema mutations (broadcast after each REST write so
// every participant converges without polling). Keep this environment-agnostic:
// no socket.io, Angular, or Nest imports here, only the shapes on the wire.

import type { AccessLevel } from '../enums';
import type { SlideTheme } from '../slides/themes';
import type {
  CanvasElementModel,
  ColumnModel,
  IndexModel,
  LifelineModel,
  PointModel,
  RelationshipModel,
  SequenceDiagramModel,
  SequenceMessageModel,
  TableModel,
  ViewportModel,
} from '../models';

/** Socket.io namespace the realtime gateway is mounted on. */
export const REALTIME_NAMESPACE = '/realtime';

/** Event names on the wire. Both sides import these so they never drift. */
export const RT_EVENTS = {
  // server -> clients
  roster: 'presence:roster',
  cursor: 'presence:cursor',
  selection: 'presence:selection',
  laser: 'presence:laser',
  present: 'presence:present',
  mutation: 'project:mutation',
  /** Several changes from one request (batch, import, clone), applied as one update. */
  mutations: 'project:mutations',
  /** Sent once per connection: the server-assigned client id for this socket (L-1). */
  session: 'session',
  // clients -> server (cursor/selection/laser are reused by name)
} as const;

/** A connected collaborator as seen by everyone in the project room. */
export interface Participant {
  /** Stable per-connection id assigned by the server. */
  id: string;
  /** Display name: the account name, or an auto-assigned "Guest N". */
  name: string;
  /** Hex color assigned by the server, used for cursor and selection tint. */
  color: string;
  accessLevel: AccessLevel;
  isOwner: boolean;
  /** Set while this participant is presenting: which slide (frame) and build step. */
  presenting?: { frameId: string; step: number } | null;
}

/** A participant's live cursor position, in canvas world coordinates. */
export interface PresenceCursor {
  participantId: string;
  x: number;
  y: number;
}

/**
 * One sample of a participant's laser pointer, in canvas world coordinates.
 * Purely ephemeral (never persisted). `end` marks the pointer being released so
 * peers can start fading that participant's trail.
 */
export interface PresenceLaser {
  participantId: string;
  x: number;
  y: number;
  end?: boolean;
}

/** What a participant currently has selected, for colored highlights. */
export interface PresenceSelection {
  participantId: string;
  tableIds: string[];
  relationshipIds: string[];
  columnId?: string;
}

/**
 * A single broadcastable schema change. The payload of each variant matches the
 * shape the corresponding REST endpoint returns, so peers apply it directly to
 * their store. The tab that made the change does not receive it: the server skips
 * the socket whose server-assigned client id came with the write (X-Client-Id).
 */
export type SchemaMutation =
  | { kind: 'table.created'; table: TableModel }
  | { kind: 'table.updated'; table: TableModel }
  | { kind: 'table.moved'; tableId: string; x: number; y: number }
  | { kind: 'table.deleted'; tableId: string }
  | { kind: 'column.created'; tableId: string; column: ColumnModel }
  | { kind: 'column.updated'; tableId: string; column: ColumnModel }
  | { kind: 'column.deleted'; tableId: string; columnId: string }
  | { kind: 'column.reordered'; tableId: string; orderedColumnIds: string[] }
  | { kind: 'index.created'; tableId: string; index: IndexModel }
  | { kind: 'index.updated'; tableId: string; index: IndexModel }
  | { kind: 'index.deleted'; tableId: string; indexId: string }
  | { kind: 'index.reordered'; tableId: string; orderedIndexIds: string[] }
  | { kind: 'relationship.created'; relationship: RelationshipModel }
  | { kind: 'relationship.updated'; relationship: RelationshipModel }
  | { kind: 'relationship.deleted'; relationshipId: string }
  | { kind: 'element.created'; element: CanvasElementModel }
  | { kind: 'element.updated'; element: CanvasElementModel }
  | { kind: 'element.moved'; elementId: string; x?: number; y?: number; points?: PointModel[] }
  | { kind: 'element.deleted'; elementId: string }
  | { kind: 'element.reordered'; orderedElementIds: string[] }
  | { kind: 'sequenceDiagram.created'; diagram: SequenceDiagramModel }
  | { kind: 'sequenceDiagram.updated'; diagram: SequenceDiagramModel }
  | { kind: 'sequenceDiagram.deleted'; diagramId: string }
  | { kind: 'lifeline.created'; lifeline: LifelineModel }
  | { kind: 'lifeline.updated'; lifeline: LifelineModel }
  | { kind: 'lifeline.moved'; lifelineId: string; x: number }
  | { kind: 'lifeline.deleted'; lifelineId: string }
  | { kind: 'message.created'; message: SequenceMessageModel }
  | { kind: 'message.updated'; message: SequenceMessageModel }
  | { kind: 'message.moved'; messageId: string; y: number }
  | { kind: 'message.deleted'; messageId: string }
  | { kind: 'home.updated'; home: ViewportModel | null }
  | { kind: 'themes.updated'; themes: SlideTheme[] };

/**
 * Partial-update mutations (perf P3.1). `patch` holds only the model fields that
 * changed, in the shape of the matching model; `unset` lists optional model fields
 * that are now absent. Apply as `{ ...model, ...patch }` minus the `unset` keys.
 * Creates keep the full-model kinds.
 *
 * Kept OUT of {@link SchemaMutation} on purpose: clients that do not handle them yet
 * must keep type-checking. The server only emits them when REALTIME_PATCH_MUTATIONS
 * is on; until then every partial update is still broadcast as a full `*.updated`.
 * Once every client's applyRemote merges these, fold them into SchemaMutation.
 */
export interface ModelPatch<T> {
  patch: Partial<T>;
  unset?: Array<keyof T & string>;
}

export type SchemaPatchMutation =
  | ({ kind: 'table.patched'; tableId: string } & ModelPatch<Omit<TableModel, 'id' | 'columns' | 'indexes'>>)
  | ({ kind: 'column.patched'; tableId: string; columnId: string } & ModelPatch<Omit<ColumnModel, 'id'>>)
  | ({ kind: 'index.patched'; tableId: string; indexId: string } & ModelPatch<Omit<IndexModel, 'id'>>)
  | ({ kind: 'relationship.patched'; relationshipId: string } & ModelPatch<Omit<RelationshipModel, 'id'>>)
  | ({ kind: 'element.patched'; elementId: string } & ModelPatch<Omit<CanvasElementModel, 'id'>>)
  | ({ kind: 'sequenceDiagram.patched'; diagramId: string } & ModelPatch<Omit<SequenceDiagramModel, 'id'>>)
  | ({ kind: 'lifeline.patched'; lifelineId: string } & ModelPatch<Omit<LifelineModel, 'id'>>)
  | ({ kind: 'message.patched'; messageId: string } & ModelPatch<Omit<SequenceMessageModel, 'id'>>);

/** Everything the server may broadcast: full mutations plus (when enabled) patches. */
export type RealtimeMutation = SchemaMutation | SchemaPatchMutation;

/** Fields of a model whose values differ (by JSON value), as a {@link ModelPatch} (never the id). */
export function diffModel<T extends object>(before: T, after: T): ModelPatch<Omit<T, 'id'>> | null {
  const patch: Partial<T> = {};
  const unset: Array<keyof T & string> = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]) as Set<keyof T & string>;
  for (const key of keys) {
    if (key === ('id' as keyof T)) continue;
    const a = before[key];
    const b = after[key];
    if (b === undefined) {
      if (a !== undefined) unset.push(key);
    } else if (a === undefined || JSON.stringify(a) !== JSON.stringify(b)) {
      patch[key] = b;
    }
  }
  if (!unset.length && !Object.keys(patch).length) return null;
  const change = (unset.length ? { patch, unset } : { patch }) as unknown as ModelPatch<Omit<T, 'id'>>;
  return change;
}

/** Apply a {@link ModelPatch} to a model (pure). */
export function applyModelPatch<T extends object>(model: T, change: ModelPatch<Partial<T>>): T {
  const next = { ...model, ...change.patch } as T;
  for (const key of change.unset ?? []) delete (next as Record<string, unknown>)[key];
  return next;
}

/** Envelope broadcast to a project room for every persisted schema change. */
export interface MutationEvent {
  projectId: string;
  /** The writer's X-Client-Id on the server bus; always null on the wire. */
  originClientId: string | null;
  mutation: SchemaMutation;
}

/** Envelope for many changes persisted by one request, broadcast as ONE socket message. */
export interface MutationBatchEvent {
  projectId: string;
  /** The writer's X-Client-Id on the server bus; always null on the wire. */
  originClientId: string | null;
  mutations: SchemaMutation[];
}

/** Internal event name emitted on the server's EventEmitter2 bus. */
export const PROJECT_MUTATION_EVENT = 'project.mutation';
/** Internal bus event carrying a MutationBatchEvent. */
export const PROJECT_MUTATIONS_EVENT = 'project.mutations';

/**
 * Sent by the server right after a socket joins. The client sends `clientId` as
 * X-Client-Id on its writes so their broadcasts skip this socket. It is minted
 * by the server and only honored for the principal that opened the socket.
 */
export interface RealtimeSession {
  clientId: string;
}

/** Handshake auth payload the client sends when opening the socket. */
export interface RealtimeHandshakeAuth {
  projectId: string;
  /** Present only in shared (anonymous link) mode. */
  token?: string;
  /** This browser's guest id (localStorage), scoping account-free projects. */
  guestId?: string;
}
