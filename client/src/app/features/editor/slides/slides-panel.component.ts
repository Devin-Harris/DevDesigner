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
  effectiveTransition,
  morphIdForTag,
  morphTagOf,
  presentationSlides,
  type CanvasElementModel,
  type MorphBy,
  type SlideConfig,
  type SlideDirection,
  type SlideEasing,
  type SlideTransition,
  type SlideTransitionType,
} from '@dbdesigner/shared';
import { IconComponent } from '../../../shared/ui/icon/icon.component';
import { SelectComponent, type SelectOption } from '../../../shared/ui/select/select.component';
import { TagInputComponent } from '../../../shared/ui/tag-input/tag-input.component';
import { ProjectStore } from '../../../stores/project.store';
import { FRAME_PRESETS } from '../canvas/constants/frame-presets';
import { elementBox, tableBox } from '../canvas/helpers/element-geometry.helper';
import { contentForFrame, sequenceDiagramBox } from '../canvas/helpers/frame-contents.helper';
import { AnimationPaneComponent } from './animation-pane.component';
import { MorphTagSuggestions } from './morph-tag-suggestions.service';
import { SlideRenderService } from './slide-render.service';

/** What the panel asks the editor to do (things that need canvas knowledge). */
export type SlidesCommand =
  | { kind: 'present'; from: 'start' | 'current' }
  | { kind: 'preview'; id: string }
  | { kind: 'focus'; id: string }
  | { kind: 'duplicate'; id: string; toIndex?: number }
  | { kind: 'delete'; id: string }
  | { kind: 'add' }
  | { kind: 'deletePresentation' }
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
const MORPH_BY_SELECT: SelectOption<MorphBy>[] = [
  { value: 'character', label: 'Characters' },
  { value: 'word', label: 'Words' },
  { value: 'object', label: 'Objects' },
];
const EASING_OPTIONS: SelectOption<SlideEasing>[] = [
  { value: 'ease-in-out', label: 'Ease in-out' },
  { value: 'ease', label: 'Ease' },
  { value: 'ease-in', label: 'Ease in' },
  { value: 'ease-out', label: 'Ease out' },
  { value: 'linear', label: 'Linear' },
];

/**
 * Scroll a slide card into view inside its own scrolling list only. `scrollIntoView`
 * would also scroll the canvas when the panel is panned off screen, dragging the
 * toolbars and minimap away with it.
 */
function revealCard(card: Element | undefined, within: HTMLElement | null): void {
  let list = card?.parentElement ?? null;
  while (list && list !== within && !/(auto|scroll)/.test(getComputedStyle(list).overflowY)) {
    list = list.parentElement;
  }
  if (!card || !list || !/(auto|scroll)/.test(getComputedStyle(list).overflowY)) {
    return;
  }
  const box = list.getBoundingClientRect();
  const r = card.getBoundingClientRect();
  // The panel is scaled with the canvas zoom; scrollTop is in unscaled px.
  const scale = box.height / (list.offsetHeight || 1) || 1;
  if (r.top < box.top) {
    list.scrollTop -= (box.top - r.top) / scale;
  } else if (r.bottom > box.bottom) {
    list.scrollTop += (r.bottom - box.bottom) / scale;
  }
}

/**
 * The slide sorter:the project's presentation as a list of frame thumbnails.
 * Reorder by dragging, skip/duplicate/remove per slide, and edit the selected
 * slide's transition and speaker notes. All edits are ordinary frame updates, so
 * they sync live and undo/redo like any other change.
 */
