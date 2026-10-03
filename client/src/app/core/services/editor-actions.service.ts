import { Injectable, signal } from '@angular/core';
import type { ExportImageFormat } from '../../features/editor/canvas/models/toolbar-actions';

/** Callbacks the editor registers so app-level chrome (the top bar) can invoke
 *  editor-scoped actions (Export, Share) that depend on canvas-local state. */
export interface EditorActionHandlers {
  share: () => void;
  exportSql: () => void;
  exportImage: (format: ExportImageFormat) => void;
}

/**
 * Bridge between the mounted editor and the global top bar. The editor registers
 * its Export/Share handlers on init and clears them on destroy; the top bar reads
 * `active()` to know an editor is present and calls the handlers. Undo/redo,
 * project id and access mode already live on the root `ProjectStore`, so the top
 * bar reads those directly — only these canvas-dependent actions need bridging.
 */
@Injectable({ providedIn: 'root' })
export class EditorActionsService {
  /** True while an editor is mounted with a project loaded. */
  readonly active = signal(false);
  private handlers: EditorActionHandlers | null = null;

  register(handlers: EditorActionHandlers): void {
    this.handlers = handlers;
    this.active.set(true);
  }

  clear(): void {
    this.handlers = null;
    this.active.set(false);
  }

  share(): void {
    this.handlers?.share();
  }
  exportSql(): void {
    this.handlers?.exportSql();
  }
  exportImage(format: ExportImageFormat): void {
    this.handlers?.exportImage(format);
  }
}
