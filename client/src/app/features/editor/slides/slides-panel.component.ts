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
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  DEFAULT_PRESENTATION,
  effectiveTransition,
  nextCopyName,
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
import { FRAME_PRESETS } from '../canvas/constants/frame-presets';
import { SlideRenderService } from './slide-render.service';

/** What the panel asks the editor to do (things that need canvas knowledge). */
export type SlidesCommand =
  | { kind: 'present'; from: 'start' | 'current' }
  | { kind: 'preview'; id: string }
  | { kind: 'focus'; id: string }
  | { kind: 'duplicate'; id: string; toIndex?: number }
  | { kind: 'delete'; id: string }
  | { kind: 'add' }
  | { kind: 'newPresentation'; name: string }
  | { kind: 'deletePresentation'; name: string }
  | { kind: 'close' }
  | { kind: 'fold' };

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
    @if (part() === 'list') {
    <header class="head">
      @if (renaming()) {
        <input
          class="rename"
          type="text"
          maxlength="120"
          [value]="presentation() ?? ''"
          (keydown.enter)="commitRename($any($event.target).value)"
          (keydown.escape)="renaming.set(false)"
          (blur)="commitRename($any($event.target).value)"
          (click)="$event.stopPropagation()"
        />
      } @else {
        <dbd-select
          class="pres"
          [options]="presentationOptions()"
          [ngModel]="presentation()"
          (ngModelChange)="store.selectPresentation($event)"
        />
      }
      @if (canEdit() && presentation()) {
        <span class="pres-tools">
          <button class="icon" (click)="renaming.set(true)" title="Rename presentation" aria-label="Rename presentation">
            <dbd-icon name="edit" />
          </button>
          <button
            class="icon"
            (click)="command.emit({ kind: 'newPresentation', name: newPresentationName() })"
            title="New presentation"
            aria-label="New presentation"
          >
            <dbd-icon name="add" />
          </button>
          <button
            class="icon"
            (click)="command.emit({ kind: 'deletePresentation', name: presentation()! })"
            title="Delete presentation and its slides"
            aria-label="Delete presentation"
          >
            <dbd-icon name="delete" />
          </button>
        </span>
      }
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
      @if (canEdit()) {
        <button class="btn" (click)="command.emit({ kind: 'add' })" title="Add a new 16:9 slide">
          <dbd-icon name="add" />New
        </button>
      }
    </div>

    <div class="top">
      @if (frames().length === 0) {
        <p class="empty">
          No slides yet. Press <b>New</b> to add a 16:9 slide, or select a frame and add it here.
          Only one slide is shown on the canvas at a time; everything inside its frame is part of
          it.
        </p>
      }

      @if (frames().length > 1) {
        <div class="listbar">
          <span class="muted">{{ selectedCount() }} selected</span>
          <button class="link" (click)="selectAll()">Select all</button>
        </div>
      }

    </div>

    <!-- Only the slide cards scroll; the controls above and the details below stay put. -->
    <div class="cards">
      <ol class="list" [class.reordering]="draggingIndex() !== null">
        @for (f of shown(); track f.id; let i = $index) {
          <li
            class="card"
            [class.on]="isSelected(f.id)"
            [class.current]="f.id === active_()"
            [class.hidden]="!!f.slide?.hidden"
            [class.dragging]="draggingIndex() === i && !cloning()"
            [class.settling]="draggingIndex() === i && !cloning() && settling()"
            [class.pending]="f.id === pendingCloneId"
            [style.transform]="cardTransform(i)"
            (pointerdown)="onCardDown(i, $event)"
            (click)="onRowClick(f, $event)"
            title="Drag to reorder · Alt-drag to duplicate"
          >
            <span class="thumb" [style.aspect-ratio]="f.width + ' / ' + f.height">
              @if (thumbs().get(thumbId(f)); as src) {
                <img [src]="src" alt="" draggable="false" />
              }
              <span class="num">{{ i + 1 }}</span>
            </span>
            @if (canEdit() && f.id !== pendingCloneId) {
              <span class="icons" (click)="$event.stopPropagation()">
                <button
                  class="icon"
                  (click)="toggleHidden(f)"
                  [title]="
                    f.slide?.hidden
                      ? 'Skipped: include in the presentation'
                      : 'Skip in the presentation'
                  "
                  aria-label="Skip slide"
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
                  (click)="command.emit({ kind: 'delete', id: f.id })"
                  title="Delete slide and its contents"
                  aria-label="Delete slide"
                >
                  <dbd-icon name="delete" />
                </button>
              </span>
            }
          </li>
        }
        <!-- Alt-drag: the original stays put while this copy follows the pointer. -->
        @if (cloneGhost(); as g) {
          <li
            class="card dragging ghost"
            [class.settling]="settling()"
            [style.top.px]="g.top"
            [style.height.px]="g.height"
            [style.transform]="'translateY(' + dragDy() + 'px) scale(1.02)'"
          >
            <span class="thumb" [style.aspect-ratio]="g.fw + ' / ' + g.fh">
              @if (thumbs().get(g.id); as src) {
                <img [src]="src" alt="" draggable="false" />
              }
              <span class="num">+</span>
            </span>
          </li>
        }
      </ol>
    </div>

    }

    @if (part() === 'settings') {
    <div class="below" [class.folded]="folded()">
      @if (folded()) {
        <button
          class="strip"
          (click)="command.emit({ kind: 'fold' })"
          aria-label="Expand slide settings"
          title="Expand slide settings"
        >
          <dbd-icon name="chevron_left" />
          <span class="vert">Slide settings</span>
        </button>
      } @else {
      <div class="tabs" role="tablist">
        <button class="tab" [class.on]="tab() === 'transition'" (click)="pick('transition')">
          Transition
        </button>
        <button class="tab" [class.on]="tab() === 'size'" (click)="pick('size')">
          Size
        </button>
        <button class="tab" [class.on]="tab() === 'notes'" (click)="pick('notes')">
          Notes
        </button>
        @if (canEdit() && (buildable() > 0 || pairable())) {
          <button class="tab" [class.on]="tab() === 'build'" (click)="pick('build')">
            Build
          </button>
        }
        <button
          class="icon fold"
          (click)="command.emit({ kind: 'fold' })"
          aria-label="Collapse slide settings"
          title="Collapse to the side"
        >
          <dbd-icon name="chevron_right" />
        </button>
      </div>

      @if (tab()) {
        <div class="tabbody">
          @switch (tab()) {
            @case ('transition') {
              @if (active(); as a) {
                <div class="who">
                  {{
                    activeSlides().length > 1
                      ? activeSlides().length + ' slides'
                      : 'Slide ' + activeNumber()
                  }}
                  @if (activeSlides().length <= 1) {
                    <button class="link" (click)="command.emit({ kind: 'preview', id: a.id })">
                      <dbd-icon name="play_arrow" />Preview
                    </button>
                  }
                </div>
                @if (!hasTransitionTarget()) {
                  <p class="hint">The first slide has no transition into it.</p>
                } @else {
                  <label class="field">
                    <span>Transition into {{ activeSlides().length > 1 ? 'these slides' : 'this slide' }}</span>
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
                  @if (canEdit() && frames().length > 2) {
                    <button class="link" (click)="applyToAll()">Apply to all slides</button>
                  }
                }
              } @else {
                <p class="hint">Select a slide to set its transition.</p>
              }
            }
            @case ('size') {
              @if (canEdit()) {
                <label class="field">
                  <span>Size of every slide</span>
                  <dbd-select
                    [options]="sizeOptions()"
                    [ngModel]="sizeValue()"
                    (ngModelChange)="setSize($event)"
                  />
                </label>
              } @else {
                <p class="hint">Slides are {{ sizeValue() === 'custom' ? 'a custom size' : 'sized by preset' }}.</p>
              }
            }
            @case ('notes') {
              @if (active(); as a) {
                @if (activeSlides().length <= 1) {
                  <label class="field">
                    <span>Speaker notes for slide {{ activeNumber() }}</span>
                    <textarea
                      rows="4"
                      placeholder="Shown to the presenter (press N while presenting)"
                      [ngModel]="a.slide?.notes ?? ''"
                      [disabled]="!canEdit()"
                      (blur)="setNotes($any($event.target).value)"
                    ></textarea>
                  </label>
                } @else {
                  <p class="hint">Select a single slide to edit its notes.</p>
                }
              } @else {
                <p class="hint">Select a slide to edit its notes.</p>
              }
            }
            @case ('build') {
              @if (buildable() > 0) {
                <label class="field">
                  <span>
                    Reveal {{ buildable() === 1 ? 'the selected item' : buildable() + ' selected items' }} on
                  </span>
                  <dbd-select
                    [options]="stepOptions"
                    [ngModel]="buildStep()"
                    (ngModelChange)="setBuildStep($event)"
                  />
                </label>
              }
              @if (pairable()) {
                <button class="btn wide" (click)="pairSelected()">
                  Treat the {{ pairable() }} selected items as the same object (morph)
                </button>
              }
            }
          }
        </div>
      }
      }
    </div>
    }
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
      .head {
        gap: 4px;
      }
      .pres {
        flex: 1 1 0;
        min-width: 0;
      }
      .pres-tools {
        display: flex;
        flex: none;
      }
      .rename {
        flex: 1 1 0;
        min-width: 0;
        height: 30px;
        font: inherit;
        font-weight: 600;
        color: var(--dbd-text);
        background: var(--dbd-surface-2);
        border: 1px solid var(--dbd-primary);
        border-radius: 8px;
        padding: 0 8px;
        box-sizing: border-box;
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
      .top {
        flex: none;
        padding: 0 10px;
      }
      .cards {
        flex: 1 1 0;
        /* The panel is as tall as the frame on screen, so the cards scroll within it. */
        min-height: 0;
        overflow-y: auto;
        padding: 0 10px 6px;
      }
      .below {
        flex: 1 1 auto;
        min-height: 0;
        display: flex;
        flex-direction: column;
      }
      .tabs {
        display: flex;
        align-items: center;
        gap: 2px;
        padding: 6px 8px;
      }
      .tab {
        border: none;
        background: transparent;
        color: var(--dbd-text-muted);
        font: inherit;
        font-size: 12px;
        font-weight: 600;
        padding: 5px 9px;
        border-radius: 8px;
        cursor: pointer;
      }
      .tab:hover {
        background: var(--dbd-surface-2);
        color: var(--dbd-text);
      }
      .tab.on {
        background: var(--dbd-primary-weak);
        color: var(--dbd-primary);
      }
      .fold {
        margin-left: auto;
      }
      .below.folded {
        align-items: stretch;
      }
      .strip {
        flex: 1 1 auto;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
        padding: 12px 0;
        border: none;
        background: transparent;
        color: var(--dbd-text-muted);
        font: inherit;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
      }
      .strip:hover {
        color: var(--dbd-text);
      }
      .vert {
        writing-mode: vertical-rl;
        letter-spacing: 0.04em;
      }
      .tabbody {
        flex: 1 1 auto;
        min-height: 0;
        overflow-y: auto;
        padding: 4px 12px 12px;
      }
      .who {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;
        font-size: 11px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--dbd-text-muted);
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
        gap: 2px;
        position: relative;
      }
      .card {
        position: relative;
        display: grid;
        grid-template-columns: 148px 1fr;
        justify-content: stretch;
        align-items: stretch;
        gap: 6px;
        padding: 4px 6px;
        border-radius: 10px;
        border: 1px solid transparent;
        cursor: pointer;
      }
      .card:hover {
        background: var(--dbd-surface-2);
      }
      .card.on {
        background: var(--dbd-primary-weak);
        border-color: color-mix(in srgb, var(--dbd-primary) 40%, transparent);
      }
      .card.current .thumb {
        border-color: var(--dbd-primary);
      }
      .card.hidden .thumb {
        opacity: 0.45;
      }
      .card {
        touch-action: none;
        user-select: none;
      }
      /* While reordering, the other cards slide out of the way with the drag. */
      .list.reordering .card:not(.dragging) {
        transition: transform 160ms cubic-bezier(0.2, 0, 0, 1);
      }
      /* The dragged card is the drag preview: lifted, and glued to the pointer. */
      .card.dragging {
        z-index: 5;
        cursor: grabbing;
        background: var(--dbd-surface-2);
        box-shadow: 0 8px 24px rgb(0 0 0 / 0.28);
        transition: box-shadow 120ms;
      }
      .card.ghost {
        position: absolute;
        left: 0;
        right: 0;
        pointer-events: none;
        box-sizing: border-box;
      }
      .card.pending {
        opacity: 0.6;
      }
      .card.dragging.settling {
        transition:
          transform 170ms cubic-bezier(0.2, 0, 0, 1),
          box-shadow 120ms;
      }
      .icons {
        justify-self: end;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-start;
        gap: 2px;
      }
      .icons .icon {
        width: 26px;
        height: 24px;
        flex: none;
        padding: 0;
      }
      .row.current .num {
        color: var(--dbd-primary);
      }
      .row.current .name {
        color: var(--dbd-primary);
      }
      .row.over {
        box-shadow: 0 -2px 0 var(--dbd-primary);
      }
      .row.hidden .thumb,
      .row.hidden .meta {
        opacity: 0.45;
      }
      .num {
        position: absolute;
        left: 6px;
        top: 5px;
        min-width: 18px;
        padding: 1px 5px;
        border-radius: 999px;
        background: rgba(0, 0, 0, 0.55);
        color: #fff;
        font-size: 11px;
        font-weight: 700;
        text-align: center;
      }
      .thumb {
        position: relative;
        display: block;
        width: 100%;
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
      .more {
        justify-self: end;
      }
      .listbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 4px 6px;
        font-size: 12px;
      }
      .muted {
        color: var(--dbd-text-muted);
      }
      .btn.on {
        background: var(--dbd-primary-weak);
        border-color: color-mix(in srgb, var(--dbd-primary) 40%, transparent);
        color: var(--dbd-primary);
      }
      .detail,
      .loose {
        margin-top: 14px;
        padding-top: 12px;
        border-top: 1px solid var(--dbd-border);
      }
      .detail .link {
        margin-bottom: 8px;
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
  /** `list`: the slide cards (left of the frame); `settings`: transition/size/notes (right). */
  readonly part = input<'list' | 'settings'>('list');
  /** Settings panel only: folded sideways to a narrow strip. */
  readonly folded = input<boolean>(false);
  /** The slide currently shown on the canvas (the only one visible). */
  readonly active_ = input<string | null>(null, { alias: 'active' });

  protected readonly store = inject(ProjectStore);
  private readonly render = inject(SlideRenderService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly typeOptions = TYPE_OPTIONS;
  protected readonly directionOptions = DIRECTION_OPTIONS;
  protected readonly easingOptions = EASING_OPTIONS;
  protected readonly stepOptions = STEP_OPTIONS;

  protected readonly canEdit = this.store.canEdit;
  /** Slides of the selected presentation, in order (skipped ones included). */
  protected readonly frames = this.store.presentationFrames;
  protected readonly presentation = this.store.presentation;
  protected readonly presentationOptions = computed<SelectOption<string>[]>(() =>
    this.store.presentations().map((name) => ({ value: name, label: name })),
  );
  protected readonly renaming = signal(false);

  /** A name for a new presentation: the next free "Presentation N". */
  protected newPresentationName(): string {
    return nextCopyName(this.presentation() ?? DEFAULT_PRESENTATION, this.store.presentations());
  }

  /** Rename the selected presentation (every one of its slides carries the name). */
  protected commitRename(raw: string): void {
    if (!this.renaming()) {
      return;
    }
    this.renaming.set(false);
    const current = this.presentation();
    const name = raw.trim().slice(0, 120);
    if (!current || !name || name === current || this.store.presentations().includes(name)) {
      return;
    }
    const slides = this.frames();
    this.store.selectPresentation(name);
    void this.store.batchHistory(async () => {
      for (const f of slides) {
        if (f.slide) {
          await this.store.updateElement(f.id, { slide: { ...f.slide, presentation: name } });
        }
      }
    });
  }
  /** Ids in the order just dropped, held until the store has caught up with the writes. */
  private readonly pendingOrder = signal<string[] | null>(null);
  /** The slides as listed: the store order, or the just-dropped order while it persists. */
  protected readonly shown = computed(() => {
    const frames = this.frames();
    const pending = this.pendingOrder();
    let list = frames;
    if (pending) {
      const rank = new Map(pending.map((id, i) => [id, i] as const));
      list = [...frames].sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
    }
    // A slide being cloned shows as a stand-in until the real copy arrives.
    const clone = this.pendingClone();
    const src = clone && list.find((f) => f.id === clone.srcId);
    if (clone && src) {
      list = [...list];
      list.splice(clone.to, 0, { ...src, id: this.pendingCloneId });
    }
    return list;
  });
  /** Stand-in id for a slide copy that is still being created. */
  protected readonly pendingCloneId = '__pending-clone__';
  private readonly pendingClone = signal<{ srcId: string; to: number; known: Set<string> } | null>(
    null,
  );
  private readonly dropWatch = effect(() => {
    const clone = this.pendingClone();
    const frames = this.frames();
    // The copy has arrived once the slide at its drop slot is one we did not have before.
    if (clone && frames[clone.to] && !clone.known.has(frames[clone.to].id)) {
      untracked(() => this.pendingClone.set(null));
    }
  });

  /** Frame to show in the thumbnail: stand-ins borrow their source's picture. */
  protected thumbId(f: CanvasElementModel): string {
    return f.id === this.pendingCloneId ? (this.pendingClone()?.srcId ?? f.id) : f.id;
  }
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
  /** The detail tabs of the settings panel. */
  protected readonly tab = signal<'transition' | 'size' | 'notes' | 'build'>('transition');

  protected pick(tab: 'transition' | 'size' | 'notes' | 'build'): void {
    this.tab.set(tab);
  }

  /** The selected slides (the details edit all of them at once). */
  protected readonly activeSlides = computed<CanvasElementModel[]>(() => {
    const ids = new Set(this.store.selectedElementIds());
    return this.frames().filter((f) => ids.has(f.id));
  });
  protected readonly selectedCount = computed(() => this.activeSlides().length);
  /** The slide the details show: the first selected one, else the slide on the canvas. */
  protected readonly active = computed<CanvasElementModel | null>(
    () =>
      this.activeSlides()[0] ??
      this.frames().find((f) => f.id === this.active_()) ??
      null,
  );
  protected readonly activeId = computed(() => this.active()?.id ?? null);
  protected readonly activeNumber = computed(() => {
    const id = this.activeId();
    return id ? this.frames().findIndex((f) => f.id === id) + 1 : 0;
  });
  /** False when the only slide in play is the first (nothing transitions into it). */
  protected readonly hasTransitionTarget = computed(() => {
    const first = this.frames()[0]?.id;
    const targets = this.activeSlides().length
      ? this.activeSlides()
      : this.active()
        ? [this.active()!]
        : [];
    return targets.some((f) => f.id !== first);
  });

  protected readonly sizeOptions = computed<SelectOption<string>[]>(() => {
    const opts = FRAME_PRESETS.map((p) => ({
      value: p.id,
      label: `${p.label} (${p.width} × ${p.height})`,
    }));
    return this.sizeValue() === 'custom'
      ? [{ value: 'custom', label: 'Custom / mixed' }, ...opts]
      : opts;
  });
  /** The preset every slide matches, or 'custom'. */
  protected readonly sizeValue = computed(() => {
    // Every slide of the project shares one size, whatever presentation it is in.
    const slides = this.store.slideFrames();
    const hit = FRAME_PRESETS.find((p) =>
      slides.every((f) => Math.round(f.width) === p.width && Math.round(f.height) === p.height),
    );
    return slides.length && hit ? hit.id : 'custom';
  });
  protected readonly transition = computed<SlideTransition>(() =>
    effectiveTransition(
      (this.activeSlides().find((f) => f.id !== this.frames()[0]?.id) ?? this.active())?.slide,
    ),
  );

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
  /** How many selected non-frame elements could be linked as one object (2+). */
  protected readonly pairable = computed(() => {
    const n = this.buildTargets().length;
    return n >= 2 ? n : 0;
  });

  private renderToken = 0;

  constructor() {
    // Re-render thumbnails (debounced) whenever anything that can appear on a slide changes.
    effect((onCleanup) => {
      if (this.part() !== 'list') {
        return;
      }
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

  /** Change the transition of the selected slides (the first slide has none). */
  protected setTransition(patch: Partial<SlideTransition>): void {
    const first = this.frames()[0]?.id;
    const base = this.activeSlides().length
      ? this.activeSlides()
      : this.active()
        ? [this.active()!]
        : [];
    const targets = base.filter((f) => f.slide && f.id !== first);
    if (!targets.length) {
      return;
    }
    void this.store.batchHistory(async () => {
      for (const f of targets) {
        const slide: SlideConfig = {
          ...f.slide!,
          transition: { ...effectiveTransition(f.slide), ...patch },
        };
        await this.store.updateElement(f.id, { slide });
      }
    });
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

  protected isSelected(id: string): boolean {
    return this.activeSlides().some((f) => f.id === id);
  }

  protected selectAll(): void {
    this.store.setSelection([], [], this.frames().map((f) => f.id));
  }

  /** Plain click shows that slide; Ctrl/Cmd/Shift-click toggles it in the selection. */
  protected onRowClick(f: CanvasElementModel, event: MouseEvent): void {
    if (this.suppressClick || f.id === this.pendingCloneId) {
      return;
    }
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      const ids = new Set(this.activeSlides().map((x) => x.id));
      if (ids.has(f.id)) {
        ids.delete(f.id);
      } else {
        ids.add(f.id);
      }
      this.store.setSelection([], [], [...ids]);
      return;
    }
    this.command.emit({ kind: 'focus', id: f.id });
  }

  /** Resize every slide to a preset: all slides share one size. */
  protected setSize(presetId: string): void {
    const preset = FRAME_PRESETS.find((p) => p.id === presetId);
    const targets = this.store.slideFrames();
    if (!preset || !targets.length) {
      return;
    }
    void this.store.batchHistory(async () => {
      for (const f of targets) {
        if (Math.round(f.width) !== preset.width || Math.round(f.height) !== preset.height) {
          await this.store.updateElement(f.id, { width: preset.width, height: preset.height });
        }
      }
    });
  }

  protected readonly draggingIndex = signal<number | null>(null);
  private suppressClick = false;
  private readonly host = inject(ElementRef<HTMLElement>);

  /** Pointer travel of the dragged card (px), in list coordinates. */
  protected readonly dragDy = signal(0);
  /** How far the cards between the pick-up and drop slots move: dragged height + gap. */
  private readonly dragStep = signal(0);
  /** The dragged card is gliding into its slot after release. */
  protected readonly settling = signal(false);
  /** Alt is down mid-drag: the pointer carries a copy instead of moving the slide. */
  protected readonly cloning = signal(false);
  /** Floating copy shown while cloning, laid over the original's slot. */
  protected readonly cloneGhost = signal<{
    id: string;
    top: number;
    height: number;
    fw: number;
    fh: number;
  } | null>(null);

  /** Transform for a card during a drag: the preview follows the pointer, the rest make room. */
  protected cardTransform(i: number): string | null {
    const from = this.draggingIndex();
    const to = this.overIndex();
    if (from === null || to === null) {
      return null;
    }
    if (this.cloning()) {
      // Alt-drag: the original stays; everything from the insertion point makes room.
      return i >= to ? `translateY(${this.dragStep()}px)` : null;
    }
    if (i === from) {
      return `translateY(${this.dragDy()}px) scale(1.02)`;
    }
    const step = this.dragStep();
    if (from < to && i > from && i <= to) {
      return `translateY(${-step}px)`;
    }
    if (from > to && i >= to && i < from) {
      return `translateY(${step}px)`;
    }
    return null;
  }

  /**
   * Drag a card to reorder the slides (hold Alt to duplicate it there). Built on
   * pointer events like the rest of the canvas, so it works for mouse, pen and touch.
   */
  protected onCardDown(index: number, event: PointerEvent): void {
    if (event.button !== 0 || !this.canEdit()) {
      return;
    }
    if ((event.target as HTMLElement).closest('button')) {
      return;
    }
    if (this.draggingIndex() !== null || this.shown()[index]?.id === this.pendingCloneId) {
      return;
    }
    const startX = event.clientX;
    const startY = event.clientY;
    const scroller = (this.host.nativeElement as HTMLElement).querySelector<HTMLElement>('.cards');
    const startScroll = scroller?.scrollTop ?? 0;
    // Slot geometry in scroll-content coordinates, captured before anything moves.
    const cards = Array.from(
      (this.host.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('li.card'),
    );
    const slots = cards.map((el) => ({ top: el.offsetTop, height: el.offsetHeight }));
    const me = slots[index];
    if (!me) {
      return;
    }
    const gap = slots.length > 1 ? Math.max(0, slots[1].top - slots[0].top - slots[0].height) : 0;
    const centers = slots.map((s) => s.top + s.height / 2);
    const srcFrame = this.shown()[index];
    let started = false;
    let lastY = startY;
    let alt = event.altKey;
    let raf = 0;

    /** Insertion point (0..n) for a copy: how many slot centres lie above the dragged one. */
    const insertionFor = (dy: number): number => {
      const c = centers[index] + dy;
      return centers.filter((v) => v < c).length;
    };
    /** Slot the dragged card's centre currently falls into. */
    const targetFor = (dy: number): number => {
      const c = centers[index] + dy;
      let best = 0;
      let bestDist = Infinity;
      centers.forEach((v, i) => {
        const d = Math.abs(v - c);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      });
      return best;
    };
    const travel = (): number => lastY - startY + ((scroller?.scrollTop ?? 0) - startScroll);
    const setCloning = (on: boolean): void => {
      if (this.cloning() === on) {
        return;
      }
      this.cloning.set(on);
      this.cloneGhost.set(
        on && srcFrame
          ? { id: srcFrame.id, top: me.top, height: me.height, fw: srcFrame.width, fh: srcFrame.height }
          : null,
      );
    };
    const update = (): void => {
      const dy = travel();
      setCloning(alt);
      this.dragDy.set(dy);
      this.overIndex.set(alt ? insertionFor(dy) : targetFor(dy));
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Alt' && started && !this.settling()) {
        alt = e.type === 'keydown';
        update();
      }
    };
    const tick = (): void => {
      // Keep scrolling the list while the pointer rests near its top or bottom edge.
      if (scroller) {
        const r = scroller.getBoundingClientRect();
        if (lastY < r.top + 28) {
          scroller.scrollTop -= 10;
        } else if (lastY > r.bottom - 28) {
          scroller.scrollTop += 10;
        }
      }
      update();
      raf = requestAnimationFrame(tick);
    };

    const move = (e: PointerEvent): void => {
      lastY = e.clientY;
      alt = e.altKey;
      if (!started) {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < 5) {
          return;
        }
        started = true;
        this.dragStep.set(me.height + gap);
        this.settling.set(false);
        this.draggingIndex.set(index);
        raf = requestAnimationFrame(tick);
      }
      update();
    };
    const up = (e: PointerEvent): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      cancelAnimationFrame(raf);
      if (!started) {
        return;
      }
      // The click that follows a drag must not also select the slide.
      this.suppressClick = true;
      setTimeout(() => (this.suppressClick = false), 0);
      const clear = (): void => {
        this.settling.set(false);
        this.cloning.set(false);
        this.cloneGhost.set(null);
        this.draggingIndex.set(null);
        this.overIndex.set(null);
        this.dragDy.set(0);
      };
      const dropped = e.type === 'pointerup';
      // Copy mode (Alt held at release): glide the copy into the gap, then create it.
      if (dropped && alt && srcFrame) {
        const n = slots.length;
        const to = insertionFor(travel());
        const landing = to < n ? slots[to].top : slots[n - 1].top + slots[n - 1].height + gap;
        this.overIndex.set(to);
        this.settling.set(true);
        this.dragDy.set(landing - me.top);
        setTimeout(() => {
          // Keep a stand-in in the gap until the real copy shows up.
          this.pendingClone.set({
            srcId: srcFrame.id,
            to,
            known: new Set(this.frames().map((f) => f.id)),
          });
          setTimeout(() => this.pendingClone.set(null), 5000);
          clear();
          this.command.emit({ kind: 'duplicate', id: srcFrame.id, toIndex: to });
        }, 180);
        return;
      }
      // Glide the preview into its slot (or back, if cancelled), then commit.
      setCloning(false);
      const to = dropped ? targetFor(travel()) : index;
      const landing = to > index ? slots[to].top + slots[to].height - me.height : slots[to].top;
      this.overIndex.set(to);
      this.settling.set(true);
      this.dragDy.set(landing - me.top);
      setTimeout(() => {
        clear();
        this.reorder(index, to, false);
      }, 180);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
  }

  private reorder(from: number, to: number, duplicate: boolean): void {
    if (duplicate) {
      // Alt-drag duplicates the slide (with its contents) into the drop position.
      const src = this.shown()[from];
      if (src) {
        this.command.emit({ kind: 'duplicate', id: src.id, toIndex: to });
      }
      return;
    }
    if (from === to) {
      return;
    }
    const list = [...this.shown()];
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);
    // Show the new order straight away; the writes below land one at a time.
    this.pendingOrder.set(list.map((f) => f.id));
    void this.store
      .batchHistory(async () => {
        for (let i = 0; i < list.length; i += 1) {
          const f = list[i];
          if (f.slide && f.slide.order !== i) {
            await this.store.updateElement(f.id, { slide: { ...f.slide, order: i } });
          }
        }
      })
      .finally(() => this.pendingOrder.set(null));
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
