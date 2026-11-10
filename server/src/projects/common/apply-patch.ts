/**
 * Copy the fields of a partial-update DTO that were actually sent (not `undefined`)
 * onto an entity. Replaces the `if (dto.x !== undefined) row.x = dto.x` blocks; fields
 * that need a transform (JSON columns, trimming, clamping) stay explicit.
 */
export function applyDefined<T extends object, D extends object, K extends keyof D & keyof T>(
  row: T,
  dto: D,
  keys: readonly K[],
): void {
  for (const key of keys) {
    const value = dto[key];
    if (value !== undefined) {
      row[key] = value as unknown as T[K];
    }
  }
}
