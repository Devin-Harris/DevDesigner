import { Injectable } from '@angular/core';
import type {
   CanvasElementModel,
   ColumnModel,
   IndexModel,
   LifelineModel,
   ProjectExportFile,
   ProjectGraphResponse,
   ProjectSummary,
   RelationshipModel,
   SchemaModel,
   SchemaMutation,
   SequenceDiagramModel,
   SequenceMessageModel,
   TableModel,
} from '@devdesigner/shared';
import type { CloneItemsDto, ParsedProjectImport, ProjectContent, RemapOptions } from '@devdesigner/shared';
import {
   isColorValue,
   offsetToAnchor,
   parseProjectExport,
   planClone,
   planImportStacking,
   ProjectFileError,
   remapProjectIds,
} from '@devdesigner/shared';
import { codeElementContentSize } from '../../features/editor/helpers/shape-render.helper';

/** Project ids served by the sandbox backend instead of the API. */
export const SANDBOX_PREFIX = 'sandbox-';
export const isSandboxId = (id: string | null | undefined): boolean => !!id && id.startsWith(SANDBOX_PREFIX);

const STORAGE_PREFIX = 'dd-sandbox:';

interface SandboxProject {
   project: ProjectSummary;
   schema: SchemaModel;
   /** Uploaded / seeded media: id -> { mimeType, base64 data }. */
   images: Record<string, { mimeType: string; data: string }>;
   /** Served with VIEW access: the editor renders it read-only (home page showcase). */
   viewOnly?: boolean;
}

/** Thrown for a request the sandbox can not satisfy (becomes an HTTP error). */
export class SandboxError extends Error {
   constructor(
      readonly status: number,
      message: string
   ) {
      super(message);
   }
}

type Dict = Record<string, unknown>;

const uuid = (): string => crypto.randomUUID();

/**
 * Mirror of the server's @IsColor (security S1.2): every color in a write body
 * (`*Color` / `color` keys at any depth, and a theme's `colors` map) must be a color
 * the server would accept, so sandboxes never hold data the real API refuses.
 */
function assertColors(value: unknown, path = 'body'): void {
   if (Array.isArray(value)) {
      value.forEach((v, i) => assertColors(v, `${path}[${i}]`));
      return;
   }
   if (!value || typeof value !== 'object') return;
   for (const [key, v] of Object.entries(value as Dict)) {
      const isColorKey = /color$/i.test(key) && typeof v === 'string';
      if (isColorKey && !isColorValue(v)) throw new SandboxError(400, `${path}.${key} must be a color.`);
      if (key === 'colors' && v && typeof v === 'object' && !Array.isArray(v)) {
         for (const [k, c] of Object.entries(v as Dict)) {
            if (!isColorValue(c)) throw new SandboxError(400, `${path}.colors.${k} must be a color.`);
         }
      }
      if (!isColorKey) assertColors(v, `${path}.${key}`);
   }
}

/** Mirror of the server's assertIdsInProject (security S2.3): refs must exist in this sandbox. */
function assertKnown(ids: unknown[], known: ReadonlyArray<{ id: string }>, what: string): void {
   const have = new Set(known.map((x) => x.id));
   const bad = ids.filter((id): id is string => typeof id === 'string' && id !== '' && !have.has(id));
   if (bad.length) throw new SandboxError(400, `${what} ${bad.join(', ')} is not part of this project.`);
}

/** Shallow patch with the API's semantics: `null` clears a field, `undefined` leaves it. */
function patch<T extends object>(target: T, dto: Dict, skip: string[] = ['id']): T {
   const out = { ...target } as Dict;
   for (const [k, v] of Object.entries(dto)) {
      if (skip.includes(k) || v === undefined) continue;
      if (v === null || (k === 'morphId' && typeof v === 'string' && !v.trim())) delete out[k];
      else out[k] = v;
   }
   return out as T;
}

/**
 * A browser-only stand-in for the projects API, used by the canvas guide's sandboxes:
 * every editor request for a `sandbox-…` project is answered here, and the project is
 * kept in sessionStorage. Nothing reaches the server or the database.
 */
@Injectable({ providedIn: 'root' })
export class SandboxBackendService {
   private readonly projects = new Map<string, SandboxProject>();
   private readonly saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

   // ------------------------------------------------------------------ lifecycle

