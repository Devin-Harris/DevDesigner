import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
   DIRECTIONAL_EFFECTS,
   SLIDE_ANIMATION_EFFECTS_BY_KIND,
   animationParts,
   defaultAnimations,
   effectFor,
   isDiffAnimation,
   moveAnimationBlock,
   moveAnimationCard,
   newAnimation,
   normalizeAnimations,
   paragraphOfPart,
   slideAnimations,
   toBlocks,
   type AnimationSource,
   type CanvasElementModel,
   type CardDrop,
   type SlideAnimation,
   type SlideAnimationEffect,
   type SlideAnimationKind,
   type SlideAnimationStagger,
   type SlideAnimationTrigger,
   type SlideDirection,
} from '@devdesigner/shared';
import { IconComponent } from '../../../../../../../../shared/ui/components/icon/icon.component';
import {
   SelectComponent,
   type SelectOption,
} from '../../../../../../../../shared/ui/components/select/select.component';
import { ProjectStore } from '../../../../../../state/project/project.store';
import { contentForFrame } from '../../../../../../helpers/frame-contents.helper';
import { slideAnimationSource } from '../../../../helpers/animation-source.helper';
import { CallPipe, HasPipe } from '../../../../../../../../shared/ui/pipes/collection.pipes';

const KIND_OPTIONS: SelectOption<SlideAnimationKind>[] = [
   { value: 'enter', label: 'Entrance' },
   { value: 'exit', label: 'Exit' },
   { value: 'emphasis', label: 'Emphasis' },
];

/** Start of the first animation of the first block. */
const FIRST_START_OPTIONS: SelectOption<SlideAnimationTrigger>[] = [
   { value: 'click', label: 'On click' },
   { value: 'with', label: 'When the slide appears' },
];

/** Start of any other animation: its own click (a new group), or with / after the one before (joins its group). */
const FOLLOW_START_OPTIONS: SelectOption<SlideAnimationTrigger>[] = [
   { value: 'click', label: 'On click' },
   { value: 'with', label: 'With previous' },
   { value: 'after', label: 'After previous' },
];

const DIRECTION_OPTIONS: SelectOption<SlideDirection>[] = [
   { value: 'left', label: 'From the left' },
   { value: 'right', label: 'From the right' },
   { value: 'up', label: 'From the top' },
   { value: 'down', label: 'From the bottom' },
];

const EXIT_DIRECTION_OPTIONS: SelectOption<SlideDirection>[] = [
   { value: 'left', label: 'To the left' },
   { value: 'right', label: 'To the right' },
   { value: 'up', label: 'To the top' },
   { value: 'down', label: 'To the bottom' },
];

const STAGGER_OPTIONS: SelectOption<SlideAnimationTrigger>[] = [
   { value: 'click', label: 'On each click' },
   { value: 'with', label: 'Automatically' },
];

const EFFECT_NAMES: Record<SlideAnimationKind, Record<SlideAnimationEffect, string>> = {
   enter: {
      appear: 'Appear',
      fade: 'Fade in',
      fly: 'Fly in',
      wipe: 'Wipe in',
      zoom: 'Zoom in',
      pulse: 'Pulse',
      morph: 'Show diff',
   },
   exit: {
      appear: 'Disappear',
      fade: 'Fade out',
      fly: 'Fly out',
      wipe: 'Wipe out',
      zoom: 'Zoom out',
      pulse: 'Pulse',
      morph: 'Hide diff',
   },
   emphasis: { appear: 'Appear', fade: 'Fade', fly: 'Fly', wipe: 'Wipe', zoom: 'Zoom', pulse: 'Pulse', morph: 'Morph' },
};

const TYPE_NAMES: Record<string, string> = {
   rectangle: 'Rectangle',
   ellipse: 'Ellipse',
   diamond: 'Diamond',
   triangle: 'Triangle',
   line: 'Line',
   arrow: 'Arrow',
   freedraw: 'Drawing',
   text: 'Text',
   image: 'Image',
   code: 'Code',
};

const EMPTY: ReadonlySet<string> = new Set();

/** Default gap (ms) between pieces played one by one automatically. */
const STAGGER_GAP = 100;

interface Target {
   label: string;
   kind: 'element' | 'table' | 'diagram';
   x: number;
   y: number;
}

