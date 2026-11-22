import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import {
   BUILT_IN_DESIGNS,
   BUILT_IN_LAYOUT_SETS,
   BUILT_IN_THEMES,
   DEFAULT_DESIGN,
   DEFAULT_LAYOUT_SET,
   DEFAULT_THEME,
   isBuiltInRecord,
   parseThemeFile,
   presentationOf,
   recordKind,
   themeFile,
   themeTokensOnly,
   tokenOf,
   type CanvasElementModel,
   type FontFamily,
   type ParsedThemeFile,
   type SlideTheme,
   type ThemeColorToken,
   type ThemeFilePart,
   type ThemeFontToken,
} from '@devdesigner/shared';
import { UserThemesService } from '../../../../../core/theme/user-themes.service';
import type { SelectOption } from '../../../../../shared/ui/components/select/select.component';
import { ProjectStore } from '../../../state/project/project.store';
import { ensureFontLoaded, fitTextElement } from '../../../helpers/text-metrics';
import { applyLayoutSet, captureLayoutSet, deckLayouts, isForeignLayout } from '../helpers/standard-layouts';

type LayoutContent = ReturnType<typeof captureLayoutSet>;
type Store = InstanceType<typeof ProjectStore>;

/** How long after our own design switch layout changes count as its follow-ups (saves, refits). */
const SETTLE_MS = 2500;
/** Debounce between a layout edit and saving it into the design's layout set. */
const SAVE_DEBOUNCE_MS = 800;

/**
 * What counts as an edit of a deck's layouts. A text box's height (and a non-wrapping
 * one's width) follows from its text and font, and is refitted on its own when fonts
 * load or the theme changes: that is not an edit and must not fork a built-in design.
 */
export function layoutEditSignature(content: Pick<SlideTheme, 'layouts' | 'extraLayouts' | 'master'>): string {
   return JSON.stringify(content, function (this: Record<string, unknown>, key, value) {
      if (this && this['kind'] === 'element') {
         const el = this['el'] as { type?: string; wrap?: boolean } | undefined;
         if (el?.type === 'text' && (key === 'h' || (key === 'w' && !el.wrap))) return undefined;
      }
      return value;
   });
}

/**
 * Designs, themes and layout sets of one deck, plus the saving of layout edits into the
 * design's layout set. One instance per deck (see DeckLayoutSyncService), shared by every
 * slides-panel part of that deck, so a deck's layouts are watched and saved exactly once
 * however many panels are mounted (perf P2.6).
 */
export class DeckDesign {
   /** Feedback from design, theme and layout actions. */
   readonly themeNote = signal<string | null>(null);
   /** Shown after a switch that kept layouts slides still use. */
   readonly relayoutNote = signal<string | null>(null);

   /** The deck's design and layout set, as its frames record them. */
   private readonly deckRefs = computed(() => {
      const name = this.name;
      // Prefer a frame that records the design: frames added later may carry only the theme.
      const mine = this.store.slideFrames().filter((f) => presentationOf(f) === name && f.slide?.theme);
      const t = (mine.find((f) => f.slide!.theme!.designId) ?? mine[0])?.slide?.theme;
      return { designId: t?.designId, layoutsId: t?.layoutsId };
   });
   /** The deck's design (Default until another is picked). */
   readonly design = computed<SlideTheme>(() => {
      const d = this.sync.record(this.deckRefs().designId);
      return d && recordKind(d) === 'design' ? d : DEFAULT_DESIGN;
   });
   readonly designIsCustom = computed(() => !isBuiltInRecord(this.design().id));
   /** The deck's layout set. */
   readonly layoutSetId = computed(
      () => this.deckRefs().layoutsId ?? this.design().layoutsId ?? DEFAULT_LAYOUT_SET.id!
   );
   readonly layoutSet = computed<SlideTheme>(() => this.sync.record(this.layoutSetId()) ?? DEFAULT_LAYOUT_SET);
   /** The deck's selected theme (the default until one is picked). */
   readonly deckTheme = computed<SlideTheme>(() => {
      const stored = this.store.presentationThemes().get(this.name) ?? DEFAULT_THEME;
      const rec = this.sync.record(stored.id);
      return rec && recordKind(rec) === 'theme' ? themeTokensOnly(rec) : themeTokensOnly(stored);
   });
   readonly themeIsCustom = computed(() => {
      const id = this.deckTheme().id;
      return !!id && !isBuiltInRecord(id) && this.sync.library().some((r) => r.id === id);
   });
   readonly themeOptions = computed<SelectOption<string>[]>(() => {
      const opts = [...this.sync.themeOptions()];
      const cur = this.deckTheme();
      if (cur.id && !opts.some((o) => o.value === cur.id))
         opts.push({ value: cur.id, label: cur.name, group: 'Custom' });
      return opts;
   });