   /** Create a sandbox project from a project export file (fresh ids, like a server import). */
   create(file: ProjectExportFile, key: string, opts: { viewOnly?: boolean } = {}): string {
      const id = SANDBOX_PREFIX + key + '-' + uuid().slice(0, 8);
      // Same parser and id planner as a server import (shared project-file).
      const parsed = parseProjectExport(file);
      const { content, images } = remapFile(parsed);
      const schema: SchemaModel = {
         ...content,
         notes: [],
         viewport: parsed.schema.viewport,
         home: parsed.schema.home,
         themes: parsed.schema.themes,
      };
      const now = new Date().toISOString();
      this.projects.set(id, {
         project: {
            id,
            name: parsed.name,
            description: parsed.description,
            archived: false,
            type: parsed.type,
            createdAt: now,
            updatedAt: now,
         },
         schema: fitCodeBlocks(normalizeSchema(schema)),
         images,
         viewOnly: opts.viewOnly,
      });
      this.save(id, true);
      return id;
   }

   /** True when the sandbox exists in this browser session. */
   exists(id: string): boolean {
      return !!this.get(id, false);
   }

   delete(id: string): void {
      this.projects.delete(id);
      try {
         sessionStorage.removeItem(STORAGE_PREFIX + id);
      } catch {
         /* ignore */
      }
   }

   private get(id: string, required = true): SandboxProject | null {
      let p = this.projects.get(id) ?? null;
      if (!p) {
         try {
            const raw = sessionStorage.getItem(STORAGE_PREFIX + id);
            if (raw) {
               p = JSON.parse(raw) as SandboxProject;
               this.projects.set(id, p);
            }
         } catch {
            p = null;
         }
      }
      if (!p && required) throw new SandboxError(404, `Sandbox ${id} not found.`);
      return p;
   }