/** One card: an animation with what the list shows about it. */
interface Row {
   animation: SlideAnimation;
   target: Target | null;
   /** Pieces it plays one by one (0 = whole object). */
   pieces: number;
   /** An automatic animation not yet saved in the slide's list. */
   auto: boolean;
   /** Label of the piece it animates (a single paragraph / message), else ''. */
   piece: string;
   /** Position inside its block. */
   index: number;
}

interface BlockView {
   auto: boolean;
   rows: Row[];
}

/** What is being dragged: one card (by animation id) or a whole block (by index). */
type Drag = { kind: 'card'; id: string } | { kind: 'block'; index: number };
/** Where it would land: inside a block at an index, or in the gap before block `index`. */
type Drop = { type: 'card'; block: number; index: number } | { type: 'gap'; index: number };

/**
 * The animations of one slide as blocks: each block is one click (the first may play when
 * the slide appears) and holds cards that start together or one after another. Cards open
 * to edit their effect and timing; cards and whole blocks drag by their grips. Edits are
 * ordinary slide updates, so they sync live and undo like any other change.
 */
@Component({
   selector: 'dd-animation-pane',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [HasPipe, CallPipe, FormsModule, IconComponent, SelectComponent],
   templateUrl: './animation-pane.component.html',
   styleUrl: './animation-pane.component.scss',
})
export class AnimationPaneComponent {
   /** The slide (frame) whose animations are listed. */
   readonly slide = input.required<CanvasElementModel>();
   /** The larger Refine screen: also lists each piece of a one-by-one animation (to group them). */
   readonly refine = input(false);
   /** Rows playing in the step a preview elsewhere shows (the Refine screen's). */
   readonly highlight = input<ReadonlySet<string> | null>(null);
   /** Open the Refine screen (shown in the compact pane only). */
   readonly openRefine = output<void>();

   private readonly store = inject(ProjectStore);
   private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

   protected readonly canEdit$ = this.store.canEdit;
   protected readonly refine$ = computed(() => this.refine());
   protected readonly kindOptions = KIND_OPTIONS;
   protected readonly firstStartOptions = FIRST_START_OPTIONS;
   protected readonly followStartOptions = FOLLOW_START_OPTIONS;
   protected readonly directions = DIRECTION_OPTIONS;
   protected readonly exitDirections = EXIT_DIRECTION_OPTIONS;
   protected readonly staggerOptions = STAGGER_OPTIONS;
   protected readonly effectFor = effectFor;

   private readonly selectedId_ = signal<string | null>(null);
   protected readonly highlight$ = computed(() => this.highlight() ?? EMPTY);

   // ---- what is on the slide ----

   /** What the slide owns (its objects plus their sequence parts); free canvas content never animates with it. */
   private readonly content = computed(() => {
      const id = this.slide().id;
      const c = contentForFrame(
         id,
         true,
         this.store.elements(),
         this.store.tables(),
         this.store.sequenceDiagrams(),
         this.store.lifelines(),
         this.store.sequenceMessages()
      );
      const diagrams = c.diagrams.filter((d) => d.slideId === id);
      const ids = new Set(diagrams.map((d) => d.id));
      return {
         elements: c.elements.filter((e) => e.slideId === id),
         tables: c.tables.filter((t) => t.slideId === id),
         diagrams,
         messages: c.messages.filter((m) => ids.has(m.diagramId)),
      };
   });

   /** The slide's objects as the animation logic reads them (pieces and automatic animations). */
   private readonly source = computed<AnimationSource>(() =>
      slideAnimationSource(this.slide(), {
         elements: this.store.elements(),
         diagrams: this.store.sequenceDiagrams(),
         messages: this.store.sequenceMessages(),
         slideFrames: this.store.slideFrames(),
      })
   );

   /** Each object's pieces in play order (text paragraphs, sequence messages). */
   private readonly parts = computed(() => animationParts(this.source()));

   /** What is on the slide, by id. */
   private readonly targets = computed(() => {
      const c = this.content();
      const out = new Map<string, Target>();
      for (const e of c.elements) {
         if (e.type === 'frame') {
            continue;
         }
         const text = (e.text ?? '').trim().replace(/\s+/g, ' ');
         out.set(e.id, {
            label: text ? text.slice(0, 32) : (TYPE_NAMES[e.type] ?? e.type),
            kind: 'element',
            x: e.x,
            y: e.y,
         });
      }
      for (const t of c.tables) {
         out.set(t.id, { label: t.name || 'Table', kind: 'table', x: t.x, y: t.y });
      }
      for (const d of c.diagrams) {
         out.set(d.id, { label: d.title?.trim() || 'Sequence diagram', kind: 'diagram', x: 0, y: d.originY });
      }
      return out;
   });

