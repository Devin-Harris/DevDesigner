import type { BatchUpdateResponse } from '@devdesigner/shared';
import { BatchController } from './batch.controller';
import type { BatchService } from './batch.service';
import type { CloneService } from './clone.service';
import { batchResult } from './batch-ack';
import { bumpProjectRevision, resetProjectRevisionsForTests } from '../common/project-revision';

/** `?return=none` on batch / clone (perf P1.13): an ack instead of full rows; default unchanged. */
describe('batch ?return=none', () => {
  const result = {
    mutations: [
      { kind: 'element.updated', element: { id: 'e1', text: 'x'.repeat(10_000) } },
      { kind: 'table.moved', tableId: 't1', x: 1, y: 2 },
      { kind: 'message.deleted', messageId: 'm1' },
      { kind: 'element.reordered', orderedElementIds: ['e1'] },
    ],
  } as unknown as BatchUpdateResponse;

  let batch: { apply: jest.Mock };
  let cloner: { clone: jest.Mock };
  let controller: BatchController;
  const pa = { projectId: 'p1', accessLevel: 'OWNER' } as const;

  beforeEach(() => {
    resetProjectRevisionsForTests();
    batch = {
      apply: jest.fn(async () => {
        bumpProjectRevision('p1');
        return result;
      }),
    };
    cloner = { clone: jest.fn(async () => result) };
    controller = new BatchController(
      batch as unknown as BatchService,
      cloner as unknown as CloneService,
    );
  });

  it('returns the full mutations by default (MCP behaviour)', async () => {
    await expect(controller.apply(pa, {})).resolves.toBe(result);
    await expect(controller.apply(pa, {}, 'mutations')).resolves.toBe(result);
    await expect(controller.clone(pa, {})).resolves.toBe(result);
  });

  it('returns ids and the new revision with return=none', async () => {
    const ack = await controller.apply(pa, {}, 'none');
    expect(ack).toEqual({ ok: true, revision: 1, ids: ['e1', 't1', 'm1'] });
    expect(JSON.stringify(ack).length).toBeLessThan(100);
    expect(batch.apply).toHaveBeenCalledWith('p1', {});
  });

  it('works for clone too', async () => {
    expect(await controller.clone(pa, {}, 'none')).toEqual({
      ok: true,
      revision: 0,
      ids: ['e1', 't1', 'm1'],
    });
  });

  it('batchResult passes the response through untouched when not asked', () => {
    expect(batchResult('p1', result, false)).toBe(result);
  });
});
