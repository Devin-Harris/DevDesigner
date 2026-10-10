import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  effectiveTransition,
  type CanvasElementModel,
  type SlideConfig,
  type SlideDirection,
  type SlideEasing,
  type SlideTransition,
  type SlideTransitionType,
} from '@dbdesigner/shared';
import { IconComponent } from '../../../shared/ui/icon/icon.component';
import { SelectComponent, type SelectOption } from '../../../shared/ui/select/select.component';
import { ProjectStore } from '../../../stores/project.store';
import { SlideRenderService } from './slide-render.service';

/** What the panel asks the editor to do (things that need canvas knowledge). */
export type SlidesCommand =
  | { kind: 'present'; from: 'start' | 'current' }
  | { kind: 'preview'; id: string }
  | { kind: 'focus'; id: string }
  | { kind: 'duplicate'; id: string }
  | { kind: 'delete'; id: string }
  | { kind: 'add' }
  | { kind: 'export'; format: 'pdf' | 'png' }
  | { kind: 'close' };

const TYPE_OPTIONS: SelectOption<SlideTransitionType>[] = [
  { value: 'none', label: 'None' },
  { value: 'fade', label: 'Fade' },
  { value: 'slide', label: 'Slide' },
  { value: 'zoom', label: 'Zoom' },
  { value: 'morph', label: 'Morph' },
];
const DIRECTION_OPTIONS: SelectOption<SlideDirection>[] = [
  { value: 'left', label: 'To the left' },
  { value: 'right', label: 'To the right' },
  { value: 'up', label: 'Upwards' },
  { value: 'down', label: 'Downwards' },
];
const STEP_OPTIONS: SelectOption<number>[] = [
  { value: 0, label: 'Slide start (always visible)' },
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ value: n, label: `Step ${n}` })),
];
const EASING_OPTIONS: SelectOption<SlideEasing>[] = [
  { value: 'ease-in-out', label: 'Ease in-out' },
  { value: 'ease', label: 'Ease' },
  { value: 'ease-in', label: 'Ease in' },
  { value: 'ease-out', label: 'Ease out' },
  { value: 'linear', label: 'Linear' },
];

/**
 * The slide sorter: the project's presentation as a list of frame thumbnails.
 * Reorder by dragging, skip/duplicate/remove per slide, and edit the selected
 * slide's transition and speaker notes. All edits are ordinary frame updates, so
 * they sync live and undo/redo like any other change.
 */