   // ---- Layout-edit tracking ----
   /** Design switches in flight; while > 0, layout changes are part of the switch, not edits. */
   private applyingCount = 0;
   /** Until when changes to the layouts are follow-ups of our own switch (saves, refits). */
   private settleUntil = 0;
   /** The deck's layouts as last saved (or first seen), keyed by layout set. */
   private baseline: { key: string; sig: string } | null = null;
   /** Panels of this deck currently mounted (the deck is watched while > 0). */
   refs = 0;
   /** Deck-wide design/theme operations run one at a time (a second one waits its turn). */
   private chain: Promise<unknown> = Promise.resolve();
   /** The design last asked for while a pick was running: only the latest one is applied. */
   private wantedDesign: string | null = null;
   private picking = false;

   private serial<T>(fn: () => Promise<T>): Promise<T> {
      const run = this.chain.then(fn, fn);
      this.chain = run.catch(() => undefined);
      return run;
   }

   constructor(
      readonly name: string,
      private readonly store: Store,
      private readonly sync: DeckLayoutSyncService
   ) {}

   private get canEdit(): boolean {
      return this.store.canEdit();
   }

   /** A layout from a layout set the deck no longer uses, kept because slides still use it. */
   foreign(l: CanvasElementModel): boolean {
      return isForeignLayout(l, this.layoutSetId());
   }

   // ---- Switching designs and themes ----

   /**
    * Put the deck on a design: its layout set's layouts and the given theme. Resolves to
    * the id of the layout to keep editing when `editing` (the layout on the canvas) was
    * replaced by the new set's copy.
    */
   async switchTo(design: SlideTheme, set: SlideTheme, theme: SlideTheme, editing: string | null = null) {
      if (!this.canEdit) return null;
      const fromSetId = this.layoutSetId();
      const from = this.deckTheme();
      let focus: string | null = null;
      await this.loadFonts(theme);
      await this.applying(() =>
         this.store.batchHistory(async () => {
            const frames = await this.stamp(theme, design.id!, set.id!);
            if (set.id !== fromSetId) {
               const { kept, replaced } = await applyLayoutSet(this.store, this.name, fromSetId, set, theme);
               focus = (editing && replaced.get(editing)) || null;
               this.relayoutNote.set(
                  kept
                     ? `${kept} layout${kept > 1 ? 's' : ''} not in this design ${kept > 1 ? 'are' : 'is'} kept for the slides that use ${kept > 1 ? 'them' : 'it'} (flagged).`
                     : null
               );
            }
            if (fontsDiffer(from, theme)) await this.refitText(frames);
         })
      );
      this.rebaseline();
      return focus;
   }

   /**
    * Switch to design `id`. Picks made while a switch is running (focus mode's menu stays
    * open) wait for it, and only the latest of them is applied: two switches interleaving
    * would add layout items to frames the other one deletes.
    */
   async pickDesign(id: string, editing: string | null): Promise<string | null> {
      this.wantedDesign = id;
      if (this.picking) return null;
      this.picking = true;
      let focus: string | null = null;
      try {
         while (this.wantedDesign) {
            const next = this.wantedDesign;
            this.wantedDesign = null;
            focus = (await this.serial(() => this.pickDesignNow(next, editing))) ?? focus;
         }
      } finally {
         this.picking = false;
      }
      return focus;
   }

   private async pickDesignNow(id: string, editing: string | null): Promise<string | null> {
      if (id === this.design().id) return null;
      const target = this.sync.record(id);
      if (!target) return null;
      this.themeNote.set(null);
      await this.flushLayouts();
      const set = this.sync.record(target.layoutsId) ?? DEFAULT_LAYOUT_SET;
      const theme = this.sync.record(target.themeId) ?? DEFAULT_THEME;
      return this.switchTo(target, set, themeTokensOnly(theme), editing);
   }

