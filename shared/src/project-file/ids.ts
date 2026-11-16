// Runtime globals the project-file planners use. Both Node (>= 19) and browsers
// provide them; shared compiles without DOM / Node typings, so they are declared here.
declare const crypto: { randomUUID(): string };

/** A fresh UUID (v4). */
export const randomId = (): string => crypto.randomUUID();

/** Deep copy of plain JSON data (models), without relying on structuredClone typings. */
export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