   /** The automatic animation each object would get (code diff reveal, message by message). */
   private readonly autoDefaults = computed(
      () => new Map(defaultAnimations([], undefined, this.source()).map((a) => [a.target, a]))
   );

   /**
    * The slide's animations in play order (derived from old build steps until first
    * edited), followed by the automatic ones (code diffs, sequence messages).
    */
   private readonly list = computed<SlideAnimation[]>(() =>
      slideAnimations(
         this.slide().slide,
         this.store.elements().filter((e) => e.slideId === this.slide().id && e.type !== 'frame'),
         this.source()
      )
   );

   protected readonly blocks$ = computed<BlockView[]>(() => {
      const targets = this.targets();
      const parts = this.parts();
      const saved = this.slide().slide?.animations ?? [];
      return toBlocks(this.list()).map((b) => ({
         auto: b.auto,
         rows: b.items.map((animation, index) => {
            const skip = new Set(animation.stagger?.skip ?? []);
            return {
               animation,
               target: targets.get(animation.target) ?? null,
               pieces:
                  animation.stagger && !animation.part
                     ? (parts.get(animation.target)?.filter((p) => !skip.has(p)).length ?? 0)
                     : 0,
               auto: animation.id.startsWith('auto-') && !saved.some((a) => a.id === animation.id),
               piece: animation.part ? this.pieceLabel(animation.target, animation.part) : '',
               index,
            };
         }),
      }));
   });

   /** Objects whose automatic animation is switched off. */
   protected readonly offTargets$ = computed(() => {
      const targets = this.targets();
      return (this.slide().slide?.animationsOff ?? []).flatMap((id) => {
         const t = targets.get(id);
         return t && this.autoDefaults().has(id) ? [{ id, label: t.label }] : [];
      });
   });

   /** Objects selected on the canvas that belong to this slide, in reading order. */
   protected readonly selectedTargets$ = computed(() => {
      const targets = this.targets();
      const ids = [
         ...this.store.selectedElementIds(),
         ...this.store.selectedTableIds(),
         ...this.store.selectedDiagramIds(),
      ].filter((id) => targets.has(id));
      return [...new Set(ids)].sort((a, b) => {
         const p = targets.get(a)!;
         const q = targets.get(b)!;
         return p.y - q.y || p.x - q.x;
      });
   });

   // ---- the open card ----

   protected readonly selected$ = computed(() => this.list().find((a) => a.id === this.selectedId_()) ?? null);
   protected readonly selectedId$ = computed(() => this.selected$()?.id ?? null);

   protected readonly effectOptions$ = computed<SelectOption<SlideAnimationEffect>[]>(() => {
      const a = this.selected$();
      if (!a) {
         return [];
      }
      if (isDiffAnimation(a)) {
         return [{ value: 'morph', label: EFFECT_NAMES[a.kind].morph }];
      }
      return SLIDE_ANIMATION_EFFECTS_BY_KIND[a.kind]
         .filter((value) => value !== 'morph')
         .map((value) => ({ value, label: EFFECT_NAMES[a.kind][value] }));
   });

   /** Whether the open card's object can play piece by piece (text paragraphs, sequence messages). */
   protected readonly canStagger$ = computed(() => {
      const a = this.selected$();
      return !!a && !a.part && !isDiffAnimation(a) && (this.parts().get(a.target)?.length ?? 0) > 1;
   });

   /** The open card's pieces with their labels, and whether each starts with the one before. */
   protected readonly pieces$ = computed(() => {
      const a = this.selected$();
      if (!a || a.part) {
         return [];
      }
      const joined = new Set(a.stagger?.joined ?? []);
      const skip = new Set(a.stagger?.skip ?? []);
      return (this.parts().get(a.target) ?? [])
         .filter((p) => !skip.has(p))
         .map((part, i) => ({ part, label: this.pieceLabel(a.target, part), first: i === 0, joined: joined.has(part) }));
   });

   /** The open card can go back to its object's automatic animation (and is not already it). */
   protected readonly canReset$ = computed(() => {
      const a = this.selected$();
      const auto = a ? this.autoDefaults().get(a.target) : undefined;
      if (!a || !auto) return false;
      const same =
         a.id === auto.id &&
         a.effect === auto.effect &&
         a.kind === auto.kind &&
         a.duration === auto.duration &&
         a.delay === auto.delay &&
         a.trigger === auto.trigger &&
         JSON.stringify(a.stagger ?? null) === JSON.stringify(auto.stagger ?? null);
      return !same;
   });

