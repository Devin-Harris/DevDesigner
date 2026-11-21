import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
   DIRECTIONAL_EFFECTS,
   SLIDE_ANIMATION_EFFECTS_BY_KIND,
   effectFor,
   newAnimation,
   normalizeAnimations,
   planAnimations,
   slideAnimations,
   type CanvasElementModel,
   type SlideAnimation,
   type SlideAnimationEffect,
   type SlideAnimationKind,
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
import { CallPipe, HasPipe } from '../../../../../../../../shared/ui/pipes/collection.pipes';

const KIND_OPTIONS: SelectOption<SlideAnimationKind>[] = [
   { value: 'enter', label: 'Entrance' },
   { value: 'exit', label: 'Exit' },
   { value: 'emphasis', label: 'Emphasis' },
];

const TRIGGER_OPTIONS: SelectOption<SlideAnimationTrigger>[] = [
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

const EFFECT_NAMES: Record<SlideAnimationKind, Record<SlideAnimationEffect, string>> = {
   enter: { appear: 'Appear', fade: 'Fade in', fly: 'Fly in', wipe: 'Wipe in', zoom: 'Zoom in', pulse: 'Pulse' },
   exit: {
      appear: 'Disappear',
      fade: 'Fade out',
      fly: 'Fly out',
      wipe: 'Wipe out',
      zoom: 'Zoom out',
      pulse: 'Pulse',
   },
   emphasis: { appear: 'Appear', fade: 'Fade', fly: 'Fly', wipe: 'Wipe', zoom: 'Zoom', pulse: 'Pulse' },
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

interface Target {
   label: string;
   kind: 'element' | 'table' | 'diagram';
   x: number;
   y: number;
}

/**
 * The animation list of one slide (PowerPoint's animation pane): which objects animate,
 * with what effect, and in what order. Row order is play order; each row starts on a
 * click, with the row above, or after it. Edits are ordinary slide updates, so they
 * sync live and undo like any other change.
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
   /** Preview the slide: the panel runs it in present mode. */
   // eslint-disable-next-line @angular-eslint/no-output-native -- component output, never on a <video>/<audio> element
   readonly play = output<void>();

   private readonly store = inject(ProjectStore);

   protected readonly canEdit$ = this.store.canEdit;
   protected readonly kindOptions = KIND_OPTIONS;
   protected readonly triggerOptions = TRIGGER_OPTIONS;
   protected readonly directions = DIRECTION_OPTIONS;
   protected readonly exitDirections = EXIT_DIRECTION_OPTIONS;
   protected readonly effectFor = effectFor;

   private readonly selectedId_ = signal<string | null>(null);

   /** What is on the slide, by id. */
   private readonly targets = computed(() => {
      const c = contentForFrame(
         this.slide().id,
         true,
         this.store.elements(),
         this.store.tables(),
         this.store.sequenceDiagrams(),
         this.store.lifelines(),
         this.store.sequenceMessages()
      );
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
         out.set(d.id, {
            label: d.title?.trim() || 'Sequence diagram',
            kind: 'diagram',
            x: 0,
            y: d.originY,
         });
      }
      return out;
   });

   /** The slide's animations in play order (derived from old build steps until first edited). */
   private readonly list = computed<SlideAnimation[]>(() =>
      slideAnimations(
         this.slide().slide,
         this.store.elements().filter((e) => e.slideId === this.slide().id && e.type !== 'frame')
      )
   );

   protected readonly rows$ = computed(() => {
      const targets = this.targets();
      let click = 0;
      return this.list().map((animation) => {
         if (animation.trigger === 'click') {
            click += 1;
         }
         return { animation, target: targets.get(animation.target) ?? null, click };
      });
   });

   protected readonly selected$ = computed(() => this.list().find((a) => a.id === this.selectedId_()) ?? null);
   protected readonly selectedId$ = computed(() => this.selected$()?.id ?? null);

   protected readonly effectOptions$ = computed<SelectOption<SlideAnimationEffect>[]>(() => {
      const a = this.selected$();
      if (!a) {
         return [];
      }
      return SLIDE_ANIMATION_EFFECTS_BY_KIND[a.kind].map((value) => ({
         value,
         label: EFFECT_NAMES[a.kind][value],
      }));
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

   protected readonly summary$ = computed(() => {
      const plan = planAnimations(this.list(), new Set(this.targets().keys()));
      const clicks = plan.groups.filter((g) => !g.auto).length;
      const auto = plan.groups.some((g) => g.auto);
      const parts = [`${clicks} click${clicks === 1 ? '' : 's'}`];
      if (auto) {
         parts.push('starts by itself');
      }
      return parts.join(' · ');
   });

   protected effectName(a: SlideAnimation): string {
      return EFFECT_NAMES[a.kind][a.effect];
   }

   protected directional(a: SlideAnimation): boolean {
      return DIRECTIONAL_EFFECTS.has(a.effect);
   }

   protected num(raw: string, fallback: number): number {
      const n = Math.round(Number(raw));
      return Number.isFinite(n) ? Math.max(0, n) : fallback;
   }

   /** Select a row, and its object on the canvas so it can be seen and moved. */
   protected pickRow(a: SlideAnimation): void {
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

   protected remove(id: string): void {
      void this.commit(this.list().filter((a) => a.id !== id));
   }

   protected patch(id: string, change: Partial<SlideAnimation>): void {
      void this.commit(this.list().map((a) => (a.id === id ? { ...a, ...change } : a)));
   }

   /** Animations that can move up / down one place. */
   protected readonly movableUp$ = computed(() => new Set(this.list().slice(1).map((a) => a.id)));
   protected readonly movableDown$ = computed(() => new Set(this.list().slice(0, -1).map((a) => a.id)));

   protected canMove(id: string, by: -1 | 1): boolean {
      const i = this.list().findIndex((a) => a.id === id);
      return i >= 0 && i + by >= 0 && i + by < this.list().length;
   }

   protected move(id: string, by: -1 | 1): void {
      const next = [...this.list()];
      const i = next.findIndex((a) => a.id === id);
      const j = i + by;
      if (i < 0 || j < 0 || j >= next.length) {
         return;
      }
      [next[i], next[j]] = [next[j], next[i]];
      void this.commit(next);
   }

   /**
    * Save the list on the slide. The first edit of a slide that still carries old build
    * steps also clears them, so the explicit list is the only source from then on.
    */
   private async commit(next: SlideAnimation[]): Promise<void> {
      const frame = this.slide();
      if (!frame.slide || !this.store.canEdit()) {
         return;
      }
      const valid = new Set(this.targets().keys());
      const cleaned = normalizeAnimations(next.filter((a) => valid.has(a.target)));
      const legacy =
         frame.slide.animations === undefined
            ? this.store.elements().filter((e) => e.slideId === frame.id && (e.step ?? 0) > 0)
            : [];
      await this.store.batchHistory(async () => {
         await this.store.updateElement(frame.id, {
            slide: { ...frame.slide!, animations: cleaned },
         });
         for (const e of legacy) {
            await this.store.updateElement(e.id, { step: null });
         }
      });
   }
}