   /** New design: a copy of this one (its layouts and theme) to change freely. */
   newDesign(): Promise<void> {
      return this.serial(() => this.newDesignNow());
   }

   private async newDesignNow(): Promise<void> {
      if (!this.canEdit) return;
      await this.flushLayouts();
      const d = this.design();
      const cur = this.deckTheme();
      const designName = this.sync.freshName(`${d.name} copy`);
      const theme: SlideTheme = {
         ...cur,
         kind: 'theme',
         id: newId(),
         name: this.sync.freshName(`${cur.name} copy`),
      };
      const set = layoutsRecord(`${designName} layouts`, captureLayoutSet(this.store, this.name, this.layoutSetId()));
      const design = designRecord(designName, theme.id, set.id!);
      await this.saveRecords([theme, set, design]);
      await this.store.batchHistory(async () => {
         await this.retagLayouts(set.id!, false);
         await this.stamp(theme, design.id!, set.id!);
      });
      this.rebaseline();
   }

   /** Delete the deck's custom design; the deck moves to the design above it in the list (or below). */
   deleteDesign(editing: string | null): Promise<string | null> {
      return this.serial(() => this.deleteDesignNow(editing));
   }

   private async deleteDesignNow(editing: string | null): Promise<string | null> {
      const d = this.design();
      if (!this.designIsCustom() || !this.canEdit) return null;
      this.sync.cancelPendingSave();
      const setId = this.layoutSetId();
      const nextId = neighborOf(this.sync.designOptions(), d.id!);
      const next = (nextId && this.sync.record(nextId)) || DEFAULT_DESIGN;
      let focus: string | null;
      if (next === DEFAULT_DESIGN) {
         focus = await this.switchTo(DEFAULT_DESIGN, DEFAULT_LAYOUT_SET, this.deckTheme(), editing);
      } else {
         const set = this.sync.record(next.layoutsId) ?? DEFAULT_LAYOUT_SET;
         const theme = this.sync.record(next.themeId) ?? DEFAULT_THEME;
         focus = await this.switchTo(next, set, themeTokensOnly(theme), editing);
      }
      await this.saveRecords([], [d.id!, ...(this.sync.setInUse(setId, d.id!) ? [] : [setId])]);
      this.themeNote.set(`Deleted "${d.name}".`);
      return focus;
   }

   /** Delete any custom design (and its layout set when nothing else uses it). */
   deleteDesignById(id: string, editing: string | null): Promise<string | null> {
      return this.serial(() => this.deleteDesignByIdNow(id, editing));
   }

   private async deleteDesignByIdNow(id: string, editing: string | null): Promise<string | null> {
      if (!this.canEdit || isBuiltInRecord(id)) return null;
      if (id === this.design().id) return this.deleteDesign(editing);
      const rec = this.sync.record(id);
      if (!rec) return null;
      const setId = rec.layoutsId;
      await this.saveRecords([], [id, ...(!setId || this.sync.setInUse(setId, id) ? [] : [setId])]);
      this.themeNote.set(`Deleted "${rec.name}".`);
      return null;
   }

   /** Select a theme for the design (a custom design remembers it). */
   pickTheme(id: string): Promise<void> {
      return this.serial(() => this.pickThemeNow(id));
   }

   private async pickThemeNow(id: string): Promise<void> {
      if (id === this.deckTheme().id) return;
      const rec = this.sync.record(id);
      if (!rec) return;
      const d = this.design();
      if (this.designIsCustom()) await this.saveRecords([{ ...d, themeId: id }]);
      await this.writeTheme(themeTokensOnly(rec), d.id!);
   }

   /** Delete any custom theme (the deck's own one moves to its neighbour first). */
   async deleteThemeById(id: string): Promise<void> {
      if (!this.canEdit || isBuiltInRecord(id)) return;
      if (id === this.deckTheme().id) return this.deleteTheme();
      await this.saveRecords([], [id]);
   }

   /** Delete the selected custom theme; the deck takes the theme above it in the list (or below). */
   async deleteTheme(): Promise<void> {
      const t = this.deckTheme();
      if (!this.themeIsCustom() || !this.canEdit) return;
      await this.pickTheme(neighborOf(this.themeOptions(), t.id!) ?? DEFAULT_THEME.id!);
      await this.saveRecords([], [t.id!]);
   }