@Component({
  selector: 'app-slides-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AnimationPaneComponent, FormsModule, IconComponent, SelectComponent, TagInputComponent],
  template: `
    @if (part() === 'list') {
    <header class="head">
      <input
        class="rename"
        type="text"
        maxlength="120"
        aria-label="Presentation name"
        [value]="presentation()"
        [disabled]="!canEdit()"
        (keydown.enter)="$any($event.target).blur()"
        (keydown.escape)="cancelRename($any($event.target))"
        (blur)="commitRename($any($event.target))"
      />
      @if (canEdit()) {
        <button
          class="icon"
          (click)="command.emit({ kind: 'deletePresentation' })"
          title="Delete presentation and its slides"
          aria-label="Delete presentation"
        >
          <dbd-icon name="delete" />
        </button>
      }
    </header>

    <div class="actions">
      <div class="split">
        <button
          class="main"
          [disabled]="!playable()"
          (click)="command.emit({ kind: 'present', from: 'start' })"
          title="Present from the first slide"
        >
          <dbd-icon name="play_arrow" />Present
        </button>
        <button
          class="from"
          [disabled]="!playable()"
          (click)="command.emit({ kind: 'present', from: 'current' })"
          title="Present from the selected slide"
        >
          From here
        </button>
      </div>
      @if (canEdit()) {
        <button class="btn new" (click)="command.emit({ kind: 'add' })" title="Add a new 16:9 slide">
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
    <div
      class="cards"
      tabindex="0"
      (keydown.arrowUp)="stepSlide(-1, $event)"
      (keydown.arrowDown)="stepSlide(1, $event)"
    >
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
            <span class="num">{{ i + 1 }}</span>
            <span class="thumb" [style.aspect-ratio]="f.width + ' / ' + f.height">
              @if (thumbs().get(thumbId(f)); as src) {
                <img [src]="src" alt="" draggable="false" />
              }
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
            <span class="num">+</span>
            <span class="thumb" [style.aspect-ratio]="g.fw + ' / ' + g.fh">
              @if (thumbs().get(g.id); as src) {
                <img [src]="src" alt="" draggable="false" />
              }
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
        @if (active()) {
          <button class="tab" [class.on]="tab() === 'animations'" (click)="pick('animations')">
            Animations
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
                  @if (transition().type === 'morph') {
                    <label class="field">
                      <span>Animate text by</span>
                      <dbd-select
                        [options]="morphByOptions"
                        [ngModel]="transition().morphBy ?? 'character'"
                        [disabled]="!canEdit()"
                        (ngModelChange)="setTransition({ morphBy: $event })"
                      />
                    </label>
                    <p class="hint">
                      Characters: letters and words glide. Words: whole words glide. Objects: text
                      moves as one piece and cross-fades.
                    </p>
                  }
                  @if (canEdit() && frames().length > 2) {
                    <button class="link" (click)="applyToAll()">Apply to all slides</button>
                  }
                }
              } @else {
                <p class="hint">Select a slide to set its transition.</p>
              }
              @if (canEdit() && morphRelevant()) {
              @if (tagCount() > 0) {
                <div class="field">
                  <span>Morph tag</span>
                  <dbd-tag-input
                    [value]="morphTag()"
                    [suggestions]="morphTagSuggestions()"
                    [taken]="takenTags()"
                    [maxlength]="80"
                    [disabled]="!store.canEdit() || tagCount() > 1"
                    [placeholder]="
                      tagCount() > 1
                        ? 'Select a single object to tag it'
                        : 'Name it, or pick one from the previous slide'
                    "
                    (commit)="setMorphTag($event)"
                  />
                </div>
                <p class="hint">
                  Tagged objects only morph into the object with the same tag on the next slide;
                  they are never matched to look-alikes.
                </p>
              }
              @if (pairable()) {
                <button class="btn wide" (click)="pairSelected()">
                  Treat the {{ pairable() }} selected items as the same object (morph)
                </button>
              }
            
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
            @case ('animations') {
              @if (active(); as a) {
                @if (activeSlides().length <= 1) {
                  <app-animation-pane
                    [slide]="a"
                    (play)="command.emit({ kind: 'present', from: 'current' })"
                  />
                } @else {
                  <p class="hint">Select a single slide to edit its animations.</p>
                }
              } @else {
                <p class="hint">Select a slide to edit its animations.</p>
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
      .rename {
        flex: 1 1 0;
        min-width: 0;
        height: 30px;
        font: inherit;
        font-weight: 600;
        color: var(--dbd-text);
        background: transparent;
        border: 1px solid transparent;
        border-radius: 8px;
        padding: 0 8px;
        box-sizing: border-box;
        text-overflow: ellipsis;
      }
      .rename:hover:not(:disabled) {
        background: var(--dbd-surface-2);
      }
      .rename:focus {
        outline: none;
        background: var(--dbd-surface-2);
        border-color: var(--dbd-primary);
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
        align-items: center;
      }
      .split {
        display: inline-flex;
        flex: 1 1 auto;
        min-width: 0;
      }
      .split button {
        height: 32px;
        border: 1px solid var(--dbd-border);
        font: inherit;
        font-weight: 600;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        white-space: nowrap;
      }
      .split .main {
        flex: 1 1 auto;
        gap: 6px;
        padding: 0 12px;
        border-radius: 8px 0 0 8px;
        background: var(--dbd-primary);
        border-color: var(--dbd-primary);
        color: #fff;
      }
      .split .from {
        flex: none;
        padding: 0 12px;
        border-radius: 0 8px 8px 0;
        border-left: none;
        background: var(--dbd-surface-2);
        color: var(--dbd-text);
      }
      .split button:hover:not(:disabled) {
        filter: brightness(1.12);
      }
      .split button:disabled {
        opacity: 0.45;
        cursor: default;
      }
      .btn.new {
        flex: none;
        height: 32px;
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
      .cards:focus {
        outline: none;
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
        grid-template-columns: 18px minmax(0, 1fr) auto;
        align-items: center;
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
        justify-content: center;
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
        color: var(--dbd-text-muted);
        font-size: 11px;
        font-weight: 700;
        text-align: center;
      }
      .card.current .num {
        color: var(--dbd-primary);
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
  /** The slide of this presentation currently shown on the canvas (the only one visible). */
  readonly active_ = input<string | null>(null, { alias: 'active' });
  /** The presentation this panel belongs to (its name). */
  readonly presentation = input.required<string>();

  protected readonly store = inject(ProjectStore);
  private readonly render = inject(SlideRenderService);
  private readonly tagSuggestions = inject(MorphTagSuggestions);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly typeOptions = TYPE_OPTIONS;
  protected readonly directionOptions = DIRECTION_OPTIONS;
  protected readonly easingOptions = EASING_OPTIONS;
  protected readonly morphByOptions = MORPH_BY_SELECT;

  protected readonly canEdit = this.store.canEdit;
  /** Slides of this presentation, in order (skipped ones included). */
  protected readonly frames = computed(() =>
    presentationSlides(this.store.slideFrames(), this.presentation()),
  );

  /** Put the saved name back (Escape, or a name that is empty or already taken). */
  protected cancelRename(input: HTMLInputElement): void {
    input.value = this.presentation();
    input.blur();
  }

  /** Rename the presentation (every one of its slides carries the name). */
  protected commitRename(input: HTMLInputElement): void {
    const current = this.presentation();
    const name = input.value.trim().slice(0, 120);
    if (!name || name === current || this.store.presentations().includes(name)) {
      input.value = current;
      return;
    }
    const slides = this.frames();
    const shown = this.active_();
    void this.store
      .batchHistory(async () => {
        for (const f of slides) {
          if (f.slide) {
            await this.store.updateElement(f.id, { slide: { ...f.slide, presentation: name } });
          }
        }
      })
      // The shown slide and the selection follow the new name.
      .finally(() => (shown ? this.store.setActiveSlide(shown) : undefined));
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
  protected readonly tab = signal<'transition' | 'size' | 'notes' | 'animations'>('transition');

  protected pick(tab: 'transition' | 'size' | 'notes' | 'animations'): void {
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
  /** Keep the active slide's card in view (e.g. after leaving the presenter on another slide). */
  private readonly revealActive = effect(() => {
    const id = this.activeId();
    if (this.part() !== 'list' || !id) {
      return;
    }
    const index = this.shown().findIndex((f) => f.id === id);
    requestAnimationFrame(() => {
      const host = this.host.nativeElement as HTMLElement;
      revealCard(host.querySelectorAll('li.card')[index], host);
    });
  });
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
    // Every slide of a presentation shares one size.
    const slides = this.frames();
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

  /** True when a morph is involved: the transition into this slide or into the one before it. */
  protected readonly morphRelevant = computed(() => {
    const frames = this.frames();
    const i = frames.findIndex((f) => f.id === this.activeId());
    if (i < 0) {
      return false;
    }
    const isMorph = (f: CanvasElementModel | undefined): boolean =>
      !!f && effectiveTransition(f.slide).type === 'morph';
    return (i > 0 && isMorph(frames[i])) || (i > 1 && isMorph(frames[i - 1]));
  });
  /** Selected non-frame elements (what a morph tag or pairing applies to). */
  private readonly selectedObjects = computed(() => {
    const ids = new Set(this.store.selectedElementIds());
    return this.store.elements().filter((e) => ids.has(e.id) && e.type !== 'frame');
  });
  /**
   * Everything selected that can carry a morph tag: canvas elements plus sequence
   * participants, messages and diagrams (which the element selection doesn't hold).
   */
  private readonly tagTargets = computed(() => {
    const out: Array<{
      kind: 'element' | 'table' | 'lifeline' | 'message' | 'diagram';
      id: string;
      morphId?: string;
      slideId?: string;
    }> = this.selectedObjects().map((e) => ({
      kind: 'element',
      id: e.id,
      morphId: e.morphId,
      slideId: e.slideId,
    }));
    const tables = new Set(this.store.selectedTableIds());
    for (const t of this.store.tables()) {
      if (tables.has(t.id)) {
        out.push({ kind: 'table', id: t.id, morphId: t.morphId, slideId: t.slideId });
      }
    }
    const diagrams = new Map(this.store.sequenceDiagrams().map((d) => [d.id, d] as const));
    const lifelines = new Set(this.store.selectedLifelineIds());
    const messages = new Set(this.store.selectedMessageIds());
    const boxes = new Set(this.store.selectedDiagramIds());
    for (const l of this.store.lifelines()) {
      if (lifelines.has(l.id)) {
        out.push({ kind: 'lifeline', id: l.id, morphId: l.morphId, slideId: diagrams.get(l.diagramId)?.slideId });
      }
    }
    for (const m of this.store.sequenceMessages()) {
      if (messages.has(m.id)) {
        out.push({ kind: 'message', id: m.id, morphId: m.morphId, slideId: diagrams.get(m.diagramId)?.slideId });
      }
    }
    for (const d of diagrams.values()) {
      if (boxes.has(d.id)) {
        out.push({ kind: 'diagram', id: d.id, morphId: d.morphId, slideId: d.slideId });
      }
    }
    return out;
  });
  protected readonly tagCount = computed(() => this.tagTargets().length);
  /** Tags other objects on this slide already carry: one tag names one object per slide. */
  protected readonly takenTags = computed(() => {
    const targets = this.tagTargets();
    const slideId = targets.find((e) => e.slideId)?.slideId ?? this.store.activeSlideId();
    return this.tagSuggestions.tagsTakenOn(slideId, new Set(targets.map((t) => t.id)));
  });
  /** The morph tag shared by the selection ('' when none or they differ). */
  protected readonly morphTag = computed(() => {
    const tags = new Set(this.tagTargets().map((e) => morphTagOf(e.morphId) ?? ''));
    return tags.size === 1 ? [...tags][0] : '';
  });
  /** Tags used on the slide before the selection's, offered while typing a tag. */
  protected readonly morphTagSuggestions = computed(() =>
    this.tagSuggestions.previousSlideTags(
      this.tagTargets().find((e) => e.slideId)?.slideId ?? this.store.activeSlideId(),
    ),
  );
  /** How many selected non-frame elements could be linked as one object (2+). */
  protected readonly pairable = computed(() => {
    const n = this.selectedObjects().length;
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

  /**
   * Re-render only the slides whose content changed. Store rows are immutable, so a
   * slide is unchanged when its frame and every row drawn on it are the same object
   * references as at its last render; edits elsewhere on the canvas render nothing.
   */
  private async refreshThumbs(frames: readonly CanvasElementModel[]): Promise<void> {
    const ids = new Set(frames.map((f) => f.id));
    const deps = new Map(frames.map((f) => [f.id, this.thumbInputs(f)]));
    const dirty = frames.filter((f) => !sameInputs(this.thumbDeps.get(f.id), deps.get(f.id)!));
    const removed = [...this.thumbs().keys()].some((id) => !ids.has(id));
    if (!dirty.length && !removed) {
      return;
    }
    const token = (this.renderToken += 1);
    const rendered = dirty.length ? await this.render.render(dirty, { fonts: false }) : [];
    if (token !== this.renderToken) {
      return;
    }
    const next = new Map([...this.thumbs()].filter(([id]) => ids.has(id)));
    for (const r of rendered) {
      next.set(r.id, SlideRenderService.dataUrl(r.svg));
    }
    // Clean slides adopt the new rows too, so later comparisons stay cheap ref checks.
    for (const f of frames) {
      this.thumbDeps.set(f.id, deps.get(f.id)!);
    }
    for (const id of [...this.thumbDeps.keys()]) {
      if (!ids.has(id)) this.thumbDeps.delete(id);
    }
    this.thumbs.set(next);
  }

  /** Everything a slide's thumbnail is drawn from (the rows `SlideRenderService` uses). */
  private thumbInputs(frame: CanvasElementModel): readonly unknown[] {
    const mine = contentForFrame(
      frame.id,
      !!frame.slide,
      this.store.elements(),
      this.store.tables(),
      this.store.sequenceDiagrams(),
      this.store.lifelines(),
      this.store.sequenceMessages(),
    );
    // Rows not assigned to any slide are offered to every frame and cropped away when
    // outside it, so only those overlapping the frame affect its picture.
    const f = { x0: frame.x, y0: frame.y, x1: frame.x + frame.width, y1: frame.y + frame.height };
    const overlaps = (b: { x0: number; y0: number; x1: number; y1: number } | null): boolean =>
      !!b && b.x1 >= f.x0 && b.x0 <= f.x1 && b.y1 >= f.y0 && b.y0 <= f.y1;
    const elements = mine.elements.filter(
      (e) => e.id === frame.id || e.slideId === frame.id || overlaps(elementBox(e)),
    );
    const tables = mine.tables.filter((t) => t.slideId === frame.id || overlaps(tableBox(t)));
    const diagrams = mine.diagrams.filter(
      (d) =>
        d.slideId === frame.id ||
        overlaps(sequenceDiagramBox(d, mine.lifelines, mine.messages)),
    );
    const diagramIds = new Set(diagrams.map((d) => d.id));
    const columns = new Set(tables.flatMap((t) => t.columns.map((c) => c.id)));
    const relationships = this.store
      .relationships()
      .filter((r) => columns.has(r.sourceColumnId) || columns.has(r.targetColumnId));
    return [
      frame,
      ...elements,
      ...tables,
      ...diagrams,
      ...mine.lifelines.filter((l) => diagramIds.has(l.diagramId)),
      ...mine.messages.filter((m) => diagramIds.has(m.diagramId)),
      ...relationships,
    ];
  }

  /** Inputs each thumbnail was last rendered from. */
  private readonly thumbDeps = new Map<string, readonly unknown[]>();

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

  /** Up/Down arrows move to the previous/next slide. */
  protected stepSlide(delta: number, event: Event): void {
    const t = event.target as HTMLElement;
    if (t.closest('input, textarea, select, [contenteditable]')) {
      return;
    }
    event.preventDefault();
    const list = this.shown().filter((f) => f.id !== this.pendingCloneId);
    if (!list.length) {
      return;
    }
    const cur = list.findIndex((f) => f.id === this.activeId());
    const next = list[Math.min(list.length - 1, Math.max(0, cur < 0 ? 0 : cur + delta))];
    if (next && next.id !== this.activeId()) {
      this.command.emit({ kind: 'focus', id: next.id });
      const cards = event.currentTarget as HTMLElement | null;
      const index = this.shown().findIndex((f) => f.id === next.id);
      requestAnimationFrame(() => {
        revealCard(cards?.querySelectorAll('li.card')[index], cards);
      });
    }
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
    const targets = this.frames();
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

  /**
   * Tag the selected objects (elements and sequence parts; blank clears it) so only
   * same-tagged objects morph together.
   */
  protected setMorphTag(value: string): void {
    const morphId = morphIdForTag(value);
    const targets = this.tagTargets().filter((e) =>
      morphId === null ? morphTagOf(e.morphId) !== null : e.morphId !== morphId,
    );
    if (!targets.length) {
      return;
    }
    void this.store.batchHistory(async () => {
      for (const t of targets) {
        if (t.kind === 'element') {
          await this.store.updateElement(t.id, { morphId });
        } else if (t.kind === 'table') {
          await this.store.updateTable(t.id, { morphId: morphId ?? '' });
        } else if (t.kind === 'lifeline') {
          await this.store.updateLifeline(t.id, { morphId: morphId ?? '' });
        } else if (t.kind === 'message') {
          await this.store.updateMessage(t.id, { morphId: morphId ?? '' });
        } else {
          await this.store.updateSequenceConfig(t.id, { morphId: morphId ?? '' });
        }
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

/**
 * Whether a slide's thumbnail inputs are unchanged. `[0]` is the frame; rows that are
 * not the same reference still match when they differ only by the frame's own move
 * (the picture is cropped to the frame, so dragging a whole slide looks identical).
 */
function sameInputs(a: readonly unknown[] | undefined, b: readonly unknown[]): boolean {
  if (!a || a.length !== b.length) {
    return false;
  }
  const fa = a[0] as CanvasElementModel;
  const fb = b[0] as CanvasElementModel;
  const dx = fb.x - fa.x;
  const dy = fb.y - fa.y;
  return a.every((v, i) => v === b[i] || shiftedKey(v, 0, 0) === shiftedKey(b[i], dx, dy));
}

/** A row's JSON with its world-space position fields shifted back by (dx, dy). */
function shiftedKey(row: unknown, dx: number, dy: number): string {
  const r = row as Record<string, unknown>;
  const out: Record<string, unknown> = { ...r };
  if (typeof r['x'] === 'number') out['x'] = (r['x'] as number) - dx;
  if (typeof r['y'] === 'number') out['y'] = (r['y'] as number) - dy;
  if (typeof r['originY'] === 'number') out['originY'] = (r['originY'] as number) - dy;
  if (Array.isArray(r['waypoints'])) {
    out['waypoints'] = (r['waypoints'] as { x: number; y: number }[]).map((p) => ({
      ...p,
      x: p.x - dx,
      y: p.y - dy,
    }));
  }
  return JSON.stringify(out);
}
