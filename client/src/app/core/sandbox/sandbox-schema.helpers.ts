import type {
   CloneItemsDto,
   ParsedProjectImport,
   ProjectContent,
   RemapOptions,
   SchemaModel,
   SchemaMutation,
} from '@devdesigner/shared';
import {
   offsetToAnchor,
   parseProjectExport,
   planClone,
   planImportStacking,
   ProjectFileError,
   remapProjectIds,
} from '@devdesigner/shared';
import { codeElementContentSize } from '../../features/editor/helpers/render';
import { type Dict, patch, SandboxError, type SandboxProject, tablePatch, uuid } from './sandbox.helpers';

/** Size code blocks to their content with the editor's own (browser-measured) metrics. */
export function fitCodeBlocks(s: SchemaModel): SchemaModel {
   for (const e of s.elements) {
      if (e.type !== 'code' || e.expandedHeight) continue;
      const size = codeElementContentSize(e);
      e.width = size.width;
      e.height = size.height;
   }
   return s;
}

export function normalizeSchema(s: SchemaModel): SchemaModel {
   return {
      ...s,
      tables: (s.tables ?? []).map((t) => ({ ...t, columns: t.columns ?? [], indexes: t.indexes ?? [] })),
      relationships: s.relationships ?? [],
      notes: s.notes ?? [],
      elements: s.elements ?? [],
      sequenceDiagrams: s.sequenceDiagrams ?? [],
      lifelines: s.lifelines ?? [],
      sequenceMessages: s.sequenceMessages ?? [],
      viewport: s.viewport ?? { x: 0, y: 0, zoom: 1 },
      home: s.home ?? null,
      themes: s.themes ?? [],
   };
}

/**
 * Plan an imported file with the shared id planner: embedded images get fresh ids,
 * image elements are re-pointed at them (dropped when their file is missing), and
 * every other id and reference is remapped exactly like a server import.
 */
export function remapFile(
   parsed: ParsedProjectImport,
   opts: Omit<RemapOptions, 'fileOf'> = {}
): { content: ProjectContent; images: SandboxProject['images'] } {
   const fileIds = new Map(parsed.images.map((img) => [img.id, uuid()]));
   const images: SandboxProject['images'] = {};
   for (const img of parsed.images) images[fileIds.get(img.id)!] = { mimeType: img.mimeType, data: img.data };
   const content = remapProjectIds(parsed.schema, {
      ...opts,
      fileOf: (old) => (old === undefined ? undefined : fileIds.get(old)),
   });
   return { content, images };
}

export function deleteTable(s: SchemaModel, id: string): void {
   const t = s.tables.find((x) => x.id === id);
   if (!t) return;
   const cols = new Set(t.columns.map((c) => c.id));
   s.tables = s.tables.filter((x) => x.id !== id);
   s.relationships = s.relationships.filter((r) => !cols.has(r.sourceColumnId) && !cols.has(r.targetColumnId));
}

export function deleteDiagram(s: SchemaModel, id: string): void {
   s.sequenceDiagrams = s.sequenceDiagrams.filter((d) => d.id !== id);
   s.lifelines = s.lifelines.filter((l) => l.diagramId !== id);
   s.sequenceMessages = s.sequenceMessages.filter((m) => m.diagramId !== id);
}