   /** Label of one piece: the paragraph's text or the message's label. */
   private pieceLabel(target: string, part: string): string {
      if (part === 'diff') {
         return 'Diff';
      }
      const para = paragraphOfPart(part);
      if (para !== null) {
         const e = this.content().elements.find((x) => x.id === target);
         const line = (e?.text ?? '').split('\n')[para]?.trim() ?? '';
         return line.slice(0, 40) || `Line ${para + 1}`;
      }
      const m = this.content().messages.find((x) => x.id === part);
      return m?.label?.trim().slice(0, 40) || 'Message';
   }

   protected effectName(a: SlideAnimation): string {
      return EFFECT_NAMES[a.kind][a.effect];
   }

   protected directional(a: SlideAnimation): boolean {
      return DIRECTIONAL_EFFECTS.has(a.effect) && !isDiffAnimation(a);
   }

   protected isDiff(a: SlideAnimation): boolean {
      return isDiffAnimation(a);
   }

   protected num(raw: string, fallback: number): number {
      const n = Math.round(Number(raw));
      return Number.isFinite(n) ? Math.max(0, n) : fallback;
   }

   // ---- edits ----

   /** Open a card (and select its object on the canvas), or close it when it is open. */
   protected toggleRow(a: SlideAnimation): void {
      if (this.selectedId_() === a.id) {
         this.selectedId_.set(null);
         return;
      }
      this.selectedId_.set(a.id);
      const t = this.targets().get(a.target);
      if (!t) {
         return;
      }
      this.store.setSelection(
         t.kind === 'table' ? [a.target] : [],
         [],
         t.kind === 'element' ? [a.target] : [],
         [],
         [],
         t.kind === 'diagram' ? [a.target] : []
      );
   }

   protected addSelected(): void {
      const ids = this.selectedTargets$();
      if (!ids.length) {
         return;
      }
      const added = ids.map((id) => newAnimation(id));
      void this.commit([...this.list(), ...added]);
      this.selectedId_.set(added[added.length - 1].id);
   }

   /**
    * Remove an animation. Removing an automatic one (code diff, sequence messages) also
    * switches the object's automatic animation off, so it does not come back by itself.
    */
   protected remove(id: string): void {
      const a = this.list().find((x) => x.id === id);
      const off = this.slide().slide?.animationsOff ?? [];
      const auto = !!a && id.startsWith('auto-');
      void this.commit(
         this.list().filter((x) => x.id !== id),
         auto && a && !off.includes(a.target) ? [...off, a.target] : off
      );
   }

   protected patch(id: string, change: Partial<SlideAnimation>): void {
      void this.commit(this.list().map((a) => (a.id === id ? { ...a, ...change } : a)));
   }

   /** Play the object piece by piece, or as a whole. */
   protected setOneByOne(a: SlideAnimation, on: boolean): void {
      this.patch(a.id, { stagger: on ? (a.stagger ?? { trigger: 'with', delay: STAGGER_GAP }) : undefined });
   }

   protected patchStagger(a: SlideAnimation, change: Partial<SlideAnimationStagger>): void {
      const base = a.stagger ?? { trigger: 'with', delay: STAGGER_GAP };
      // Switching to automatic from clicks: start from the default gap rather than none.
      if (change.trigger && change.trigger !== 'click' && base.trigger === 'click' && !base.delay) {
         change = { delay: STAGGER_GAP, ...change };
      }
      this.patch(a.id, { stagger: { ...base, ...change } });
   }

   /** Group a piece with the one before it (they start together), or split it off again. */
   protected toggleJoined(a: SlideAnimation, part: string): void {
      const joined = new Set(a.stagger?.joined ?? []);
      if (joined.has(part)) {
         joined.delete(part);
      } else {
         joined.add(part);
      }
      this.patchStagger(a, { joined: [...joined] });
   }

   /**
    * Give an object its automatic animation back (code: show the diff on a click;
    * sequence: messages one by one): its own reveal animations go and the default returns.
    */
   protected resetToAuto(target: string): void {
      const auto = this.autoDefaults().get(target);
      if (!auto) return;
      const kept = this.list().filter(
         (a) => !(a.target === target && (isDiffAnimation(a) || !!a.stagger || (!!a.part && !isDiffAnimation(a)) || a.id === auto.id))
      );
      this.selectedId_.set(auto.id);
      void this.commit(
         kept,
         (this.slide().slide?.animationsOff ?? []).filter((t) => t !== target)
      );
   }

