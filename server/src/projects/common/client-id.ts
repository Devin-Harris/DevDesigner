import { ConflictException } from '@nestjs/common';
import type { ObjectLiteral, Repository } from 'typeorm';

/**
 * Creates may carry a client-generated id (perf P3.2: optimistic creates). It must be
 * new: `save` would otherwise update the existing row, possibly in another project.
 * Returns the `{ id }` to spread into `repo.create(...)` (empty without a client id).
 */
export async function clientId<T extends ObjectLiteral>(
  repo: Repository<T>,
  id: string | undefined,
  label: string,
): Promise<{ id?: string }> {
  if (!id) return {};
  if (await repo.exists({ where: { id } as never })) {
    throw new ConflictException(`${label} ${id} already exists.`);
  }
  return { id };
}