   setThemeColor(token: ThemeColorToken, color: string): Promise<void> {
      return this.editTheme({ colors: { ...this.deckTheme().colors, [token]: color } });
   }

   setThemeFont(token: ThemeFontToken, font: string): Promise<void> {
      return this.editTheme({ fonts: { ...this.deckTheme().fonts, [token]: font } });
   }

   /** Rename a custom design or theme (from the pencil in its dropdown). */
   async renameRecord(id: string, name: string): Promise<void> {
      const rec = this.sync.library().find((r) => r.id === id);
      if (!rec || isBuiltInRecord(id) || !this.canEdit) return;
      const renamed = { ...rec, name };
      await this.saveRecords([renamed]);
      // Slides carry their theme's name too: keep it in step.
      if (recordKind(rec) === 'theme' && this.deckTheme().id === id) {
         await this.writeTheme(themeTokensOnly(renamed), this.design().id!, true);
      }
   }

   /**
    * Change the theme's colors, fonts or name. A built-in theme is copied into a custom one,
    * and a built-in design into a custom design using it, so the defaults never change.
    */
   private async editTheme(patch: Partial<SlideTheme>): Promise<void> {
      if (!this.canEdit) return;
      const cur = this.deckTheme();
      const custom = this.themeIsCustom();
      const theme: SlideTheme = custom
         ? { ...cur, kind: 'theme', ...patch }
         : { ...cur, kind: 'theme', id: newId(), name: this.sync.freshName(`${cur.name} custom`), ...patch };
      const upserts: SlideTheme[] = [theme];
      let design = this.design();
      if (!this.designIsCustom()) {
         design = designRecord(this.sync.freshName(`${design.name} custom`), theme.id, this.layoutSetId());
         upserts.push(design);
         this.themeNote.set(`Saved your changes as "${design.name}".`);
      } else if (design.themeId !== theme.id) {
         design = { ...design, themeId: theme.id };
         upserts.push(design);
      }
      await this.saveRecords(upserts);
      await this.writeTheme(theme, design.id!, custom);
   }

   /** Put a theme's colors and fonts on the deck (and on other decks using it, when it was edited). */
   private async writeTheme(theme: SlideTheme, designId: string, everywhere = false): Promise<void> {
      if (!this.canEdit) return;
      const from = this.deckTheme();
      await this.loadFonts(theme);
      // Refitting text to the new fonts resizes the layouts' placeholders: that is this
      // switch, not an edit of the layouts (which would save a custom copy of the design).
      await this.applying(() =>
         this.store.batchHistory(async () => {
            const frames = await this.stamp(theme, designId, this.layoutSetId(), everywhere);
            if (fontsDiffer(from, theme)) await this.refitText(frames);
         })
      );
      this.rebaseline();
   }

   // ---- Files ----

   /** Download the design (layouts and theme), just its layouts, or just its theme. */
   exportDesign(part: ThemeFilePart): void {
      const d = this.design();
      const set = this.layoutSet();
      const layouts: SlideTheme = {
         ...themeTokensOnly(DEFAULT_THEME),
         kind: 'layouts',
         name: isBuiltInRecord(set.id) ? `${d.name} layouts` : set.name,
         ...captureLayoutSet(this.store, this.name, this.layoutSetId()),
      };
      const theme = this.deckTheme();
      const file = themeFile(part, { name: d.name, theme, layouts });
      const title = part === 'design' ? d.name : part === 'theme' ? theme.name : layouts.name;
      const suffix = part === 'theme' ? '.dbtheme' : part === 'layouts' ? '.dblayouts' : '.dbdesign';
      const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${title.replace(/[^\w .-]+/g, '_')}${suffix}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
   }

