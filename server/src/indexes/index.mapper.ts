import type { IndexModel } from '@dbdesigner/shared';
import { IndexEntity } from './index.entity';

/** Map an Index entity to the shared IndexModel consumed by client + SQL. */
export function toIndexModel(entity: IndexEntity): IndexModel {
  let columnIds: string[] = [];
  try {
    const parsed = JSON.parse(entity.columnIdsJson) as unknown;
    if (Array.isArray(parsed)) {
      columnIds = parsed.filter((x): x is string => typeof x === 'string');
    }
  } catch {
    columnIds = [];
  }
  return {
    id: entity.id,
    name: entity.name,
    columnIds,
    isUnique: entity.isUnique,
  };
}
