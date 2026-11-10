import { Injectable, type Signal, signal } from '@angular/core';
import type { ExportImageFormat } from '../../features/editor/canvas/models/toolbar-actions';
import { proxySignal } from '../../shared/helpers/signals';

/** Callbacks the editor registers so app-level chrome (the top bar) can invoke
 *  editor-scoped actions (Export, Share) that depend on canvas-local state. */
export interface EditorActionHandlers {
   share: () => void;
   exportSql: () => void;
   exportImage: (format: ExportImageFormat) => void;
   exportFramesPdf: () => void;
   exportSlidesPdf: () => void;
   exportSelectionFile: () => void;
   importFile: (file: unknown) => Promise<number>;
   deleteSelection: () => void;
   focusDeck: (name: string) => void;
   enterDeckFocus: (name: string) => void;
   exitDeckFocus: () => void;
   jumpToParticipant: (participantId: string) => void;
   followParticipant: (participantId: string | null) => void;
   addFrameToPresentation: (frameId: string, deck: string | null) => void;
   exportFrame: (frameId: string, format: 'png' | 'svg' | 'pdf') => void;
   presentDeck: (name: string) => void;
   followPresenter: (participantId: string) => void;
   newDeck: () => void;
   setTool: (tool: string) => void;
   resetView: () => void;
   setHome: () => void;
   canvasItems: () => CanvasItemRef[];
   jumpTo: (item: CanvasItemRef) => void;
}

/** Something on the canvas the command palette can jump to. */
export interface CanvasItemRef {
   kind: 'table' | 'code' | 'text' | 'frame' | 'sequence';
   id: string;
   label: string;
}

/** One presentation in the project, for the top-right Presentations menu. */
export interface DeckSummary {
   name: string;
   slides: number;
   /** Someone else presenting this deck right now (offer Follow). */
   presenter: { id: string; name: string; color: string } | null;
}

/** The editor-owned signals the app chrome reads through `EditorActionsService`. */
export interface EditorStateSources {
   canExportSql: Signal<boolean>;
   hasTableSelection: Signal<boolean>;
   hasSelection: Signal<boolean>;
   presentationName: Signal<string | null>;
   hasPlainFrames: Signal<boolean>;
   decks: Signal<DeckSummary[]>;
   focusedDeck: Signal<string | null>;
   following: Signal<string | null>;
}

/**
 * Bridge between the mounted editor and the global top bar. The editor registers
 * its Export/Share handlers and its state signals (proxies) on init and clears them
 * on destroy; the top bar reads `active()` to know an editor is present and calls
 * the handlers. Undo/redo, project id and access mode already live on the root
 * `ProjectStore`, so the top bar reads those directly — only canvas-dependent
 * actions and state need bridging.
 */
@Injectable({ providedIn: 'root' })
export class EditorActionsService {
   /** True while an editor is mounted with a project loaded. */
   readonly active = signal(false);
   /** False when the tables in the export scope share a name (SQL would be invalid). */
   readonly canExportSql = proxySignal(true);
   /** True when at least one table is selected (SQL export is offered only then). */
   readonly hasTableSelection = proxySignal(false);
   /** True when anything (table, shape, sequence part) is selected. */
   readonly hasSelection = proxySignal(false);
   /** The selected presentation's name, or null when the project has no slides. */
   readonly presentationName = proxySignal<string | null>(null);
   /** True when the project has frames that are not slides. */
   readonly hasPlainFrames = proxySignal(false);
   /** Every presentation in the open project. */
   readonly decks = proxySignal<DeckSummary[]>([]);
   /** The presentation open in focus mode (app chrome steps aside for the deck bars), or null. */
   readonly focusedDeck = proxySignal<string | null>(null);
   /** The collaborator whose cursor the canvas is following, or null. */
   readonly following = proxySignal<string | null>(null);
   private handlers: EditorActionHandlers | null = null;

   register(handlers: EditorActionHandlers): void {
      this.handlers = handlers;
      this.active.set(true);
   }

   /** Point the chrome's state signals at the mounted editor's (until `clear()`). */
   registerState(state: EditorStateSources): void {
      this.canExportSql.register(state.canExportSql);
      this.hasTableSelection.register(state.hasTableSelection);
      this.hasSelection.register(state.hasSelection);
      this.presentationName.register(state.presentationName);
      this.hasPlainFrames.register(state.hasPlainFrames);
      this.decks.register(state.decks);
      this.focusedDeck.register(state.focusedDeck);
      this.following.register(state.following);
   }

   clear(): void {
      this.handlers = null;
      this.canExportSql.reset();
      this.hasTableSelection.reset();
      this.hasSelection.reset();
      this.presentationName.reset();
      this.hasPlainFrames.reset();
      this.decks.reset();
      this.focusedDeck.reset();
      this.following.reset();
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
   deleteSelection(): void {
      this.handlers?.deleteSelection();
   }
   /** Merge an export file into the open project; resolves with the number of items added. */
   importFile(file: unknown): Promise<number> {
      return this.handlers?.importFile(file) ?? Promise.reject(new Error('No project is open.'));
   }
   exportSelectionFile(): void {
      this.handlers?.exportSelectionFile();
   }
   exportFramesPdf(): void {
      this.handlers?.exportFramesPdf();
   }
   exportSlidesPdf(): void {
      this.handlers?.exportSlidesPdf();
   }
   focusDeck(name: string): void {
      this.handlers?.focusDeck(name);
   }
   enterDeckFocus(name: string): void {
      this.handlers?.enterDeckFocus(name);
   }
   exitDeckFocus(): void {
      this.handlers?.exitDeckFocus();
   }
   addFrameToPresentation(frameId: string, deck: string | null): void {
      this.handlers?.addFrameToPresentation(frameId, deck);
   }
   exportFrame(frameId: string, format: 'png' | 'svg' | 'pdf'): void {
      this.handlers?.exportFrame(frameId, format);
   }
   jumpToParticipant(participantId: string): void {
      this.handlers?.jumpToParticipant(participantId);
   }
   followParticipant(participantId: string | null): void {
      this.handlers?.followParticipant(participantId);
   }
   presentDeck(name: string): void {
      this.handlers?.presentDeck(name);
   }
   followPresenter(participantId: string): void {
      this.handlers?.followPresenter(participantId);
   }
   newDeck(): void {
      this.handlers?.newDeck();
   }
   setTool(tool: string): void {
      this.handlers?.setTool(tool);
   }
   resetView(): void {
      this.handlers?.resetView();
   }
   setHome(): void {
      this.handlers?.setHome();
   }
   canvasItems(): CanvasItemRef[] {
      return this.handlers?.canvasItems() ?? [];
   }
   jumpTo(item: CanvasItemRef): void {
      this.handlers?.jumpTo(item);
   }
}
