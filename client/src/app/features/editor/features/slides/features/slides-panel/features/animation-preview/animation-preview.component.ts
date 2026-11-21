import {
   ChangeDetectionStrategy,
   Component,
   DestroyRef,
   ElementRef,
   computed,
   effect,
   inject,
   input,
   output,
   signal,
   untracked,
   viewChild,
} from '@angular/core';
import type { CanvasElementModel } from '@devdesigner/shared';
import { IconComponent } from '../../../../../../../../shared/ui/components/icon/icon.component';
import { ProjectStore } from '../../../../../../state/project/project.store';
import { SlideRenderService, type RenderedSlide } from '../../../../services/slide-render.service';
import { TransitionRunner } from '../../../present/helpers/transition-runner';
import { playSlideStep } from '../../../present/helpers/step-player';

/** Gap between steps when playing the whole slide. */
const PLAY_GAP_MS = 450;

/** One stop of the slide's build: the start, or the state after a click / automatic group. */
interface StepChip {
   step: number;
   label: string;
   title: string;
}

/**
 * Plays one slide's animations in place (no slideshow): the slide as it looks at each
 * step, with back / next / play-all and a chip per step. Re-renders when the slide's
 * content or animations change. Emits the animations of the step just reached so the
 * animation list can highlight them.
 */
@Component({
   selector: 'dd-animation-preview',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [IconComponent],
   templateUrl: './animation-preview.component.html',
   styleUrl: './animation-preview.component.scss',
})
export class AnimationPreviewComponent {
   readonly slide = input.required<CanvasElementModel>();
   /** Open on the slide's final state (after every step) instead of its start. */
   readonly startAtEnd = input(false);
   /** Ids of the animations (list rows) that play into the step now shown. */
   readonly stepRows = output<ReadonlySet<string>>();

   private readonly store = inject(ProjectStore);
   private readonly renderer = inject(SlideRenderService);
   private readonly overlay = viewChild.required<ElementRef<HTMLElement>>('overlay');
   private readonly runner = new TransitionRunner(() => this.overlay().nativeElement);

   protected readonly rendered$ = signal<RenderedSlide | null>(null);
   protected readonly step$ = signal(0);
   protected readonly busy$ = this.runner.busy;
   protected readonly playing$ = signal(false);
   private playToken = 0;

   protected readonly ratio$ = computed(() => {
      const f = this.slide();
      return `${Math.max(1, f.width)} / ${Math.max(1, f.height)}`;
   });

   protected readonly maxStep$ = computed(() => this.rendered$()?.maxStep ?? 0);

   protected readonly url$ = computed(() => {
      const r = this.rendered$();
      if (!r) return null;
      const svg = r.maxStep > 0 ? r.stepSvgs[Math.min(this.step$(), r.maxStep)] : r.svg;
      return SlideRenderService.dataUrl(svg);
   });

   protected readonly chips$ = computed<StepChip[]>(() => {
      const r = this.rendered$();
      if (!r || r.maxStep === 0) return [];
      let click = 0;
      const out: StepChip[] = [{ step: 0, label: 'Start', title: 'Before anything plays' }];
      r.plan.groups.forEach((g, i) => {
         if (g.auto) {
            out.push({ step: i + 1, label: 'Auto', title: 'Plays by itself when the slide appears' });
         } else {
            click += 1;
            out.push({ step: i + 1, label: String(click), title: `After click ${click}` });
         }
      });
      return out;
   });

   protected readonly canBack$ = computed(() => this.step$() > 0);
   protected readonly canNext$ = computed(() => this.step$() < this.maxStep$());

   constructor() {
      // Re-render (debounced) when anything the slide shows changes.
      let timer: ReturnType<typeof setTimeout> | null = null;
      let seq = 0;
      effect(() => {
         const frame = this.slide();
         this.store.elements();
         this.store.tables();
         this.store.sequenceDiagrams();
         this.store.lifelines();
         this.store.sequenceMessages();
         const sameSlide = untracked(() => this.rendered$()?.id === frame.id);
         if (timer) clearTimeout(timer);
         timer = setTimeout(
            () => {
               const mine = (seq += 1);
               void this.renderer.render([frame], { fonts: true }).then(([r]) => {
                  if (mine !== seq || !r) return;
                  this.runner.cancel();
                  this.rendered$.set(r);
                  // A different slide starts over; an edit keeps the step (clamped).
                  untracked(() =>
                     this.setStep(sameSlide ? Math.min(this.step$(), r.maxStep) : this.startAtEnd() ? r.maxStep : 0)
                  );
               });
            },
            sameSlide ? 350 : 0
         );
      });
      inject(DestroyRef).onDestroy(() => {
         if (timer) clearTimeout(timer);
         this.playToken += 1;
         this.runner.cancel();
      });
   }

   private setStep(step: number): void {
      this.step$.set(step);
      const r = this.rendered$();
      const group = step > 0 ? r?.plan.groups[step - 1] : undefined;
      // Expanded pieces carry `<row id>:<piece>` ids; the list highlights the row.
      this.stepRows.emit(new Set(group?.entries.map((e) => e.animation.id.split(':')[0]) ?? []));
   }

   private async move(to: number): Promise<void> {
      const r = this.rendered$();
      const from = this.step$();
      if (!r || to === from || to < 0 || to > r.maxStep) return;
      this.runner.cancel();
      const url = (k: number): string => SlideRenderService.dataUrl(r.stepSvgs[Math.min(k, r.maxStep)] ?? r.svg);
      await playSlideStep(this.runner, r, from, to, url, () => this.setStep(to));
   }

   protected next(): void {
      this.stop();
      void this.move(this.step$() + 1);
   }

   protected back(): void {
      this.stop();
      void this.move(this.step$() - 1);
   }

   protected jump(step: number): void {
      this.stop();
      void this.move(step);
   }

   /** Play the whole slide from the start, one step after another. */
   protected async playAll(): Promise<void> {
      if (this.playing$()) {
         this.stop();
         return;
      }
      const token = (this.playToken += 1);
      this.playing$.set(true);
      this.runner.cancel();
      this.setStep(0);
      try {
         for (let k = 1; k <= this.maxStep$(); k += 1) {
            if (token !== this.playToken) return;
            // Clicks wait a moment (the presenter's pause); automatic groups follow at once.
            const auto = this.rendered$()?.plan.groups[k - 1]?.auto;
            if (!auto) await new Promise((res) => setTimeout(res, PLAY_GAP_MS));
            if (token !== this.playToken) return;
            await this.move(k);
         }
      } finally {
         if (token === this.playToken) this.playing$.set(false);
      }
   }

   private stop(): void {
      this.playToken += 1;
      this.playing$.set(false);
   }
}