@Component({
  selector: 'app-slides-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, SelectComponent],
  template: `
    <header class="head">
      <h2>Slides</h2>
      <button class="icon" (click)="command.emit({ kind: 'close' })" aria-label="Close slides">
        <dbd-icon name="close" />
      </button>
    </header>

    <div class="actions">
      <button
        class="btn primary"
        [disabled]="!playable()"
        (click)="command.emit({ kind: 'present', from: 'start' })"
      >
        <dbd-icon name="play_arrow" />Present
      </button>
      <button
        class="btn"
        [disabled]="!playable()"
        (click)="command.emit({ kind: 'present', from: 'current' })"
        title="Present from the selected slide"
      >
        From here
      </button>
      <button
        class="btn"
        [disabled]="!playable()"
        (click)="command.emit({ kind: 'export', format: 'pdf' })"
        title="Export the slides in order as a PDF"
      >
        PDF
      </button>
      <button
        class="btn"
        [disabled]="!playable()"
        (click)="command.emit({ kind: 'export', format: 'png' })"
        title="Export each slide as a PNG"
      >
        PNG
      </button>
      @if (canEdit()) {
        <button class="btn" (click)="command.emit({ kind: 'add' })" title="Add a new 16:9 slide">
          <dbd-icon name="add" />New
        </button>
      }
    </div>

    <div class="scroll">
      @if (frames().length === 0) {
        <p class="empty">
          No slides yet. Press <b>New</b> to add a 16:9 slide, or add an existing frame below.
          Everything inside a frame is part of its slide.
        </p>
      }

      <ol class="list">
        @for (f of frames(); track f.id; let i = $index) {
          <li
            class="row"
            [class.on]="f.id === activeId()"
            [class.hidden]="!!f.slide?.hidden"
            [class.over]="overIndex() === i"
            [attr.draggable]="canEdit() ? 'true' : null"
            (dragstart)="dragFrom = i"
            (dragover)="$event.preventDefault(); overIndex.set(i)"
            (dragleave)="overIndex.set(null)"
            (drop)="drop(i)"
            (dragend)="overIndex.set(null)"
            (click)="command.emit({ kind: 'focus', id: f.id })"
          >
            <span class="num">{{ i + 1 }}</span>
            <span class="thumb" [style.aspect-ratio]="f.width + ' / ' + f.height">
              @if (thumbs().get(f.id); as src) {
                <img [src]="src" alt="" draggable="false" />
              }
            </span>
            <span class="meta">
              <span class="name">{{ f.text || 'Untitled slide' }}</span>
              <span class="sub">{{ transitionLabel(f) }}</span>
            </span>
            @if (canEdit()) {
              <span class="tools" (click)="$event.stopPropagation()">
                <button
                  class="icon"
                  (click)="toggleHidden(f)"
                  [attr.aria-label]="f.slide?.hidden ? 'Include slide' : 'Skip slide'"
                  [title]="f.slide?.hidden ? 'Skipped: click to include' : 'Skip this slide'"
                >
                  <dbd-icon [name]="f.slide?.hidden ? 'visibility_off' : 'visibility'" />
                </button>
                <button
                  class="icon"
                  (click)="command.emit({ kind: 'duplicate', id: f.id })"
                  title="Duplicate slide"
                  aria-label="Duplicate slide"
                >
                  <dbd-icon name="content_copy" />
                </button>
                <button
                  class="icon"
                  (click)="removeFromSequence(f)"
                  title="Remove from the sequence (keeps the frame)"
                  aria-label="Remove from sequence"
                >
                  <dbd-icon name="remove" />
                </button>
                <button
                  class="icon"
                  (click)="command.emit({ kind: 'delete', id: f.id })"
                  title="Delete the frame and its contents"
                  aria-label="Delete slide"
                >
                  <dbd-icon name="delete" />
                </button>
              </span>
            }
          </li>
        }
      </ol>

      @if (active(); as a) {
        <section class="detail">
          <h3>
            Slide {{ activeNumber() }}
            <button class="link" (click)="command.emit({ kind: 'preview', id: a.id })">
              <dbd-icon name="play_arrow" />Preview transition
            </button>
          </h3>

          @if (activeNumber() === 1) {
            <p class="hint">The first slide has no transition into it.</p>
          } @else {
            <label class="field">
              <span>Transition into this slide</span>
              <dbd-select
                [options]="typeOptions"
                [ngModel]="transition().type"
                [disabled]="!canEdit()"
                (ngModelChange)="setTransition({ type: $event })"
              />
            </label>
            @if (transition().type === 'slide') {
              <label class="field">
                <span>Direction</span>
                <dbd-select
                  [options]="directionOptions"
                  [ngModel]="transition().direction ?? 'left'"
                  [disabled]="!canEdit()"
                  (ngModelChange)="setTransition({ direction: $event })"
                />
              </label>
            }
            @if (transition().type !== 'none') {
              <div class="two">
                <label class="field">
                  <span>Duration (ms)</span>
                  <input
                    type="number"
                    min="100"
                    max="5000"
                    step="100"
                    [ngModel]="transition().duration"
                    [disabled]="!canEdit()"
                    (change)="setDuration($any($event.target).value)"
                  />
                </label>
                <label class="field">
                  <span>Easing</span>
                  <dbd-select
                    [options]="easingOptions"
                    [ngModel]="transition().easing"
                    [disabled]="!canEdit()"
                    (ngModelChange)="setTransition({ easing: $event })"
                  />
                </label>
              </div>
            }
            @if (transition().type === 'morph') {
              <p class="hint">
                Copy a slide to morph it: copies of the same shape, text or table glide to
                their new position, size, color and wording.
              </p>
            }
            @if (canEdit() && frames().length > 2) {
              <button class="link" (click)="applyToAll()">Apply to all slides</button>
            }
          }

          <label class="field">
            <span>Speaker notes</span>
            <textarea
              rows="4"
              placeholder="Notes shown to the presenter (press N while presenting)"
              [ngModel]="a.slide?.notes ?? ''"
              [disabled]="!canEdit()"
              (blur)="setNotes($any($event.target).value)"
            ></textarea>
          </label>
        </section>
      }

      @if (canEdit() && selectedLoose(); as f) {
        <section class="loose">
          <h3>Selected frame</h3>
          <button class="btn wide" (click)="addToSequence(f)">
            Add "{{ f.text || 'Untitled frame' }}" as a slide
          </button>
        </section>
      }

      @if (canEdit() && buildable() > 0) {
        <section class="loose">
          <h3>Build</h3>
          <label class="field">
            <span>
              Reveal {{ buildable() === 1 ? 'the selected item' : buildable() + ' selected items' }}
              on
            </span>
            <dbd-select
              [options]="stepOptions"
              [ngModel]="buildStep()"
              (ngModelChange)="setBuildStep($event)"
            />
          </label>
          <p class="hint">Each advance while presenting reveals the next step.</p>
        </section>
      }

      @if (canEdit() && pairable()) {
        <section class="loose">
          <h3>Morph</h3>
          <button class="btn wide" (click)="pairSelected()">
            Treat the {{ pairable() }} selected items as the same object
          </button>
        </section>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        background: var(--dbd-surface);
        border: 1px solid var(--dbd-border);
        border-radius: 14px;
        box-shadow: var(--dbd-shadow-2);
        color: var(--dbd-text);
        overflow: hidden;
        font-size: 13px;
      }
      .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 12px 6px 14px;
      }
      h2 {
        margin: 0;
        font-size: 14px;
        font-weight: 700;
      }
      h3 {
        margin: 0 0 8px;
        font-size: 11px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--dbd-text-muted);
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .actions {
        display: flex;
        gap: 6px;
        padding: 6px 12px 10px;
        flex-wrap: wrap;
      }
      .btn {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        height: 30px;
        padding: 0 10px;
        border-radius: 8px;
        border: 1px solid var(--dbd-border);
        background: var(--dbd-surface-2);
        color: var(--dbd-text);
        font: inherit;
        font-weight: 600;
        cursor: pointer;
      }
      .btn:disabled {
        opacity: 0.45;
        cursor: default;
      }
      .btn.primary {
        background: var(--dbd-primary);
        border-color: var(--dbd-primary);
        color: #fff;
      }
      .btn.wide {
        width: 100%;
        height: auto;
        padding: 8px 10px;
        text-align: left;
        font-weight: 500;
      }
      .icon {
        width: 26px;
        height: 26px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: none;
        border-radius: 7px;
        background: transparent;
        color: var(--dbd-text-muted);
        cursor: pointer;
      }
      .icon:hover {
        background: var(--dbd-surface-2);
        color: var(--dbd-text);
      }
      .scroll {
        flex: 1;
        min-height: 0;
        overflow: auto;
        padding: 0 10px 12px;
      }
      .empty,
      .hint {
        margin: 6px 4px 10px;
        color: var(--dbd-text-muted);
        line-height: 1.45;
        font-size: 12px;
      }
      .list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .row {
        position: relative;
        display: grid;
        grid-template-columns: 20px 92px 1fr;
        align-items: center;
        gap: 8px;
        padding: 6px;
        border-radius: 10px;
        border: 1px solid transparent;
        cursor: pointer;
      }
      .row:hover {
        background: var(--dbd-surface-2);
      }
      .row.on {
        background: var(--dbd-primary-weak);
        border-color: color-mix(in srgb, var(--dbd-primary) 40%, transparent);
      }
      .row.over {
        box-shadow: 0 -2px 0 var(--dbd-primary);
      }
      .row.hidden .thumb,
      .row.hidden .meta {
        opacity: 0.45;
      }
      .num {
        text-align: center;
        font-size: 11px;
        font-weight: 700;
        color: var(--dbd-text-muted);
      }
      .thumb {
        display: block;
        width: 92px;
        border-radius: 6px;
        overflow: hidden;
        border: 1px solid var(--dbd-border);
        background: var(--dbd-canvas-bg);
      }
      .thumb img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: contain;
      }
      .meta {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .name {
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .sub {
        font-size: 11px;
        color: var(--dbd-text-muted);
      }
      .tools {
        position: absolute;
        right: 4px;
        top: 4px;
        display: none;
        gap: 2px;
        padding: 2px;
        border-radius: 9px;
        background: var(--dbd-surface);
        border: 1px solid var(--dbd-border);
      }
      .row:hover .tools {
        display: inline-flex;
      }
      .detail,
      .loose {
        margin-top: 14px;
        padding-top: 12px;
        border-top: 1px solid var(--dbd-border);
      }
      .link {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        border: none;
        background: transparent;
        color: var(--dbd-primary);
        font: inherit;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        padding: 2px 0;
        text-transform: none;
        letter-spacing: 0;
      }
      .field {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-bottom: 10px;
      }
      .field > span {
        font-size: 11px;
        color: var(--dbd-text-muted);
      }
      .two {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }
      input[type='number'],
      textarea {
        font: inherit;
        color: var(--dbd-text);
        background: var(--dbd-surface-2);
        border: 1px solid var(--dbd-border);
        border-radius: var(--dbd-radius-sm);
        padding: 6px 8px;
        box-sizing: border-box;
        width: 100%;
      }
      input[type='number'] {
        height: 34px;
      }
      textarea {
        resize: vertical;
      }
      .loose-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 4px;
        border-radius: 8px;
        cursor: pointer;
      }
      .loose-row:hover {
        background: var(--dbd-surface-2);
      }
    `,
  ],
})
export class SlidesPanelComponent {
  readonly command = output<SlidesCommand>();

