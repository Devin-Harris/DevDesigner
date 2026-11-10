// Before/after values of a patch, for recording undo steps only when something changed.

/** Pick the patched keys from a model (missing values become '' so they can be cleared). */
export function pickKeys(model: object, keys: string[]): Record<string, unknown> {
   const src = model as Record<string, unknown>;
   return Object.fromEntries(keys.map((k) => [k, src[k] ?? '']));
}

export function sameValues(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
   return Object.keys(a).every((k) => a[k] === b[k]);
}
