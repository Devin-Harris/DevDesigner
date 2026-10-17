import { Injectable, computed, inject, signal } from '@angular/core';
import { io, type Socket } from 'socket.io-client';
import {
  REALTIME_NAMESPACE,
  RT_EVENTS,
  type MutationEvent,
  type Participant,
  type PresenceCursor,
  type PresenceLaser,
  type PresenceSelection,
  type RealtimeHandshakeAuth,
} from '@dbdesigner/shared';
import { environment } from '../../../environments/environment';
import { ProjectStore } from '../../stores/project.store';
import { LaserService } from './laser.service';
import { ShareSessionService } from './share-session.service';

/** A remote participant's cursor tagged with their roster color and name. */
export interface RemoteCursor extends PresenceCursor {
  name: string;
  color: string;
}

/**
 * Realtime collaboration client (see the plan Part 2). Opens one socket.io
 * connection per open project, mirrors presence (roster, cursors, selections)
 * into signals for the editor to render, and applies server-authoritative schema
 * mutations to the ProjectStore. The socket carries the session cookie (owner) or
 * the share token (guest) so the server authorizes it exactly like a REST call.
 */
@Injectable({ providedIn: 'root' })
export class RealtimeService {
  private readonly store = inject(ProjectStore);
  private readonly session = inject(ShareSessionService);
  private readonly laser = inject(LaserService);

  private socket: Socket | null = null;
  private currentProjectId: string | null = null;

  private readonly _participants = signal<Participant[]>([]);
  private readonly _cursors = signal<Record<string, PresenceCursor>>({});
  private readonly _selections = signal<Record<string, PresenceSelection>>({});
  private readonly _connected = signal(false);
  private readonly _selfId = signal<string | null>(null);

  readonly participants = this._participants.asReadonly();
  /** Other participants who are presenting right now. */
  readonly presenters = computed(() =>
    this._participants().filter((p) => p.presenting && p.id !== this._selfId()),
  );
  readonly connected = this._connected.asReadonly();
  readonly selfId = this._selfId.asReadonly();

  private readonly byId = computed(() => {
    const map = new Map<string, Participant>();
    for (const p of this._participants()) {
      map.set(p.id, p);
    }
    return map;
  });

  /** Remote cursors resolved with their owner's color/name (self excluded). */
  readonly remoteCursors = computed<RemoteCursor[]>(() => {
    const participants = this.byId();
    const self = this._selfId();
    const out: RemoteCursor[] = [];
    for (const cursor of Object.values(this._cursors())) {
      if (cursor.participantId === self) {
        continue;
      }
      const p = participants.get(cursor.participantId);
      if (p) {
        out.push({ ...cursor, name: p.name, color: p.color });
      }
    }
    return out;
  });

  /** tableId -> colors of other participants currently selecting it. */
  readonly tableHighlights = computed(() => this.highlightsFor('tableIds'));

  connect(projectId: string): void {
    if (this.socket && this.currentProjectId === projectId) {
      return;
    }
    this.disconnect();
    this.currentProjectId = projectId;

    const auth: RealtimeHandshakeAuth = {
      projectId,
      token: this.session.token() ?? undefined,
      clientId: this.session.clientId,
      guestId: this.session.guestId,
    };
    const socket = io(`${environment.wsBaseUrl}${REALTIME_NAMESPACE}`, {
      withCredentials: true,
      transports: ['websocket'],
      auth: auth as unknown as Record<string, unknown>,
    });

    socket.on('connect', () => {
      this._selfId.set(socket.id ?? null);
      this._connected.set(true);
    });
    socket.on('disconnect', () => this._connected.set(false));
    socket.on(RT_EVENTS.roster, (participants: Participant[]) => {
      this._participants.set(participants);
      this.pruneStale(participants);
    });
    socket.on(RT_EVENTS.cursor, (cursor: PresenceCursor) => {
      this._cursors.update((m) => ({ ...m, [cursor.participantId]: cursor }));
    });
    socket.on(RT_EVENTS.selection, (selection: PresenceSelection) => {
      this._selections.update((m) => ({ ...m, [selection.participantId]: selection }));
    });
    socket.on(RT_EVENTS.laser, (sample: PresenceLaser) => {
      if (sample.end) {
        this.laser.release(sample.participantId);
      } else {
        this.laser.add(sample.participantId, sample.x, sample.y);
      }
    });
    socket.on(RT_EVENTS.mutation, (event: MutationEvent) => {
      // Ignore the echo of our own change: we already applied it optimistically.
      if (event.originClientId === this.session.clientId) {
        return;
      }
      this.store.applyRemote(event.mutation);
    });

    this.socket = socket;
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
    }
    this.socket = null;
    this.currentProjectId = null;
    this._participants.set([]);
    this._cursors.set({});
    this._selections.set({});
    this._connected.set(false);
    this._selfId.set(null);
    this.laser.clear();
  }

  sendCursor(x: number, y: number): void {
    this.socket?.emit(RT_EVENTS.cursor, { x, y });
  }

  /** Broadcast a laser-pointer sample (world coords); `end` signals release. */
  sendLaser(x: number, y: number, end = false): void {
    this.socket?.emit(RT_EVENTS.laser, { x, y, end });
  }

  /** Tell the room which slide (and build step) we are presenting; null frame = stopped. */
  sendPresenting(frameId: string | null, step = 0): void {
    this.socket?.emit(RT_EVENTS.present, { frameId, step });
  }

  sendSelection(tableIds: string[], relationshipIds: string[], columnId?: string): void {
    this.socket?.emit(RT_EVENTS.selection, { tableIds, relationshipIds, columnId });
  }

  private highlightsFor(key: 'tableIds' | 'relationshipIds'): Record<string, string[]> {
    const participants = this.byId();
    const self = this._selfId();
    const result: Record<string, string[]> = {};
    for (const selection of Object.values(this._selections())) {
      if (selection.participantId === self) {
        continue;
      }
      const color = participants.get(selection.participantId)?.color;
      if (!color) {
        continue;
      }
      for (const id of selection[key]) {
        (result[id] ??= []).push(color);
      }
    }
    return result;
  }

  /** Drop cursor/selection entries for participants who have left the room. */
  private pruneStale(participants: Participant[]): void {
    const live = new Set(participants.map((p) => p.id));
    this.laser.pruneRemote(live);
    this._cursors.update((m) => filterByKeys(m, live));
    this._selections.update((m) => filterByKeys(m, live));
  }
}

function filterByKeys<T>(map: Record<string, T>, live: Set<string>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [id, value] of Object.entries(map)) {
    if (live.has(id)) {
      out[id] = value;
    }
  }
  return out;
}