  private readonly store = inject(ProjectStore);
  private readonly render = inject(SlideRenderService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly typeOptions = TYPE_OPTIONS;
  protected readonly directionOptions = DIRECTION_OPTIONS;
  protected readonly easingOptions = EASING_OPTIONS;
  protected readonly stepOptions = STEP_OPTIONS;

  protected readonly canEdit = this.store.canEdit;
  /** Frames in the sequence, in presentation order (skipped ones included). */
  protected readonly frames = this.store.slideFrames;
  protected readonly playable = computed(() => this.frames().some((f) => !f.slide?.hidden));
  /** The single selected frame, when it is not part of the sequence yet. */
  protected readonly selectedLoose = computed<CanvasElementModel | null>(() => {
    const ids = this.store.selectedElementIds();
    if (ids.length !== 1) {
      return null;
    }
    const e = this.store.elements().find((x) => x.id === ids[0]);
    return e && e.type === 'frame' && !e.slide ? e : null;
  });
  protected readonly thumbs = signal<ReadonlyMap<string, string>>(new Map());
  protected readonly overIndex = signal<number | null>(null);
  protected dragFrom: number | null = null;

  /** The slide whose details are shown: the single selected frame, if it is a slide. */
  protected readonly active = computed<CanvasElementModel | null>(() => {
    const ids = this.store.selectedElementIds();
    if (ids.length !== 1) {
      return null;
    }
    return this.frames().find((f) => f.id === ids[0]) ?? null;
  });
  protected readonly activeId = computed(() => this.active()?.id ?? null);
  protected readonly activeNumber = computed(() => {
    const id = this.activeId();
    return id ? this.frames().findIndex((f) => f.id === id) + 1 : 0;
  });
  protected readonly transition = computed<SlideTransition>(() =>
    effectiveTransition(this.active()?.slide),
  );

  /** How many selected non-frame elements could be linked as one object (2+). */
  protected readonly pairable = computed(() => {
    const ids = new Set(this.store.selectedElementIds());
    const n = this.store.elements().filter((e) => ids.has(e.id) && e.type !== 'frame').length;
    return n >= 2 ? n : 0;
  });

  /** Selected non-frame elements that can be given a build step. */
  private readonly buildTargets = computed(() => {
    const ids = new Set(this.store.selectedElementIds());
    return this.store.elements().filter((e) => ids.has(e.id) && e.type !== 'frame');
  });
  protected readonly buildable = computed(() => this.buildTargets().length);
  /** The shared step of the selection (0 when they differ or none is set). */
  protected readonly buildStep = computed(() => {
    const steps = new Set(this.buildTargets().map((e) => e.step ?? 0));
    return steps.size === 1 ? [...steps][0] : 0;
  });

  private renderToken = 0;

  constructor() {
    // Re-render thumbnails (debounced) whenever anything that can appear on a slide changes.
    effect((onCleanup) => {
      const frames = [...this.frames()];
      this.store.elements();
      this.store.tables();
      this.store.relationships();
      this.store.sequenceDiagrams();
      this.store.lifelines();
      this.store.sequenceMessages();
      const timer = setTimeout(() => void untracked(() => this.refreshThumbs(frames)), 350);
      onCleanup(() => clearTimeout(timer));
    });
    this.destroyRef.onDestroy(() => (this.renderToken += 1));
  }

  private async refreshThumbs(frames: readonly CanvasElementModel[]): Promise<void> {
    const token = (this.renderToken += 1);
    const rendered = await this.render.render(frames, { fonts: false });
    if (token !== this.renderToken) {
      return;
    }
    this.thumbs.set(new Map(rendered.map((r) => [r.id, SlideRenderService.dataUrl(r.svg)])));
  }

  protected transitionLabel(f: CanvasElementModel): string {
    if (f.slide?.hidden) {
      return 'Skipped';
    }
    const t = effectiveTransition(f.slide);
    if (t.type === 'none' || this.frames()[0]?.id === f.id) {
      return `${Math.round(f.width)} × ${Math.round(f.height)}`;
    }
    return `${t.type[0].toUpperCase()}${t.type.slice(1)} · ${t.duration} ms`;
  }

  // ---- edits ----

  protected toggleHidden(f: CanvasElementModel): void {
    if (!f.slide) {
      return;
    }
    void this.store.updateElement(f.id, { slide: { ...f.slide, hidden: !f.slide.hidden } });
  }

  protected removeFromSequence(f: CanvasElementModel): void {
    void this.store.updateElement(f.id, { slide: null });
  }

  protected addToSequence(f: CanvasElementModel): void {
    const last = this.frames().reduce((m, x) => Math.max(m, x.slide?.order ?? 0), -1);
    void this.store.updateElement(f.id, { slide: { order: last + 1 } });
  }

  protected setTransition(patch: Partial<SlideTransition>): void {
    const a = this.active();
    if (!a?.slide) {
      return;
    }
    const slide: SlideConfig = {
      ...a.slide,
      transition: { ...effectiveTransition(a.slide), ...patch },
    };
    void this.store.updateElement(a.id, { slide });
  }

  protected setDuration(raw: string): void {
    const ms = Math.min(5000, Math.max(100, Math.round(Number(raw)) || 600));
    this.setTransition({ duration: ms });
  }

  protected setNotes(value: string): void {
    const a = this.active();
    if (!a?.slide || (a.slide.notes ?? '') === value) {
      return;
    }
    void this.store.updateElement(a.id, { slide: { ...a.slide, notes: value || undefined } });
  }

  protected applyToAll(): void {
    const t = this.transition();
    const frames = this.frames();
    void this.store.batchHistory(async () => {
      for (const f of frames) {
        if (f.slide) {
          await this.store.updateElement(f.id, { slide: { ...f.slide, transition: { ...t } } });
        }
      }
    });
  }

  protected drop(to: number): void {
    const from = this.dragFrom;
    this.dragFrom = null;
    this.overIndex.set(null);
    if (from === null || from === to || !this.canEdit()) {
      return;
    }
    const list = [...this.frames()];
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);
    void this.store.batchHistory(async () => {
      for (let i = 0; i < list.length; i += 1) {
        const f = list[i];
        if (f.slide && f.slide.order !== i) {
          await this.store.updateElement(f.id, { slide: { ...f.slide, order: i } });
        }
      }
    });
  }

  protected setBuildStep(step: number): void {
    const targets = this.buildTargets().filter((e) => (e.step ?? 0) !== step);
    if (!targets.length) {
      return;
    }
    void this.store.batchHistory(async () => {
      for (const e of targets) {
        await this.store.updateElement(e.id, { step: step || null });
      }
    });
  }

  /** Make the selected elements one lineage so they morph into each other across slides. */
  protected pairSelected(): void {
    const ids = new Set(this.store.selectedElementIds());
    const picked = this.store.elements().filter((e) => ids.has(e.id) && e.type !== 'frame');
    if (picked.length < 2) {
      return;
    }
    const key = picked[0].morphId ?? picked[0].id;
    void this.store.batchHistory(async () => {
      for (const e of picked) {
        if ((e.morphId ?? e.id) !== key) {
          await this.store.updateElement(e.id, { morphId: key });
        }
      }
    });
  }
}
