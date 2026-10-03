// Realtime collaboration contract shared by client and server. The WebSocket
// layer carries presence (who is here, their cursors and selections) and
// server-authoritative schema mutations (broadcast after each REST write so
// every participant converges without polling). Keep this environment-agnostic:
// no socket.io, Angular, or Nest imports here, only the shapes on the wire.

import type { AccessLevel } from '../enums';
import type {
  CanvasElementModel,
  ColumnModel,
  IndexModel,
  PointModel,
  RelationshipModel,
  TableModel,
} from '../models';

/** Socket.io namespace the realtime gateway is mounted on. */
export const REALTIME_NAMESPACE = '/realtime';

/** Event names on the wire. Both sides import these so they never drift. */
export const RT_EVENTS = {
  // server -> clients
  roster: 'presence:roster',
  cursor: 'presence:cursor',
  selection: 'presence:selection',
  mutation: 'project:mutation',
  // clients -> server (cursor/selection are reused by name)
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
}

/** A participant's live cursor position, in canvas world coordinates. */
export interface PresenceCursor {
  participantId: string;
  x: number;
  y: number;
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
 * their store. `originClientId` is the X-Client-Id of the tab that made the
 * change, so that tab can ignore its own echo (it already applied it optimistically).
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
  | { kind: 'element.reordered'; orderedElementIds: string[] };

/** Envelope broadcast to a project room for every persisted schema change. */
export interface MutationEvent {
  projectId: string;
  originClientId: string | null;
  mutation: SchemaMutation;
}

/** Internal event name emitted on the server's EventEmitter2 bus. */
export const PROJECT_MUTATION_EVENT = 'project.mutation';

/** Handshake auth payload the client sends when opening the socket. */
export interface RealtimeHandshakeAuth {
  projectId: string;
  /** Present only in shared (anonymous link) mode. */
  token?: string;
  /** The tab's X-Client-Id, so its own broadcasts can be self-filtered. */
  clientId: string;
}
