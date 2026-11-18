import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { DomSanitizer, type SafeUrl } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import type { ProjectExportFile, SchemaModel } from '@devdesigner/shared';
import { buildDiagramSvg } from '../../../editor';
import type { Box } from '../../../editor';
import { ApiClientService } from '../../../../core/http/api-client.service';
import { SyncService } from '../../../../core/sync/sync.service';
import { IconComponent } from '../../../../shared/ui/components/icon/icon.component';
import { compareBounds, contentBoxes, diffSchemas, type DiffEntry } from './schema-diff';

export interface CompareDialogData {
   projectId: string;
   serverName: string;
}

interface Pane {
   title: string;
   image: SafeUrl;
   /** Highlights on this pane, in world coordinates. */
   marks: Array<{ key: string; side: DiffEntry['side']; box: Box }>;
}

/**
 * Side-by-side view of a project's two versions when it changed both on this computer
 * (offline) and on the server: both drawn at one scale with the differing items
 * outlined, a list of what differs, and the two ways out (use server / keep mine).
 */
@Component({
   selector: 'dd-compare-dialog',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [IconComponent],
   templateUrl: './compare-dialog.component.html',
   styleUrl: './compare-dialog.component.scss',
})
export class CompareDialogComponent {
   protected readonly data = inject<CompareDialogData>(MAT_DIALOG_DATA);
   private readonly ref = inject(MatDialogRef<CompareDialogComponent, 'server' | 'mine' | undefined>);
   private readonly api = inject(ApiClientService);
   private readonly sync = inject(SyncService);
   private readonly sanitizer = inject(DomSanitizer);

   protected readonly loading = signal(true);
   protected readonly busy = signal(false);
   protected readonly error = signal<string | null>(null);
   protected readonly entries = signal<DiffEntry[]>([]);
   protected readonly panes = signal<Pane[]>([]);
   /** The whole drawing's box; both panes share it so they line up. */
   private readonly frame = signal<Box>({ x0: 0, y0: 0, x1: 800, y1: 600 });
   /** The entry zoomed to (null = whole drawing). */
   protected readonly focus = signal<string | null>(null);

   /** The viewBox both panes show: the whole drawing, or the focused item (from either side). */
   protected readonly viewBox = computed(() => {
      const frame = this.frame();
      const entry = this.entries().find((e) => e.key === this.focus());
      const boxes = entry ? [entry.mineBox, entry.serverBox].filter((b): b is Box => !!b) : [];
      const box = boxes.length
         ? {
              x0: Math.min(...boxes.map((b) => b.x0)) - 80,
              y0: Math.min(...boxes.map((b) => b.y0)) - 80,
              x1: Math.max(...boxes.map((b) => b.x1)) + 80,
              y1: Math.max(...boxes.map((b) => b.y1)) + 80,
           }
         : frame;
      return `${box.x0 - frame.x0} ${box.y0 - frame.y0} ${box.x1 - box.x0} ${box.y1 - box.y0}`;
   });
   /** The full-size image's viewBox (the drawing is positioned inside the shared frame). */
   protected readonly frameSize = computed(() => {
      const f = this.frame();
      return { width: f.x1 - f.x0, height: f.y1 - f.y0 };
   });

   constructor() {
      void this.load();
   }

   private async load(): Promise<void> {
      try {
         const [mine, server] = await Promise.all([
            firstValueFrom(this.api.get<ProjectExportFile>(`/projects/${this.data.projectId}/export-file`)),
            this.sync.serverVersion(this.data.projectId),
         ]);
         const entries = diffSchemas(mine.schema, server.schema);
         const frame = compareBounds(entries, [...contentBoxes(mine.schema), ...contentBoxes(server.schema)]);
         this.frame.set(frame);
         this.entries.set(entries);
         this.panes.set([
            this.pane('On this computer', mine.schema, frame, entries, 'mine'),
            this.pane(`On ${this.data.serverName}`, server.schema, frame, entries, 'server'),
         ]);
      } catch (err) {
         this.error.set(describe(err));
      } finally {
         this.loading.set(false);
      }
   }

   private pane(title: string, schema: SchemaModel, frame: Box, entries: DiffEntry[], side: 'mine' | 'server'): Pane {
      const crop = { x: frame.x0, y: frame.y0, width: frame.x1 - frame.x0, height: frame.y1 - frame.y0 };
      const { svg } = buildDiagramSvg(
         schema.tables,
         schema.relationships,
         schema.elements,
         { diagrams: schema.sequenceDiagrams, lifelines: schema.lifelines, messages: schema.sequenceMessages },
         crop
      );
      // As an <img>: the drawing is shown, never run (no scripts, no external loads).
      const image = this.sanitizer.bypassSecurityTrustUrl(
         `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
      );
      const marks = entries
         .map((e) => ({ key: e.key, side: e.side, box: side === 'mine' ? e.mineBox : e.serverBox }))
         .filter((m): m is Pane['marks'][number] => !!m.box);
      return { title, image, marks };
   }

   protected toggleFocus(key: string): void {
      this.focus.set(this.focus() === key ? null : key);
   }

   /** A highlight's rectangle in the shared frame's coordinates. */
   protected rect(box: Box): { x: number; y: number; width: number; height: number } {
      const f = this.frame();
      return { x: box.x0 - f.x0 - 6, y: box.y0 - f.y0 - 6, width: box.x1 - box.x0 + 12, height: box.y1 - box.y0 + 12 };
   }

   protected async choose(keep: 'server' | 'mine'): Promise<void> {
      this.busy.set(true);
      this.error.set(null);
      try {
         await this.sync.resolve(this.data.projectId, keep);
         this.ref.close(keep);
      } catch (err) {
         this.error.set(describe(err));
      } finally {
         this.busy.set(false);
      }
   }

   protected close(): void {
      this.ref.close();
   }
}

function describe(err: unknown): string {
   return err instanceof HttpErrorResponse ? (err.error?.message ?? err.message) : (err as Error).message;
}