   /**
    * Read a file and use it: as a whole design (its layouts and theme become a new design),
    * as this design's layouts, or as a theme to select.
    */
   async importDesign(file: File, part: ThemeFilePart, editing: string | null): Promise<string | null> {
      if (!this.canEdit) return null;
      let parsed: ParsedThemeFile | string;
      try {
         parsed = parseThemeFile(JSON.parse(await file.text()));
      } catch {
         parsed = 'The file is not valid JSON.';
      }
      if (typeof parsed === 'string') {
         this.themeNote.set(parsed);
         return null;
      }
      await this.flushLayouts();
      if (part === 'theme') {
         if (!parsed.theme) {
            this.themeNote.set('The file has no theme.');
            return null;
         }
         const theme: SlideTheme = {
            ...parsed.theme,
            kind: 'theme',
            id: newId(),
            name: this.sync.freshName(parsed.theme.name),
         };
         await this.saveRecords([theme]);
         await this.pickTheme(theme.id!);
         this.themeNote.set(`Imported the theme "${theme.name}".`);
         return null;
      }
      if (part === 'layouts') {
         if (!parsed.layouts) {
            this.themeNote.set('The file has no layouts.');
            return null;
         }
         const set: SlideTheme = {
            ...parsed.layouts,
            kind: 'layouts',
            id: newId(),
            name: this.sync.freshName(parsed.layouts.name),
         };
         const design = this.designIsCustom()
            ? { ...this.design(), layoutsId: set.id }
            : designRecord(this.sync.freshName(`${this.design().name} custom`), this.deckTheme().id, set.id!);
         await this.saveRecords([set, design]);
         const focus = await this.switchTo(design, set, this.deckTheme(), editing);
         this.themeNote.set(`Imported the layouts "${set.name}".`);
         return focus;
      }
      const upserts: SlideTheme[] = [];
      let theme = this.deckTheme();
      if (parsed.theme) {
         theme = { ...parsed.theme, kind: 'theme', id: newId(), name: this.sync.freshName(parsed.theme.name) };
         upserts.push(theme);
      }
      let set = this.layoutSet();
      if (parsed.layouts) {
         set = { ...parsed.layouts, kind: 'layouts', id: newId(), name: this.sync.freshName(parsed.layouts.name) };
         upserts.push(set);
      }
      const design = designRecord(this.sync.freshName(parsed.name), theme.id, set.id!);
      upserts.push(design);
      await this.saveRecords(upserts);
      const focus = await this.switchTo(design, set, themeTokensOnly(theme), editing);
      this.themeNote.set(`Imported the design "${design.name}".`);
      return focus;
   }

   // ---- Layout edits: saved into the design's layout set ----

   private signature(): { key: string; sig: string; content: LayoutContent } {
      const setId = this.layoutSetId();
      const content = captureLayoutSet(this.store, this.name, setId);
      return { key: `${this.name}|${setId}`, sig: layoutEditSignature(content), content };
   }

   private rebaseline(): void {
      this.sync.cancelPendingSave();
      this.settleUntil = Date.now() + SETTLE_MS;
      const s = this.signature();
      this.baseline = { key: s.key, sig: s.sig };
   }

   /** Save pending layout edits now (before the deck switches design). */
   private async flushLayouts(): Promise<void> {
      this.sync.cancelPendingSave();
      await this.checkLayouts();
   }

   /** Save the deck's layouts into its layout set if they were edited since the last look. */
   async checkLayouts(): Promise<void> {
      if (this.applyingCount > 0 || !this.canEdit) return;
      const s = this.signature();
      if (!this.baseline || this.baseline.key !== s.key || Date.now() < this.settleUntil) {
         this.baseline = { key: s.key, sig: s.sig };
         return;
      }
      if (s.sig === this.baseline.sig) return;
      this.baseline.sig = s.sig;
      const set = this.layoutSet();
      if (!isBuiltInRecord(set.id)) {
         await this.saveRecords([{ ...set, ...s.content }]);
         return;
      }
      // The first edit to built-in layouts: they become a custom set (and design) of their own.
      const wasBuiltIn = !this.designIsCustom();
      let design = this.design();
      const fresh = layoutsRecord(
         this.sync.freshName(`${this.designIsCustom() ? design.name : `${design.name} custom`} layouts`),
         s.content
      );
      design = this.designIsCustom()
         ? { ...design, layoutsId: fresh.id }
         : designRecord(this.sync.freshName(`${design.name} custom`), this.deckTheme().id, fresh.id!);
      await this.saveRecords([fresh, design]);
      await this.applying(async () => {
         await this.retagLayouts(fresh.id!, true);
         await this.stamp(this.deckTheme(), design.id!, fresh.id!, false, true);
      });
      this.rebaseline();
      if (wasBuiltIn) this.themeNote.set(`Saved your changes as "${design.name}".`);
   }

   // ---- Helpers ----