   /** Persist to sessionStorage (debounced; the session is the only lifetime). */
   private save(id: string, now = false): void {
      const write = (): void => {
         this.saveTimers.delete(id);
         const p = this.projects.get(id);
         if (!p) return;
         p.project.updatedAt = new Date().toISOString();
         try {
            sessionStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(p));
         } catch {
            // Over quota (large media): keep the full copy in memory, store it without media.
            try {
               sessionStorage.setItem(STORAGE_PREFIX + id, JSON.stringify({ ...p, images: {} }));
            } catch {
               /* memory only */
            }
         }
      };
      clearTimeout(this.saveTimers.get(id));
      if (now) write();
      else this.saveTimers.set(id, setTimeout(write, 300));
   }

   /** The sandbox project that owns an entity id (for routes like /elements/:id). */
   private ownerOf(kind: 'element' | 'table' | 'column' | 'index' | 'relationship', entityId: string): string | null {
      this.loadAllFromSession();
      for (const [pid, p] of this.projects) {
         const s = p.schema;
         const hit =
            kind === 'element'
               ? s.elements.some((e) => e.id === entityId)
               : kind === 'table'
                 ? s.tables.some((t) => t.id === entityId)
                 : kind === 'column'
                   ? s.tables.some((t) => t.columns.some((c) => c.id === entityId))
                   : kind === 'index'
                     ? s.tables.some((t) => (t.indexes ?? []).some((i) => i.id === entityId))
                     : s.relationships.some((r) => r.id === entityId);
         if (hit) return pid;
      }
      return null;
   }

   private loadAllFromSession(): void {
      try {
         for (let i = 0; i < sessionStorage.length; i++) {
            const k = sessionStorage.key(i);
            if (k?.startsWith(STORAGE_PREFIX)) this.get(k.slice(STORAGE_PREFIX.length), false);
         }
      } catch {
         /* ignore */
      }
   }

   /** Image bytes for GET /images/:id, if a sandbox holds it. */
   image(fileId: string): Blob | null {
      this.loadAllFromSession();
      for (const p of this.projects.values()) {
         const img = p.images[fileId];
         if (img) {
            const bin = atob(img.data);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            return new Blob([bytes], { type: img.mimeType });
         }
      }
      return null;
   }

   // ------------------------------------------------------------------ routing

   /**
    * Handle one API request. Returns `undefined` when the path is not a sandbox's
    * (the request then goes to the real API); throws SandboxError for bad requests.
    */
   handle(method: string, path: string, body: unknown): { body: unknown } | undefined {
      const b = (body ?? {}) as Dict;
      const seg = path.split('?')[0].split('/').filter(Boolean);
      if (method !== 'GET') assertColors(b);

      // GET /images/:id is handled by the interceptor (blob response).
      if (seg[0] === 'projects' && isSandboxId(seg[1])) {
         return { body: this.projectRoute(method, seg[1], seg.slice(2), b) };
      }
      const entityRoutes: Record<string, 'element' | 'table' | 'column' | 'index' | 'relationship'> = {
         elements: 'element',
         tables: 'table',
         columns: 'column',
         indexes: 'index',
         relationships: 'relationship',
      };
      const kind = entityRoutes[seg[0]];
      if (kind && seg[1]) {
         const pid = this.ownerOf(kind, seg[1]);
         if (!pid) return undefined;
         return { body: this.entityRoute(pid, method, kind, seg[1], seg.slice(2), b) };
      }
      return undefined;
   }

   private projectRoute(method: string, pid: string, rest: string[], b: Dict): unknown {
      const p = this.get(pid)!;
      const s = p.schema;
      const [what, id, sub] = rest;
      const done = <T>(v: T): T => {
         this.save(pid);
         return v;
      };

      if (!what) {
         if (method === 'GET') return this.graph(pid);
         if (method === 'PATCH') {
            p.project = patch(p.project, b, ['id']);
            return done(p.project);
         }
         if (method === 'DELETE') {
            this.delete(pid);
            return null;
         }
      }
      switch (what) {
         case 'viewport':
            s.viewport = { x: Number(b['viewportX']), y: Number(b['viewportY']), zoom: Number(b['zoom']) };
            return done(null);
         case 'home':
            s.home = (b['home'] as SchemaModel['home']) ?? null;
            return done(null);
         case 'themes':
            s.themes = (b['themes'] as SchemaModel['themes']) ?? [];
            return done(null);
         case 'export-file':
            return this.exportFile(pid);
         case 'share':
            return method === 'GET'
               ? []
               : (() => {
                    throw new SandboxError(400, 'Sandboxes can not be shared.');
                 })();
         case 'images': {
            const imageId = uuid();
            p.images[imageId] = { mimeType: String(b['mimeType']), data: String(b['data']) };
            return done({ id: imageId });
         }
         case 'batch':
            this.batch(s, b);
            return done({ mutations: [] });
         case 'clone':
            this.clone(s, b);
            return done({ mutations: [] });
         case 'import-content':
            return done({ mutations: this.importContent(p, b) });
         case 'elements':
            if (id === 'reorder') {
               const order = (b['orderedElementIds'] as string[]) ?? [];
               order.forEach((eid, i) => {
                  const e = s.elements.find((x) => x.id === eid);
                  if (e) e.zIndex = i;
               });
               return done(null);
            }
            if (method === 'POST') {
               const top = s.elements.reduce((m, e) => Math.max(m, e.zIndex), -1);
               const el = patch({ angle: 0, zIndex: top + 1 } as unknown as CanvasElementModel, b, []);
               el.id = (b['id'] as string) || uuid();
               if (s.elements.some((e) => e.id === el.id)) throw new SandboxError(409, 'Element exists.');
               s.elements.push(el);
               return done(el);
            }
            break;
         case 'tables':
            if (method === 'POST') {
               const t = patch({ id: uuid(), columns: [], indexes: [] } as unknown as TableModel, b, ['id']);
               s.tables.push(t);
               return done(t);
            }
            break;
         case 'relationships':
            if (method === 'POST') {
               const r = patch({ id: uuid() } as RelationshipModel, b, ['id']);
               s.relationships.push(r);
               return done(r);
            }
            break;
         case 'sequence-diagrams':
            return done(this.diagramRoute(s, method, id, b));
         case 'lifelines':
            return done(this.lifelineRoute(s, method, id, sub, b));
         case 'messages':
            return done(this.messageRoute(s, method, id, sub, b));
      }
      throw new SandboxError(404, `Not available in a sandbox: ${method} ${rest.join('/')}`);
   }

   private entityRoute(
      pid: string,
      method: string,
      kind: 'element' | 'table' | 'column' | 'index' | 'relationship',
      id: string,
      rest: string[],
      b: Dict
   ): unknown {
      const s = this.get(pid)!.schema;
      const done = <T>(v: T): T => {
         this.save(pid);
         return v;
      };
      switch (kind) {
         case 'element': {
            const i = s.elements.findIndex((e) => e.id === id);
            if (method === 'DELETE') {
               s.elements.splice(i, 1);
               return done(null);
            }
            s.elements[i] = patch(s.elements[i], b);
            return done(rest[0] === 'position' ? null : s.elements[i]);
         }
         case 'table': {
            const i = s.tables.findIndex((t) => t.id === id);
            const t = s.tables[i];
            if (rest[0] === 'columns') {
               if (rest[1] === 'reorder') {
                  const order = (b['orderedColumnIds'] as string[]) ?? [];
                  t.columns = order.map((cid) => t.columns.find((c) => c.id === cid)!).filter(Boolean);
                  return done(null);
               }
               const c = patch(
                  {
                     id: uuid(),
                     isPrimaryKey: false,
                     isNullable: true,
                     isUnique: false,
                     isAutoIncrement: false,
                  } as ColumnModel,
                  b,
                  ['id']
               );
               t.columns.push(c);
               return done(c);
            }
            if (rest[0] === 'indexes') {
               t.indexes ??= [];
               if (rest[1] === 'reorder') {
                  const order = (b['orderedIndexIds'] as string[]) ?? [];
                  t.indexes = order.map((x) => t.indexes!.find((ix) => ix.id === x)!).filter(Boolean);
                  return done(null);
               }
               assertKnown((b['columnIds'] as unknown[]) ?? [], t.columns, 'Column');
               const ix = patch({ id: uuid(), isUnique: false, columnIds: [] } as unknown as IndexModel, b, ['id']);
               t.indexes.push(ix);
               return done(ix);
            }
            if (method === 'DELETE') {
               this.deleteTable(s, id);
               return done(null);
            }
            s.tables[i] = tablePatch(t, b);
            return done(rest[0] === 'position' ? null : s.tables[i]);
         }
         case 'column': {
            const t = s.tables.find((x) => x.columns.some((c) => c.id === id))!;
            if (method === 'DELETE') {
               t.columns = t.columns.filter((c) => c.id !== id);
               s.relationships = s.relationships.filter((r) => r.sourceColumnId !== id && r.targetColumnId !== id);
               return done(null);
            }
            const ci = t.columns.findIndex((c) => c.id === id);
            t.columns[ci] = patch(t.columns[ci], b);
            return done(t.columns[ci]);
         }
         case 'index': {
            const t = s.tables.find((x) => (x.indexes ?? []).some((ix) => ix.id === id))!;
            if (method === 'DELETE') {
               t.indexes = t.indexes!.filter((ix) => ix.id !== id);
               return done(null);
            }
            const ii = t.indexes!.findIndex((ix) => ix.id === id);
            t.indexes![ii] = patch(t.indexes![ii], b);
            return done(t.indexes![ii]);
         }
         case 'relationship': {
            const ri = s.relationships.findIndex((r) => r.id === id);
            if (method === 'DELETE') {
               s.relationships.splice(ri, 1);
               return done(null);
            }
            s.relationships[ri] = patch(s.relationships[ri], b);
            return done(s.relationships[ri]);
         }
      }
   }

   private diagramRoute(s: SchemaModel, method: string, id: string | undefined, b: Dict): unknown {
      if (method === 'POST') {
         const d = patch(
            { id: uuid(), lifelineSpacing: 160, rowSpacing: 48, headerHeight: 42, zIndex: -1 } as SequenceDiagramModel,
            b,
            ['id']
         );
         s.sequenceDiagrams.push(d);
         return d;
      }
      const i = s.sequenceDiagrams.findIndex((d) => d.id === id);
      if (i < 0) throw new SandboxError(404, 'Diagram not found.');
      if (method === 'DELETE') {
         this.deleteDiagram(s, id!);
         return null;
      }
      s.sequenceDiagrams[i] = patch(s.sequenceDiagrams[i], b);
      return s.sequenceDiagrams[i];
   }

   private lifelineRoute(
      s: SchemaModel,
      method: string,
      id: string | undefined,
      sub: string | undefined,
      b: Dict
   ): unknown {
      if (method === 'POST') {
         const l = patch({ id: uuid(), width: 120, order: 0 } as LifelineModel, b, ['id']);
         s.lifelines.push(l);
         return l;
      }
      const i = s.lifelines.findIndex((l) => l.id === id);
      if (i < 0) throw new SandboxError(404, 'Participant not found.');
      if (method === 'DELETE') {
         s.lifelines.splice(i, 1);
         s.sequenceMessages = s.sequenceMessages.filter((m) => m.fromLifelineId !== id && m.toLifelineId !== id);
         return null;
      }
      s.lifelines[i] = patch(s.lifelines[i], b);
      return sub === 'position' ? null : s.lifelines[i];
   }

   private messageRoute(
      s: SchemaModel,
      method: string,
      id: string | undefined,
      sub: string | undefined,
      b: Dict
   ): unknown {
      if (method === 'POST') {
         if (b['style'] !== 'break' && b['fromLifelineId'] === b['toLifelineId']) {
            throw new SandboxError(400, 'A message must go between two different participants.');
         }
         assertKnown([b['fromLifelineId'], b['toLifelineId']], s.lifelines, 'Lifeline');
         const m = patch(
            { id: uuid(), style: 'solid', direction: 'forward', arrowhead: 'arrow' } as SequenceMessageModel,
            b,
            ['id']
         );
         s.sequenceMessages.push(m);
         return m;
      }
      const i = s.sequenceMessages.findIndex((m) => m.id === id);
      if (i < 0) throw new SandboxError(404, 'Message not found.');
      if (method === 'DELETE') {
         s.sequenceMessages.splice(i, 1);
         return null;
      }
      assertKnown([b['fromLifelineId'], b['toLifelineId']], s.lifelines, 'Lifeline');
      s.sequenceMessages[i] = patch(s.sequenceMessages[i], b);
      return sub === 'position' ? null : s.sequenceMessages[i];
   }

   // ------------------------------------------------------------------ bulk operations

   private batch(s: SchemaModel, b: Dict): void {
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
      for (const id of del['tables'] ?? []) this.deleteTable(s, id);
      for (const id of del['diagrams'] ?? []) this.deleteDiagram(s, id);
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
   private clone(s: SchemaModel, b: Dict): void {
      const added = planClone(s, b as unknown as CloneItemsDto);
      s.tables.push(...added.tables);
      s.relationships.push(...added.relationships);
      s.sequenceDiagrams.push(...added.sequenceDiagrams);
      s.lifelines.push(...added.lifelines);
      s.sequenceMessages.push(...added.sequenceMessages);
      s.elements.push(...added.elements);
   }

   /** POST /import-content: merge a file at `anchor`, returning the created items as mutations (like the server). */
   private importContent(p: SandboxProject, b: Dict): SchemaMutation[] {
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

   private deleteTable(s: SchemaModel, id: string): void {
      const t = s.tables.find((x) => x.id === id);
      if (!t) return;
      const cols = new Set(t.columns.map((c) => c.id));
      s.tables = s.tables.filter((x) => x.id !== id);
      s.relationships = s.relationships.filter((r) => !cols.has(r.sourceColumnId) && !cols.has(r.targetColumnId));
   }

   private deleteDiagram(s: SchemaModel, id: string): void {
      s.sequenceDiagrams = s.sequenceDiagrams.filter((d) => d.id !== id);
      s.lifelines = s.lifelines.filter((l) => l.diagramId !== id);
      s.sequenceMessages = s.sequenceMessages.filter((m) => m.diagramId !== id);
   }

   // ------------------------------------------------------------------ reads

   private graph(pid: string): ProjectGraphResponse {
      const p = this.get(pid)!;
      return {
         project: p.project,
         schema: structuredClone(p.schema),
         accessLevel: (p.viewOnly ? 'VIEW' : 'OWNER') as ProjectGraphResponse['accessLevel'],
      };
   }

   private exportFile(pid: string): ProjectExportFile {
      const p = this.get(pid)!;
      return {
         format: 'devdesigner-project',
         version: 1,
         exportedAt: new Date().toISOString(),
         project: { name: p.project.name, description: null, type: p.project.type },
         schema: structuredClone(p.schema),
         images: Object.entries(p.images).map(([id, img]) => ({ id, ...img })),
      };
   }
}

function tablePatch(t: TableModel, b: Dict): TableModel {
   const next = patch(t, b);
   if (b['width'] !== undefined && !((b['width'] as number) > 0)) delete next.width;
   if (b['scale'] !== undefined && (!((b['scale'] as number) > 0) || b['scale'] === 1)) delete next.scale;
   return next;
}

/** Size code blocks to their content with the editor's own (browser-measured) metrics. */
function fitCodeBlocks(s: SchemaModel): SchemaModel {
   for (const e of s.elements) {
      if (e.type !== 'code' || e.expandedHeight) continue;
      const size = codeElementContentSize(e);
      e.width = size.width;
      e.height = size.height;
   }
   return s;
}

function normalizeSchema(s: SchemaModel): SchemaModel {
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
function remapFile(
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
