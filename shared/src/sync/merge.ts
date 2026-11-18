import type {
  CanvasElementModel,
  LifelineModel,
  RelationshipModel,
  SchemaModel,
  SequenceDiagramModel,
  SequenceMessageModel,
  TableModel,
} from '../models';

/**
 * Three-way merge of two copies of one project (desktop sync): `base` is the version
 * both sides last agreed on, `mine` this computer's, `server` the server's.
 *
 * Items are compared whole, at the level shown on the canvas: a table (with its columns
 * and indexes), a relationship, an element, or a sequence diagram (with its participants
 * and messages). An item changed on one side only takes that side's version; an item
 * changed differently on both is a conflict, settled by `choices` (else the server's
 * version is used and the key is listed in `conflicts`).
 *
 * Keys match the compare view's: `table:<id>`, `relationship:<id>`, `element:<id>`,
 * `diagram:<id>`, plus `home` and `themes`.
 */
export type MergeChoice = 'mine' | 'server';

export interface MergeConflict {
  key: string;
  kind: 'table' | 'relationship' | 'element' | 'diagram' | 'home' | 'themes';
  label: string;
}

export interface MergeResult {
  schema: SchemaModel;
  conflicts: MergeConflict[];
  /** Keys taken from this computer's side (useful for messages/tests). */
  fromMine: string[];
}

/** Fields that differ between two servers' copies without being a real change. */
const IGNORED = new Set(['fileId', 'updatedAt', 'createdAt']);

interface DiagramUnit {
  diagram: SequenceDiagramModel;
  lifelines: LifelineModel[];
  messages: SequenceMessageModel[];
}

type Unit =
  | { kind: 'table'; value: TableModel }
  | { kind: 'relationship'; value: RelationshipModel }
  | { kind: 'element'; value: CanvasElementModel }
  | { kind: 'diagram'; value: DiagramUnit };

function units(schema: SchemaModel): Map<string, Unit> {
  const out = new Map<string, Unit>();
  for (const t of schema.tables) out.set(`table:${t.id}`, { kind: 'table', value: t });
  for (const r of schema.relationships)
    out.set(`relationship:${r.id}`, { kind: 'relationship', value: r });
  for (const e of schema.elements) out.set(`element:${e.id}`, { kind: 'element', value: e });
  for (const d of schema.sequenceDiagrams) {
    out.set(`diagram:${d.id}`, {
      kind: 'diagram',
      value: {
        diagram: d,
        lifelines: schema.lifelines.filter((l) => l.diagramId === d.id),
        messages: schema.sequenceMessages.filter((m) => m.diagramId === d.id),
      },
    });
  }
  return out;
}

/** Stable JSON with ignored fields dropped and object keys sorted. */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (key, v: unknown) => {
    if (IGNORED.has(key)) return undefined;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(
        Object.keys(v as object)
          .sort()
          .map((k) => [k, (v as Record<string, unknown>)[k]]),
      );
    }
    return v;
  });
}

const same = (a: unknown, b: unknown): boolean =>
  (a === undefined) === (b === undefined) && (a === undefined || canonical(a) === canonical(b));

function labelOf(unit: Unit): string {
  switch (unit.kind) {
    case 'table':
      return `Table ${unit.value.name}`;
    case 'relationship':
      return 'Relationship';
    case 'element': {
      const e = unit.value as CanvasElementModel & { text?: string };
      const text = typeof e.text === 'string' ? e.text.trim().slice(0, 30) : '';
      return text ? `${e.type} "${text}"` : `${e.type}`;
    }
    case 'diagram':
      return `Sequence diagram ${unit.value.diagram.title ?? ''}`.trim();
  }
}

/** Picks one side for a three-way item; `null` = conflict. */
function pick<T>(base: T | undefined, mine: T | undefined, server: T | undefined): MergeChoice | null {
  if (same(mine, server)) return 'server';
  if (same(mine, base)) return 'server';
  if (same(server, base)) return 'mine';
  return null;
}

export function mergeSchemas(
  base: SchemaModel,
  mine: SchemaModel,
  server: SchemaModel,
  choices: Readonly<Record<string, MergeChoice>> = {},
): MergeResult {
  const b = units(base);
  const m = units(mine);
  const s = units(server);
  const conflicts: MergeConflict[] = [];
  const fromMine: string[] = [];
  const kept: Unit[] = [];

  const keys = [...new Set([...s.keys(), ...m.keys(), ...b.keys()])];
  for (const key of keys) {
    const mu = m.get(key);
    const su = s.get(key);
    let side = pick(b.get(key)?.value, mu?.value, su?.value);
    if (side === null) {
      const any = (su ?? mu)!;
      conflicts.push({ key, kind: any.kind, label: labelOf(any) });
      side = choices[key] ?? 'server';
    }
    const chosen = side === 'mine' ? mu : su;
    if (side === 'mine' && !same(mu?.value, su?.value)) fromMine.push(key);
    if (chosen) kept.push(chosen);
  }

  const scalar = <K extends 'home' | 'themes'>(key: K): SchemaModel[K] => {
    let side = pick(base[key] ?? null, mine[key] ?? null, server[key] ?? null);
    if (side === null) {
      conflicts.push({
        key,
        kind: key,
        label: key === 'home' ? 'Home view' : 'Presentation themes',
      });
      side = choices[key] ?? 'server';
    }
    if (side === 'mine' && !same(mine[key] ?? null, server[key] ?? null)) fromMine.push(key);
    return side === 'mine' ? mine[key] : server[key];
  };

  const schema: SchemaModel = {
    tables: kept.flatMap((u) => (u.kind === 'table' ? [u.value] : [])),
    relationships: kept.flatMap((u) => (u.kind === 'relationship' ? [u.value] : [])),
    elements: kept.flatMap((u) => (u.kind === 'element' ? [u.value] : [])),
    sequenceDiagrams: kept.flatMap((u) => (u.kind === 'diagram' ? [u.value.diagram] : [])),
    lifelines: kept.flatMap((u) => (u.kind === 'diagram' ? u.value.lifelines : [])),
    sequenceMessages: kept.flatMap((u) => (u.kind === 'diagram' ? u.value.messages : [])),
    notes: server.notes ?? mine.notes ?? [],
    viewport: mine.viewport ?? server.viewport,
    home: scalar('home'),
    themes: scalar('themes'),
  };
  return { schema, conflicts, fromMine };
}