   private async applying<T>(fn: () => Promise<T>): Promise<T> {
      this.applyingCount += 1;
      try {
         return await fn();
      } finally {
         this.applyingCount -= 1;
      }
   }

   private saveRecords(upserts: SlideTheme[], remove: string[] = []): Promise<void> {
      return this.sync.saveRecords(upserts, remove, (msg) => this.themeNote.set(msg));
   }

   /**
    * Store the theme and the deck's design and layout set on every frame of the deck.
    * `everywhere`: other decks on the same theme take its new colors and fonts (keeping
    * their own design).
    */
   private async stamp(
      theme: SlideTheme,
      designId: string,
      layoutsId: string,
      everywhere = false,
      silent = false
   ): Promise<string[]> {
      const tokens = themeTokensOnly(theme);
      const touched: string[] = [];
      for (const f of this.store.slideFrames()) {
         if (!f.slide) continue;
         let next: SlideTheme | null = null;
         if (presentationOf(f) === this.name) next = { ...tokens, designId, layoutsId };
         else if (everywhere && theme.id && f.slide.theme?.id === theme.id) {
            next = { ...tokens, designId: f.slide.theme.designId, layoutsId: f.slide.theme.layoutsId };
         }
         if (!next) continue;
         touched.push(f.id);
         const patch = { slide: { ...f.slide, theme: next } };
         if (silent) await this.store.patchElementSilently(f.id, patch);
         else await this.store.updateElement(f.id, patch);
      }
      return touched;
   }

   /** Hand the deck's current layouts over to the set `setId`. */
   private async retagLayouts(setId: string, silent: boolean): Promise<void> {
      for (const l of deckLayouts(this.store, this.name)) {
         if (l.slide?.master || this.foreign(l) || !l.slide?.layoutSetId) continue;
         const patch = { slide: { ...l.slide, layoutSetId: setId } };
         if (silent) await this.store.patchElementSilently(l.id, patch);
         else await this.store.updateElement(l.id, patch);
      }
   }

   /** Refit text boxes that use a theme font on these frames (fit-to-glyph boxes were sized for the old one). */
   private async refitText(frameIds: readonly string[]): Promise<void> {
      const ids = new Set(frameIds);
      for (const e of this.store.elements()) {
         if (e.type !== 'text' || !e.slideId || !ids.has(e.slideId) || !tokenOf(e.fontFamily)) continue;
         const size = fitTextElement(e);
         if (size.width !== e.width || size.height !== e.height) {
            await this.store.updateElement(e.id, { width: size.width, height: size.height });
         }
      }
   }

   private async loadFonts(theme: SlideTheme): Promise<void> {
      await Promise.all([
         ensureFontLoaded(theme.fonts.heading as FontFamily),
         ensureFontLoaded(theme.fonts.body as FontFamily),
      ]);
   }
}

/**
 * Per-editor registry of DeckDesign instances plus the state they share: the custom
 * design/theme library, and one debounced watcher that saves layout edits for every deck
 * with a mounted panel. Replaces the per-panel effects and module-level maps that each
 * of the (up to ten) mounted slides-panel parts used to run (perf P2.6).
 */
@Injectable()
export class DeckLayoutSyncService {
   private readonly store = inject(ProjectStore);
   private readonly userThemes = inject(UserThemesService);
   private readonly decks = new Map<string, DeckDesign>();
   /** Decks with at least one mounted panel. */
   private readonly attached = signal<readonly DeckDesign[]>([]);
   private saveTimer?: ReturnType<typeof setTimeout>;

   /** Every custom record: the project's, then the rest of My designs. */
   readonly library = computed<SlideTheme[]>(() => {
      const out = [...this.store.customThemes()];
      const ids = new Set(out.map((r) => r.id));
      for (const row of this.userThemes.themes()) if (!ids.has(row.theme.id)) out.push(row.theme);
      return out;
   });
   readonly designOptions = computed<SelectOption<string>[]>(() => [
      ...BUILT_IN_DESIGNS.map((d) => ({ value: d.id!, label: d.name, group: 'Built-in' })),
      ...this.library()
         .filter((r) => recordKind(r) === 'design' && r.id)
         .map((d) => ({ value: d.id!, label: d.name, group: 'Custom', renamable: this.store.canEdit() })),
   ]);
   readonly themeOptions = computed<SelectOption<string>[]>(() => [
      ...BUILT_IN_THEMES.map((t) => ({ value: t.id!, label: t.name, group: 'Built-in' })),
      ...this.library()
         .filter((r) => recordKind(r) === 'theme' && r.id)
         .map((t) => ({ value: t.id!, label: t.name, group: 'Custom', renamable: this.store.canEdit() })),
   ]);