/** POST /batch: patches then deletes, in the server's order. */
export function applyBatch(s: SchemaModel, b: Dict): void {
   const each = <T extends { id: string }>(
      list: T[],
      patches: unknown,
      fn: (x: T, p: Dict) => T = (x, p) => patch(x, p)
   ) => {
      for (const p of (patches as Dict[]) ?? []) {
         const i = list.findIndex((x) => x.id === p['id']);
         if (i >= 0) list[i] = fn(list[i], p);
      }
   };
   each(s.tables, b['tables'], tablePatch);
   each(s.elements, b['elements']);
   each(s.sequenceDiagrams, b['diagrams']);
   each(s.lifelines, b['lifelines']);
   each(s.sequenceMessages, b['messages']);
   each(s.relationships, b['relationships']);
   const del = (b['deletes'] ?? {}) as Record<string, string[] | undefined>;
   for (const id of del['tables'] ?? []) deleteTable(s, id);
   for (const id of del['diagrams'] ?? []) deleteDiagram(s, id);
   const drop = <T extends { id: string }>(list: T[], ids: string[] | undefined): T[] =>
      ids?.length ? list.filter((x) => !ids.includes(x.id)) : list;
   s.elements = drop(s.elements, del['elements']);
   s.relationships = drop(s.relationships, del['relationships']);
   s.lifelines = drop(s.lifelines, del['lifelines']);
   if (del['lifelines']?.length) {
      s.sequenceMessages = s.sequenceMessages.filter(
         (m) => !del['lifelines']!.includes(m.fromLifelineId) && !del['lifelines']!.includes(m.toLifelineId)
      );
   }
   s.sequenceMessages = drop(s.sequenceMessages, del['messages']);
}

/** POST /clone: copies under client-chosen ids, offset by (dx, dy) (the shared clone planner). */
export function applyClone(s: SchemaModel, b: Dict): void {
   const added = planClone(s, b as unknown as CloneItemsDto);
   s.tables.push(...added.tables);
   s.relationships.push(...added.relationships);
   s.sequenceDiagrams.push(...added.sequenceDiagrams);
   s.lifelines.push(...added.lifelines);
   s.sequenceMessages.push(...added.sequenceMessages);
   s.elements.push(...added.elements);
}

/** POST /import-content: merge a file at `anchor`, returning the created items as mutations (like the server). */
export function applyImportContent(p: SandboxProject, b: Dict): SchemaMutation[] {
   let parsed: ParsedProjectImport;
   try {
      parsed = parseProjectExport(b['file']);
   } catch (e) {
      if (e instanceof ProjectFileError) throw new SandboxError(400, e.message);
      throw e;
   }
   const s = p.schema;
   const anchor = b['anchor'] as { x?: unknown; y?: unknown } | undefined;
   const { dx, dy } =
      anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)
         ? offsetToAnchor(parsed.schema, { x: anchor.x as number, y: anchor.y as number })
         : { dx: 0, dy: 0 };
   const stacking = parsed.schema.elements.length
      ? planImportStacking(
           parsed.schema.elements,
           {
              maxZIndex: s.elements.length ? Math.max(...s.elements.map((e) => e.zIndex)) : null,
              slides: s.elements.filter((e) => e.type === 'frame').map((e) => e.slide ?? null),
           },
           b['joinPresentations'] === true
        )
      : undefined;
   const linkExisting =
      b['linkExisting'] === true
         ? { elementIds: new Set(s.elements.map((e) => e.id)), tableIds: new Set(s.tables.map((t) => t.id)) }
         : undefined;
   const { content, images } = remapFile(parsed, { dx, dy, ...stacking, linkExisting });
   Object.assign(p.images, images);
   s.tables.push(...content.tables);
   s.relationships.push(...content.relationships);
   s.elements.push(...content.elements);
   s.sequenceDiagrams.push(...content.sequenceDiagrams);
   s.lifelines.push(...content.lifelines);
   s.sequenceMessages.push(...content.sequenceMessages);
   // Parents before children, in the server's order.
   return [
      ...content.tables.map((table): SchemaMutation => ({ kind: 'table.created', table })),
      ...content.relationships.map((relationship): SchemaMutation => ({ kind: 'relationship.created', relationship })),
      ...content.elements.map((element): SchemaMutation => ({ kind: 'element.created', element })),
      ...content.sequenceDiagrams.map((diagram): SchemaMutation => ({ kind: 'sequenceDiagram.created', diagram })),
      ...content.lifelines.map((lifeline): SchemaMutation => ({ kind: 'lifeline.created', lifeline })),
      ...content.sequenceMessages.map((message): SchemaMutation => ({ kind: 'message.created', message })),
   ];
}
