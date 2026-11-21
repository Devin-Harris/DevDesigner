import { Injectable, inject } from '@angular/core';
import { CodeBlockSizer } from './code-block-sizer';
import type { CanvasElementModel, ProjectExportFile, ProjectGraphResponse, RelationshipModel, SchemaModel, TableModel } from '@devdesigner/shared';
import { parseProjectExport } from '@devdesigner/shared';
import { assertColors, type Dict, isSandboxId, patch, SANDBOX_PREFIX, SandboxError, type SandboxProject, uuid } from './sandbox.helpers';
import { diagramRoute, entityRoute, lifelineRoute, messageRoute, type SandboxEntityKind } from './sandbox-routes.helpers';
import { applyBatch, applyClone, applyImportContent, fitCodeBlocks, normalizeSchema, remapFile } from './sandbox-schema.helpers';

export { isSandboxId, SANDBOX_PREFIX, SandboxError } from './sandbox.helpers';

const STORAGE_PREFIX = 'dd-sandbox:';

/**
 * A browser-only stand-in for the projects API, used by the canvas guide's sandboxes:
 * every editor request for a `sandbox-…` project is answered here, and the project is
 * kept in sessionStorage. Nothing reaches the server or the database.
 */
@Injectable({ providedIn: 'root' })
export class SandboxBackendService {
   private readonly codeSizer = inject(CodeBlockSizer);
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
         schema: fitCodeBlocks(normalizeSchema(schema), (el) => this.codeSizer.size(el)),
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
   private ownerOf(kind: SandboxEntityKind, entityId: string): string | null {
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
      // Imports are checked by the shared file parser (as on the server), which drops
      // stray run colors instead of refusing the file.
      if (method !== 'GET' && seg[seg.length - 1] !== 'import-content' && seg[seg.length - 1] !== 'import') {
         assertColors(b);
      }

      // GET /images/:id is handled by the interceptor (blob response).
      if (seg[0] === 'projects' && isSandboxId(seg[1])) {
         return { body: this.projectRoute(method, seg[1], seg.slice(2), b) };
      }
      const entityRoutes: Record<string, SandboxEntityKind> = {
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
         const s = this.get(pid)!.schema;
         const res = entityRoute(s, method, kind, seg[1], seg.slice(2), b);
         this.save(pid);
         return { body: res };
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
            applyBatch(s, b);
            return done({ mutations: [] });
         case 'clone':
            applyClone(s, b);
            return done({ mutations: [] });
         case 'import-content':
            return done({ mutations: applyImportContent(p, b) });
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
            return done(diagramRoute(s, method, id, b));
         case 'lifelines':
            return done(lifelineRoute(s, method, id, sub, b));
         case 'messages':
            return done(messageRoute(s, method, id, sub, b));
      }
      throw new SandboxError(404, `Not available in a sandbox: ${method} ${rest.join('/')}`);
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