   /** One watcher for all decks: a layout edit is saved 800 ms after the last change. */
   private readonly watchLayouts = effect(() => {
      this.store.elements();
      const decks = this.attached();
      for (const d of decks) d.layoutSetId();
      if (!decks.length || !this.store.canEdit()) return;
      untracked(() => {
         clearTimeout(this.saveTimer);
         this.saveTimer = setTimeout(() => {
            for (const d of this.attached()) void d.checkLayouts();
         }, SAVE_DEBOUNCE_MS);
      });
   });

   /** The deck named `name` (created on first use). */
   deck(name: string): DeckDesign {
      let d = this.decks.get(name);
      if (!d) {
         d = new DeckDesign(name, this.store, this);
         this.decks.set(name, d);
      }
      return d;
   }

   /** A mounted panel shows this deck: watch its layouts until the returned release is called. */
   attach(name: string): () => void {
      const d = this.deck(name);
      d.refs += 1;
      if (d.refs === 1) this.attached.update((list) => [...list, d]);
      let released = false;
      return () => {
         if (released) return;
         released = true;
         d.refs -= 1;
         if (d.refs === 0) this.attached.update((list) => list.filter((x) => x !== d));
      };
   }

   /** Load My designs (once the user opens anything that lists them). */
   loadLibrary(): void {
      void this.userThemes.load();
   }

   cancelPendingSave(): void {
      clearTimeout(this.saveTimer);
   }

   record(id: string | undefined): SlideTheme | undefined {
      if (!id) return undefined;
      return (
         [...BUILT_IN_THEMES, ...BUILT_IN_LAYOUT_SETS, ...BUILT_IN_DESIGNS].find((r) => r.id === id) ??
         this.library().find((r) => r.id === id)
      );
   }

   /** A name not yet used by a custom record. */
   freshName(base: string): string {
      const names = new Set(this.library().map((c) => c.name));
      let name = base;
      for (let n = 2; names.has(name); n++) name = `${base} ${n}`;
      return name;
   }

   /** Whether a layout set must be kept: built in, or used by a design other than `exceptDesign`. */
   setInUse(setId: string, exceptDesign: string): boolean {
      return (
         isBuiltInRecord(setId) ||
         this.library().some((r) => r.id !== exceptDesign && recordKind(r) === 'design' && r.layoutsId === setId)
      );
   }

   /** Add or replace custom records (by id) in the project and My designs, and drop `remove`. */
   async saveRecords(upserts: SlideTheme[], remove: string[], onError: (msg: string) => void): Promise<void> {
      const ids = new Set([...upserts.map((u) => u.id), ...remove]);
      await this.store.setCustomThemes([...this.store.customThemes().filter((c) => !ids.has(c.id)), ...upserts]);
      for (const u of upserts) {
         this.userThemes.save(u).catch(() => onError('Could not save to My designs.'));
      }
      for (const id of remove) {
         const row = this.userThemes.themes().find((t) => t.theme.id === id);
         if (row) void this.userThemes.remove(row.id);
      }
   }
}

function newId(): string {
   return `custom-${crypto.randomUUID()}`;
}

function fontsDiffer(a: SlideTheme, b: SlideTheme): boolean {
   return a.fonts.heading !== b.fonts.heading || a.fonts.body !== b.fonts.body;
}

/** The option above `id` in a dropdown list, or the one below when it is first. */
function neighborOf(opts: SelectOption<string>[], id: string): string | undefined {
   const i = opts.findIndex((o) => o.value === id);
   if (i < 0) return undefined;
   return (opts[i - 1] ?? opts[i + 1])?.value;
}

function designRecord(name: string, themeId: string | undefined, layoutsId: string): SlideTheme {
   return { ...themeTokensOnly(DEFAULT_THEME), kind: 'design', id: newId(), name, themeId, layoutsId };
}

function layoutsRecord(name: string, content: LayoutContent): SlideTheme {
   return { ...themeTokensOnly(DEFAULT_THEME), kind: 'layouts', id: newId(), name, ...content };
}
