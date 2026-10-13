// Collects many granular patches/deletes and sends them as ONE atomic
// PATCH /projects/:id/batch (server applies them in a single transaction and
// broadcasts ordinary realtime mutations), instead of one REST call per item.

import type { BatchUpdateDto, BatchUpdateResponse } from '@dbdesigner/shared';
import type { DbDesignerApi } from './api';

export type BatchSection = 'tables' | 'elements' | 'diagrams' | 'lifelines' | 'messages' | 'relationships';

const SECTIONS: readonly BatchSection[] = ['tables', 'elements', 'diagrams', 'lifelines', 'messages', 'relationships'];

export class Batch {
  private readonly patches = new Map<BatchSection, Map<string, Record<string, unknown>>>(
    SECTIONS.map((s) => [s, new Map()]),
  );
  private readonly deletes = new Map<BatchSection, Set<string>>(SECTIONS.map((s) => [s, new Set()]));

  /** Merge `patch` into the pending patch for one item (later keys win). */
  set(section: BatchSection, id: string, patch: Record<string, unknown>): this {
    const map = this.patches.get(section) as Map<string, Record<string, unknown>>;
    map.set(id, { ...(map.get(id) ?? {}), ...patch });
    return this;
  }

  /** The pending patch for an item, if any (to read back a value set earlier). */
  get(section: BatchSection, id: string): Record<string, unknown> | undefined {
    return this.patches.get(section)?.get(id);
  }

  delete(section: BatchSection, id: string): this {
    this.deletes.get(section)?.add(id);
    this.patches.get(section)?.delete(id);
    return this;
  }

  get size(): number {
    let n = 0;
    for (const s of SECTIONS) n += (this.patches.get(s)?.size ?? 0) + (this.deletes.get(s)?.size ?? 0);
    return n;
  }

  toDto(): BatchUpdateDto {
    const dto: Record<string, unknown> = {};
    const del: Record<string, string[]> = {};
    for (const s of SECTIONS) {
      const p = this.patches.get(s) as Map<string, Record<string, unknown>>;
      if (p.size) dto[s] = [...p.entries()].map(([id, patch]) => ({ id, ...patch }));
      const d = this.deletes.get(s) as Set<string>;
      if (d.size) del[s] = [...d];
    }
    if (Object.keys(del).length) dto.deletes = del;
    return dto as BatchUpdateDto;
  }

  /** Send everything in one request; returns how many entries were written (0 = no call). */
  async send(api: DbDesignerApi, projectId: string): Promise<number> {
    const n = this.size;
    if (n === 0) return 0;
    await api.patch<BatchUpdateResponse>(`/projects/${projectId}/batch`, this.toDto());
    return n;
  }
}