   // ---- drag (pointer based: cards and whole blocks, by their grips) ----

   protected readonly drag$ = signal<Drag | null>(null);
   protected readonly drop$ = signal<Drop | null>(null);
   protected readonly dragCard$ = computed(() => {
      const d = this.drag$();
      return d?.kind === 'card' ? d.id : null;
   });
   protected readonly dragBlock$ = computed(() => {
      const d = this.drag$();
      return d?.kind === 'block' ? d.index : null;
   });

   protected startCardDrag(event: PointerEvent, id: string): void {
      this.startDrag(event, { kind: 'card', id });
   }

   protected startBlockDrag(event: PointerEvent, index: number): void {
      this.startDrag(event, { kind: 'block', index });
   }

   private startDrag(event: PointerEvent, drag: Drag): void {
      if (!this.canEdit$() || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
      this.drag$.set(drag);
      this.drop$.set(null);
   }

   protected onDragMove(event: PointerEvent): void {
      const drag = this.drag$();
      if (!drag) return;
      const hit = document.elementFromPoint(event.clientX, event.clientY);
      const root = this.host.nativeElement;
      if (!hit || !root.contains(hit)) {
         this.drop$.set(null);
         return;
      }
      const gap = hit.closest<HTMLElement>('[data-gap]');
      if (gap) {
         this.drop$.set({ type: 'gap', index: Number(gap.dataset['gap']) });
         return;
      }
      const block = hit.closest<HTMLElement>('[data-block]');
      if (!block) {
         this.drop$.set(null);
         return;
      }
      const bi = Number(block.dataset['block']);
      if (drag.kind === 'block') {
         const box = block.getBoundingClientRect();
         this.drop$.set({ type: 'gap', index: event.clientY > box.top + box.height / 2 ? bi + 1 : bi });
         return;
      }
      const card = hit.closest<HTMLElement>('[data-card]');
      if (card) {
         const box = card.getBoundingClientRect();
         const ci = Number(card.dataset['card']);
         this.drop$.set({ type: 'card', block: bi, index: event.clientY > box.top + box.height / 2 ? ci + 1 : ci });
         return;
      }
      this.drop$.set({ type: 'card', block: bi, index: this.blocks$()[bi]?.rows.length ?? 0 });
   }

   protected onDragEnd(): void {
      const drag = this.drag$();
      const drop = this.drop$();
      this.drag$.set(null);
      this.drop$.set(null);
      if (!drag || !drop) return;
      const list = this.list();
      if (drag.kind === 'block') {
         if (drop.type === 'gap') void this.commit(moveAnimationBlock(list, drag.index, drop.index));
         return;
      }
      const to: CardDrop = drop.type === 'gap' ? { newBlock: drop.index } : { block: drop.block, index: drop.index };
      const next = moveAnimationCard(list, drag.id, to);
      if (next.map((a) => `${a.id}${a.trigger}`).join() !== list.map((a) => `${a.id}${a.trigger}`).join()) {
         void this.commit(next);
      }
   }

   protected cancelDrag(): void {
      this.drag$.set(null);
      this.drop$.set(null);
   }

   /**
    * Save the list on the slide. The first edit of a slide that still carries old build
    * steps also clears them, so the explicit list is the only source from then on.
    */
   private async commit(next: SlideAnimation[], off = this.slide().slide?.animationsOff): Promise<void> {
      const frame = this.slide();
      if (!frame.slide || !this.store.canEdit()) {
         return;
      }
      const valid = new Set(this.targets().keys());
      const cleaned = normalizeAnimations(next.filter((a) => valid.has(a.target)));
      const animationsOff = off?.filter((id) => valid.has(id));
      const legacy =
         frame.slide.animations === undefined
            ? this.store.elements().filter((e) => e.slideId === frame.id && (e.step ?? 0) > 0)
            : [];
      await this.store.batchHistory(async () => {
         await this.store.updateElement(frame.id, {
            slide: { ...frame.slide!, animations: cleaned, animationsOff: animationsOff?.length ? animationsOff : undefined },
         });
         for (const e of legacy) {
            await this.store.updateElement(e.id, { step: null });
         }
      });
   }
}
