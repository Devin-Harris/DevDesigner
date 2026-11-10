import { NgTemplateOutlet } from '@angular/common';
import { AutofocusDirective } from '../autofocus.directive';
import {
   Injectable,
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
import { MatTooltipModule } from '@angular/material/tooltip';
import {
   BUILT_IN_DESIGNS,
   BUILT_IN_LAYOUT_SETS,
   BUILT_IN_THEMES,
   DEFAULT_DESIGN,
   DEFAULT_LAYOUT_SET,
   DEFAULT_THEME,
   LAYOUT_KINDS,
   LAYOUT_KIND_LABELS,
   PLACEHOLDER_ROLES,
   THEME_COLOR_LABELS,
   THEME_COLOR_TOKENS,
   THEME_FILL,
   THEME_STROKE,
   effectiveTransition,
   isBuiltInRecord,
   layoutNameOf,
   layoutOf,
   masterOf,
   morphIdForTag,
   morphTagOf,
   parseThemeFile,
   presentableSlides,
   presentationLayouts,
   presentationMaster,
   presentationOf,
   presentationSlides,
   recordKind,
   themeFile,
   themeSwatchCss,
   themeTokensOnly,
   themeToken,
   tokenOf,
   type CanvasElementModel,
   type FontFamily,
   type LayoutKind,
   type MorphBy,
   type ParsedThemeFile,
   type PlaceholderConfig,
   type PlaceholderRole,
   type SlideConfig,
   type SlideDirection,
   type SlideEasing,
   type SlideTheme,
   type SlideTransition,
   type SlideTransitionType,
   type ThemeColorToken,
   type ThemeFilePart,
   type ThemeFontToken,
} from '@devdesigner/shared';
import { ThemeService } from '../../../core/services/theme.service';
import { UserThemesService } from '../../../core/services/user-themes.service';
import { CheckboxComponent } from '../../../shared/ui/checkbox/checkbox.component';
import { ColorSwatchesComponent } from '../../../shared/ui/color-swatches/color-swatches.component';
import { IconComponent } from '../../../shared/ui/icon/icon.component';
import { PopoverTriggerDirective } from '../../../shared/ui/popover/popover-trigger.directive';
import { SegmentedComponent, type SegmentedOption } from '../../../shared/ui/segmented/segmented.component';
import { SelectComponent, type SelectOption } from '../../../shared/ui/select/select.component';
import { TagInputComponent } from '../../../shared/ui/tag-input/tag-input.component';
import { ProjectStore } from '../../../stores/project.store';
import { FRAME_PRESETS } from '../canvas/constants/frame-presets';
import { elementBox, tableBox } from '../canvas/helpers/element-geometry.helper';
import { contentForFrame, sequenceDiagramBox } from '../canvas/helpers/frame-contents.helper';
import { FONT_OPTIONS, fontStack } from '../canvas/helpers/shape-render.helper';
import { ensureFontLoaded, fitTextElement } from '../canvas/helpers/text-metrics';
import { AnimationPaneComponent } from './animation-pane.component';
import {
   isLayoutStandIn,
   masterStandIns,
   placeholderDrift,
   placeholderGhosts,
   resetSlideToLayout,
   resetToMaster,
   standInChanged,
   switchLayout,
   syncLayoutCopies,
   type PlaceholderDrift,
} from './layout-placeholders';
import { MorphTagSuggestions } from './morph-tag-suggestions.service';
import { SlideRenderService } from './slide-render.service';
import { addStandardLayouts, applyLayoutSet, captureLayoutSet, deckLayouts, isForeignLayout } from './standard-layouts';

/** What the panel asks the editor to do (things that need canvas knowledge). */
/** Focus-mode view state that outlives the docks (they are rebuilt per screen). */
@Injectable({ providedIn: 'root' })
export class FocusUiState {
   readonly tab = signal<'slide' | 'transition' | 'animations' | 'notes'>('slide');
   /** The canvas settings panel's tab. */
   readonly canvasTab = signal<'transition' | 'design' | 'size' | 'notes' | 'animations'>('transition');

   /** Entering focus: open the same tab there (Design / Size live in the top bar, so Slide). */
   toFocus(): void {
      const t = this.canvasTab();
      this.tab.set(t === 'transition' || t === 'animations' || t === 'notes' ? t : 'slide');
   }

   /** Leaving focus: the canvas panel shows the tab that was open in focus mode. */
   fromFocus(): void {
      const t = this.tab();
      if (t !== 'slide') this.canvasTab.set(t);
   }
}

export type SlidesCommand =
   | { kind: 'present'; from: 'start' | 'current' }
   | { kind: 'preview'; id: string }
   | { kind: 'focus'; id: string }
   | { kind: 'duplicate'; id: string; ids?: string[]; toIndex?: number }
   | { kind: 'delete'; id: string }
   /** `layout`: add a layout; `layoutId`: the new slide's layout (null = blank, absent = as shown). */
   | { kind: 'add'; layout?: boolean; layoutId?: string | null }
   | { kind: 'deletePresentation' }
   | { kind: 'close' }
   | { kind: 'fold' }
   /** Focus mode: open one of its screens (DeckMorph / DeckAnim / DeckDesign mocks). */
   | { kind: 'screen'; screen: 'main' | 'morph' | 'anim' | 'design' };

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
   imports: [
      NgTemplateOutlet,
      AutofocusDirective,
      AnimationPaneComponent,
      CheckboxComponent,
      ColorSwatchesComponent,
      FormsModule,
      IconComponent,
      PopoverTriggerDirective,
      MatTooltipModule,
      SelectComponent,
      SegmentedComponent,
      TagInputComponent,
   ],
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
                  <dd-icon name="delete" />
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
                  <dd-icon name="play_arrow" />Present
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
               <div class="newsplit">
                  <button
                     class="btn new"
                     (click)="command.emit({ kind: 'add' })"
                     [title]="newLayoutName() ? 'Add a slide using ' + newLayoutName() : 'Add a new 16:9 slide'"
                  >
                     <dd-icon name="add" />New
                  </button>
                  <button
                     class="btn caret"
                     (click)="newMenu.set(!newMenu())"
                     aria-label="Choose the new slide's layout"
                     title="New slide with a layout…"
                  >
                     <dd-icon name="expand_more" />
                  </button>
                  @if (newMenu()) {
                     <div class="menu" role="menu" (pointerdown)="$event.stopPropagation()">
                        @for (l of menuLayouts(); track l.id) {
                           <button role="menuitem" (click)="addWithLayout(l.id)">
                              <span class="mthumb" [style.aspect-ratio]="l.width + ' / ' + l.height">
                                 @if (layoutThumbs().get(l.id); as src) {
                                    <img [src]="src" alt="" draggable="false" />
                                 }</span
                              >{{ layoutName(l) }}
                           </button>
                        }
                        @if (!layouts().length) {
                           <p class="hint">Add layouts in the settings panel's Design tab.</p>
                        }
                     </div>
                  }
               </div>
            }
         </div>

         <div class="top">
            @if (frames().length === 0) {
               <p class="empty">
                  No slides yet. Press <b>New</b> to add a 16:9 slide, or select a frame and add it here. Only one slide
                  is shown on the canvas at a time; everything inside its frame is part of it.
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
                     [class.current]="f.id === (shownLayout() ? lastSlide() : active_())"
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
                        @if (slideForeign(f)) {
                           <dd-icon
                              name="warning"
                              class="foreign"
                              matTooltip="Its layout is not one of this design's layouts"
                           />
                        }
                     </span>
                     @if (canEdit() && f.id !== pendingCloneId) {
                        <span class="icons" (click)="$event.stopPropagation()">
                           <button
                              class="icon"
                              (click)="toggleHidden(f)"
                              [title]="
                                 f.slide?.hidden ? 'Skipped: include in the presentation' : 'Skip in the presentation'
                              "
                              aria-label="Skip slide"
                           >
                              <dd-icon [name]="f.slide?.hidden ? 'visibility_off' : 'visibility'" />
                           </button>
                           <button
                              class="icon"
                              (click)="command.emit({ kind: 'duplicate', id: f.id })"
                              title="Duplicate slide"
                              aria-label="Duplicate slide"
                           >
                              <dd-icon name="content_copy" />
                           </button>
                           <button
                              class="icon"
                              (click)="command.emit({ kind: 'delete', id: f.id })"
                              title="Delete slide and its contents"
                              aria-label="Delete slide"
                           >
                              <dd-icon name="delete" />
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
                     <span class="num">+{{ g.count > 1 ? g.count : '' }}</span>
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
                  <dd-icon name="chevron_left" />
                  <span class="vert">Slide settings</span>
               </button>
            } @else {
               <div class="tabs" role="tablist">
                  <button class="tab" [class.on]="tab() === 'transition'" (click)="pick('transition')">
                     Transition
                  </button>
                  <button class="tab" [class.on]="tab() === 'size'" (click)="pick('size')">Size</button>
                  <button class="tab" [class.on]="tab() === 'design'" (click)="pick('design')">Design</button>
                  <button class="tab" [class.on]="tab() === 'notes'" (click)="pick('notes')">Notes</button>
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
                     <dd-icon name="chevron_right" />
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
                                       <dd-icon name="play_arrow" />Preview
                                    </button>
                                 }
                              </div>
                              @if (!hasTransitionTarget()) {
                                 <p class="hint">The first slide has no transition into it.</p>
                                 @if (morphRelevantNext()) {
                                    <button
                                       class="btn wide map-pairs"
                                       (click)="command.emit({ kind: 'screen', screen: 'morph' })"
                                       title="See what morphs into what on the next slide, and change it"
                                    >
                                       <dd-icon name="open_in_full" />Refine
                                    </button>
                                 }
                              } @else {
                                 <label class="field">
                                    <span
                                       >Transition into
                                       {{ activeSlides().length > 1 ? 'these slides' : 'this slide' }}</span
                                    >
                                    <dd-select
                                       [options]="typeOptions"
                                       [ngModel]="transition().type"
                                       [disabled]="!canEdit()"
                                       (ngModelChange)="setTransition({ type: $event })"
                                    />
                                 </label>
                                 @if (transition().type === 'slide') {
                                    <label class="field">
                                       <span>Direction</span>
                                       <dd-select
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
                                          <dd-select
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
                                       <dd-select
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
                                 @if (activeSlides().length <= 1) {
                                    <button
                                       class="btn wide map-pairs"
                                       (click)="command.emit({ kind: 'screen', screen: 'morph' })"
                                       title="See what morphs into what, and change it"
                                    >
                                       <dd-icon name="open_in_full" />Refine
                                    </button>
                                 }
                              }
                           } @else {
                              <p class="hint">Select a slide to set its transition.</p>
                           }
                           @if (canEdit() && morphRelevant()) {
                              @if (tagCount() > 0) {
                                 <div class="field">
                                    <span class="tagline">
                                       Morph tag
                                       @if (splitTarget(); as st) {
                                          <button
                                             class="link"
                                             (click)="toggleSplit(st)"
                                             [title]="
                                                st.split
                                                   ? 'Use one tag both ways again'
                                                   : 'Use a different tag into this slide than out of it'
                                             "
                                          >
                                             {{ st.split ? 'Join in / out' : 'Split in / out' }}
                                          </button>
                                       }
                                    </span>
                                    @if (splitTarget()?.split) {
                                       <span class="sublab">In · from the slide before</span>
                                       <dd-tag-input
                                          [value]="tagText(splitTarget()!.in)"
                                          [suggestions]="morphTagSuggestions()"
                                          [maxlength]="80"
                                          placeholder="type a tag…"
                                          (commit)="setSplitTag('in', $event)"
                                       />
                                       <span class="sublab">Out · to the slide after</span>
                                       <dd-tag-input
                                          [value]="tagText(splitTarget()!.out)"
                                          [maxlength]="80"
                                          placeholder="type a tag…"
                                          (commit)="setSplitTag('out', $event)"
                                       />
                                    } @else {
                                       <dd-tag-input
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
                                    }
                                 </div>
                                 <p class="hint">
                                    Tagged objects only morph into the object with the same tag on the next slide; they
                                    are never matched to look-alikes.
                                 </p>
                              }
                              @if (pairable()) {
                                 <button class="btn wide" (click)="pairSelected()">
                                    Treat the {{ pairable() }} selected items as the same object (morph)
                                 </button>
                              }
                           }
                        }
                        @case ('design') {
                           <input
                              #designFileInput
                              type="file"
                              accept=".json,application/json"
                              hidden
                              (change)="importDesign(designFileInput)"
                           />
                           <div class="sub">
                              <span class="subt">
                                 Design
                                 <dd-icon
                                    name="info"
                                    class="info"
                                    tabindex="0"
                                    matTooltip="A design is one set of layouts plus the theme it uses. The Default design uses the standard layouts and the Default theme; changing a layout, or a theme's colors or fonts, saves a custom design, so the defaults never change."
                                 />
                              </span>
                              @if (canEdit()) {
                                 <span class="sub-actions">
                                    <button
                                       class="icon"
                                       (click)="newDesign()"
                                       aria-label="New design"
                                       matTooltip="New design: a copy of this one (its layouts and theme) to change"
                                    >
                                       <dd-icon name="add" />
                                    </button>
                                    @if (designIsCustom()) {
                                       <button
                                          class="icon"
                                          (click)="deleteDesign()"
                                          aria-label="Delete design"
                                          matTooltip="Delete this design; the deck goes back to the Default layouts"
                                       >
                                          <dd-icon name="delete" />
                                       </button>
                                    }
                                    <button
                                       class="icon"
                                       (click)="exportDesign('design')"
                                       aria-label="Export design"
                                       matTooltip="Download this design (its layouts and theme) as one file"
                                    >
                                       <dd-icon name="download" />
                                    </button>
                                    <button
                                       class="icon"
                                       (click)="importPart.set('design'); designFileInput.click()"
                                       aria-label="Import design"
                                       matTooltip="Add a design from a file and use it"
                                    >
                                       <dd-icon name="upload" />
                                    </button>
                                 </span>
                              }
                           </div>
                           <dd-select
                              class="design-pick"
                              aria-label="Design"
                              [options]="designOptions()"
                              [ngModel]="design().id"
                              [disabled]="!canEdit()"
                              (ngModelChange)="pickDesign($event)"
                              (rename)="renameRecord($event.value, $event.label)"
                              [removable]="true"
                              (remove)="deleteDesignById($event)"
                           />
                           @if (themeNote() ?? relayoutNote(); as note) {
                              <p class="hint">{{ note }}</p>
                           }
                           <dd-segmented
                              class="design-seg"
                              [options]="designTabOptions"
                              [ngModel]="designTab()"
                              (ngModelChange)="designTab.set($event)"
                           />
                           @if (designTab() === 'layouts') {
                              @if (shownLayout(); as l) {
                                 <div class="sub">
                                    <span class="subt">
                                       {{ l.slide?.master ? 'Master' : 'Layout' }}
                                       <dd-icon
                                          name="info"
                                          class="info"
                                          tabindex="0"
                                          [matTooltip]="
                                             l.slide?.master
                                                ? 'The master is drawn under every slide and layout. Put logos, footers and fields here.'
                                                : 'Items drawn here show, locked, under every slide using this layout. Mark a text box as a placeholder and each slide gets its own empty copy to type into (shown faded until something is typed).'
                                          "
                                       />
                                    </span>
                                 </div>
                                 <label class="field" [hidden]="!!l.slide?.master">
                                    <span>Layout name</span>
                                    <input
                                       class="text-input"
                                       type="text"
                                       maxlength="120"
                                       aria-label="Layout name"
                                       [value]="layoutName(l)"
                                       [disabled]="!canEdit()"
                                       (keydown.enter)="$any($event.target).blur()"
                                       (blur)="renameLayout(l, $any($event.target))"
                                    />
                                 </label>
                                 @if (layoutTextSelection().length; as n) {
                                    <div class="field">
                                       <dd-checkbox
                                          [ngModel]="!!layoutTextSelection()[0].placeholder"
                                          [disabled]="!canEdit()"
                                          (ngModelChange)="setPlaceholder($event)"
                                       >
                                          {{
                                             n > 1
                                                ? 'Selected text boxes are placeholders'
                                                : 'Selected text box is a placeholder'
                                          }}
                                       </dd-checkbox>
                                    </div>
                                    @if (layoutTextSelection()[0].placeholder; as ph) {
                                       <label class="field">
                                          <span>Style type</span>
                                          <dd-select
                                             [options]="roleOptions"
                                             [ngModel]="ph.role ?? ''"
                                             [disabled]="!canEdit()"
                                             (ngModelChange)="setRole($event)"
                                          />
                                       </label>
                                    }
                                 }
                                 <div class="row">
                                    <button class="btn" (click)="backToSlide()">
                                       <dd-icon name="chevron_left" />Back to slides
                                    </button>
                                    @if (canEdit() && !shownLayout()?.slide?.master) {
                                       <button
                                          class="btn"
                                          (click)="command.emit({ kind: 'add' })"
                                          title="Add a slide that uses this layout"
                                       >
                                          <dd-icon name="add" />New slide
                                       </button>
                                    }
                                 </div>
                              }
                              @if (active() && !shownLayout()) {
                                 <label class="field">
                                    <span
                                       >Layout of {{ activeSlides().length > 1 ? 'these slides' : 'this slide' }}</span
                                    >
                                    <dd-select
                                       [options]="layoutOptions()"
                                       [ngModel]="activeLayoutValue()"
                                       [disabled]="!canEdit() || !layouts().length"
                                       (ngModelChange)="setLayout($event)"
                                    />
                                 </label>
                              }
                              @if (canEdit() && drift(); as d) {
                                 <div class="field">
                                    <span>{{ driftLabel(d) }}</span>
                                    @if (selectedDrifted().length) {
                                       <button
                                          class="btn wide"
                                          (click)="resetSlide(true)"
                                          title="Put the selected placeholders and objects back where and how the layout has them; keeps placeholder text"
                                       >
                                          <dd-icon name="undo" />Reset selected to layout
                                       </button>
                                    } @else {
                                       <button
                                          class="btn wide"
                                          (click)="resetSlide(false)"
                                          title="Put every placeholder and layout object back where and how the layout has them and bring back deleted ones; keeps placeholder text"
                                       >
                                          <dd-icon name="undo" />Reset slide to layout
                                       </button>
                                    }
                                 </div>
                              }
                              @if (canEdit() && standIns().length) {
                                 <div class="field">
                                    <span
                                       >{{ standIns().length }} master item{{
                                          standIns().length > 1 ? 's' : ''
                                       }}
                                       changed on this {{ shownLayout() ? 'layout' : 'slide' }}</span
                                    >
                                    @if (selectedStandIns().length) {
                                       <button
                                          class="btn wide"
                                          (click)="resetMaster(true)"
                                          title="Show the master's version of the selected items again"
                                       >
                                          <dd-icon name="undo" />Reset selected to master
                                       </button>
                                    } @else {
                                       <button
                                          class="btn wide"
                                          (click)="resetMaster(false)"
                                          title="Show the master's version of every item changed here again"
                                       >
                                          <dd-icon name="undo" />Reset to master
                                       </button>
                                    }
                                 </div>
                              }
                              <div class="listbar">
                                 <span class="muted subt">
                                    Layouts
                                    <dd-icon
                                       name="info"
                                       class="info"
                                       tabindex="0"
                                       matTooltip="A layout holds the logo, bars and text boxes that repeat on slides. Standard layouts follow the theme's design; the master shows under all of them."
                                    />
                                 </span>
                                 @if (canEdit()) {
                                    <span class="listbar-actions">
                                       <button
                                          class="icon"
                                          (click)="exportDesign('layouts')"
                                          aria-label="Export layouts"
                                          matTooltip="Download this design's layouts and master as a file"
                                       >
                                          <dd-icon name="download" />
                                       </button>
                                       <button
                                          class="icon"
                                          (click)="importPart.set('layouts'); designFileInput.click()"
                                          aria-label="Import layouts"
                                          matTooltip="Use layouts from a file in this design (its theme stays)"
                                       >
                                          <dd-icon name="upload" />
                                       </button>
                                       <button
                                          class="link"
                                          [ddPopoverTrigger]="standardMenu"
                                          placement="below-end"
                                          matTooltip="Add ready-made layouts that follow the theme"
                                       >
                                          <dd-icon name="template" />Standard
                                       </button>
                                       <button
                                          class="link"
                                          (click)="command.emit({ kind: 'add', layout: true })"
                                          matTooltip="Add an empty layout"
                                       >
                                          <dd-icon name="add" />Layout
                                       </button>
                                    </span>
                                    <ng-template #standardMenu let-close>
                                       <div class="dd-menu">
                                          <button
                                             class="dd-menu-item"
                                             [disabled]="!missingKinds().length"
                                             (click)="addStandard(missingKinds()); close()"
                                          >
                                             {{
                                                missingKinds().length
                                                   ? 'All missing standard layouts'
                                                   : 'All standard layouts added'
                                             }}
                                          </button>
                                          <div class="dd-menu-sep"></div>
                                          @for (k of missingKinds(); track k) {
                                             <button class="dd-menu-item" (click)="addStandard([k]); close()">
                                                {{ kindLabels[k] }}
                                             </button>
                                          }
                                       </div>
                                    </ng-template>
                                 }
                              </div>
                              <ol class="layout-list">
                                 @if (master(); as m) {
                                    <li
                                       class="lcard"
                                       [class.current]="m.id === active_()"
                                       (click)="command.emit({ kind: 'focus', id: m.id })"
                                       title="Edit the master: logos, footers and fields (slide number, date) placed here show on every slide"
                                    >
                                       <span class="thumb" [style.aspect-ratio]="m.width + ' / ' + m.height">
                                          @if (thumbs().get(m.id); as src) {
                                             <img [src]="src" alt="" draggable="false" />
                                          }
                                       </span>
                                       <span class="lname">Master</span>
                                    </li>
                                 }
                                 @for (l of designLayouts(); track l.id) {
                                    <li
                                       class="lcard"
                                       [class.current]="l.id === active_()"
                                       (click)="command.emit({ kind: 'focus', id: l.id })"
                                       [title]="'Edit layout ' + layoutName(l)"
                                    >
                                       <span class="thumb" [style.aspect-ratio]="l.width + ' / ' + l.height">
                                          @if (thumbs().get(l.id); as src) {
                                             <img [src]="src" alt="" draggable="false" />
                                          }
                                       </span>
                                       <span class="lname">{{ layoutName(l) }}</span>
                                       @if (canEdit()) {
                                          <span class="licons">
                                             <button
                                                class="icon"
                                                (click)="
                                                   $event.stopPropagation();
                                                   command.emit({ kind: 'duplicate', id: l.id })
                                                "
                                                title="Duplicate layout"
                                                aria-label="Duplicate layout"
                                             >
                                                <dd-icon name="content_copy" />
                                             </button>
                                             @if (!l.slide?.defaultLayout) {
                                                <button
                                                   class="icon"
                                                   (click)="
                                                      $event.stopPropagation();
                                                      command.emit({ kind: 'delete', id: l.id })
                                                   "
                                                   title="Delete layout and its items"
                                                   aria-label="Delete layout"
                                                >
                                                   <dd-icon name="delete" />
                                                </button>
                                             }
                                          </span>
                                       }
                                    </li>
                                 }
                              </ol>
                              @if (!designLayouts().length) {
                                 <p class="hint">No layouts yet.</p>
                              }
                           } @else {
                              <div class="sub">
                                 <span class="subt">
                                    Theme
                                    <dd-icon
                                       name="info"
                                       class="info"
                                       tabindex="0"
                                       matTooltip="The design's colors and fonts. Items set in a theme color or font follow it. Changing a built-in theme saves a custom copy."
                                    />
                                 </span>
                                 @if (canEdit()) {
                                    <span class="sub-actions">
                                       @if (themeIsCustom()) {
                                          <button
                                             class="icon"
                                             (click)="deleteTheme()"
                                             aria-label="Delete theme"
                                             matTooltip="Delete this theme; the deck takes the Default theme"
                                          >
                                             <dd-icon name="delete" />
                                          </button>
                                       }
                                       <button
                                          class="icon"
                                          (click)="exportDesign('theme')"
                                          aria-label="Export theme"
                                          matTooltip="Download this theme's colors and fonts as a file"
                                       >
                                          <dd-icon name="download" />
                                       </button>
                                       <button
                                          class="icon"
                                          (click)="importPart.set('theme'); designFileInput.click()"
                                          aria-label="Import theme"
                                          matTooltip="Add a theme from a file and use it in this design (its layouts stay)"
                                       >
                                          <dd-icon name="upload" />
                                       </button>
                                    </span>
                                 }
                              </div>
                              <dd-select
                                 class="design-pick"
                                 aria-label="Theme"
                                 [options]="themeOptions()"
                                 [ngModel]="deckTheme().id ?? 'default'"
                                 [disabled]="!canEdit()"
                                 (ngModelChange)="pickTheme($event)"
                                 (rename)="renameRecord($event.value, $event.label)"
                                 [removable]="true"
                                 (remove)="deleteThemeById($event)"
                              />
                              <div class="field">
                                 <span>Colors</span>
                                 <div class="token-grid">
                                    @for (k of colorTokens; track k) {
                                       <button
                                          type="button"
                                          class="token"
                                          [ddPopoverTrigger]="tokenPicker"
                                          placement="below-start"
                                          [disabled]="!canEdit()"
                                          [title]="colorLabels[k]"
                                       >
                                          <span
                                             class="tsw"
                                             [class.none]="deckTheme().colors[k] === 'transparent'"
                                             [class.follow]="isFollow(deckTheme().colors[k])"
                                             [style.background]="
                                                deckTheme().colors[k] === 'transparent' ||
                                                isFollow(deckTheme().colors[k])
                                                   ? null
                                                   : css(deckTheme().colors[k])
                                             "
                                          >
                                             @if (isFollow(deckTheme().colors[k])) {
                                                <dd-icon name="contrast" />
                                             }
                                          </span>
                                          <span class="tlabel">{{ colorLabels[k] }}</span>
                                       </button>
                                       <ng-template #tokenPicker let-close>
                                          <div class="picker">
                                             <dd-color-swatches
                                                [value]="deckTheme().colors[k]"
                                                noneValue="transparent"
                                                noneLabel="None"
                                                [themeValue]="followValue(k)"
                                                (pick)="setThemeColor(k, $event); close()"
                                             />
                                          </div>
                                       </ng-template>
                                    }
                                 </div>
                              </div>
                              <div class="two">
                                 <label class="field">
                                    <span>Heading font</span>
                                    <dd-select
                                       [options]="fontOptions"
                                       [ngModel]="deckTheme().fonts.heading"
                                       [disabled]="!canEdit()"
                                       (ngModelChange)="setThemeFont('heading', $event)"
                                    />
                                 </label>
                                 <label class="field">
                                    <span>Body font</span>
                                    <dd-select
                                       [options]="fontOptions"
                                       [ngModel]="deckTheme().fonts.body"
                                       [disabled]="!canEdit()"
                                       (ngModelChange)="setThemeFont('body', $event)"
                                    />
                                 </label>
                              </div>
                           }
                        }
                        @case ('size') {
                           @if (canEdit()) {
                              <label class="field">
                                 <span>Size of every slide</span>
                                 <dd-select
                                    [options]="sizeOptions()"
                                    [ngModel]="sizeValue()"
                                    (ngModelChange)="setSize($event)"
                                 />
                              </label>
                           } @else {
                              <p class="hint">
                                 Slides are
                                 {{ sizeValue() === 'custom' ? 'a custom size' : 'sized by preset' }}.
                              </p>
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

      @if (part() === 'theme-menu' || part() === 'design-menu') {
         @let isTheme = part() === 'theme-menu';
         <div class="dd-menu rec-menu">
            @for (g of isTheme ? themeGroups() : designGroups(); track g.name) {
               <div class="f-lab grp">{{ g.name }}</div>
               @for (o of g.items; track o.id) {
                  @if (renaming() === o.id) {
                     <input
                        class="rec-input"
                        [value]="o.name"
                        (keydown.enter)="finishRename(o.id, $any($event.target).value)"
                        (keydown.escape)="renaming.set(null)"
                        (blur)="finishRename(o.id, $any($event.target).value)"
                        (pointerdown)="$event.stopPropagation()"
                        [attr.aria-label]="'Rename ' + o.name"
                        appAutofocus
                     />
                  } @else {
                     <div class="rec-row" [class.on]="o.on">
                        <button
                           class="dd-menu-item rec-pick"
                           [disabled]="!canEdit()"
                           (click)="isTheme ? pickTheme(o.id) : pickDesign(o.id)"
                        >
                           @if (isTheme && o.theme) {
                              <span class="rec-sw">
                                 @for (k of ['background', 'heading', 'accent1', 'accent2']; track k) {
                                    <span [style.background]="css($any(o.theme.colors)[k])"></span>
                                 }
                              </span>
                           }
                           {{ o.name }}
                        </button>
                        @if (o.custom && canEdit()) {
                           <button
                              class="rec-edit"
                              (click)="renaming.set(o.id)"
                              [attr.aria-label]="'Rename ' + o.name"
                              title="Rename"
                           >
                              <dd-icon name="edit" />
                           </button>
                           <button
                              class="rec-edit del"
                              (click)="isTheme ? deleteThemeById(o.id) : deleteDesignById(o.id)"
                              [attr.aria-label]="'Delete ' + o.name"
                              title="Delete"
                           >
                              <dd-icon name="delete" />
                           </button>
                        }
                     </div>
                  }
               }
            }
         </div>
      }

      @if (part() === 'size-menu') {
         <div class="dd-menu">
            @for (o of sizeOptions(); track o.value) {
               <button
                  class="dd-menu-item"
                  [class.on]="o.value === sizeValue()"
                  [disabled]="!canEdit()"
                  (click)="setSize(o.value); command.emit({ kind: 'close' })"
               >
                  {{ o.label }}
               </button>
            }
         </div>
      }

      @if (part() === 'focus-list') {
         <div class="f-head"><span class="f-lab">Slides</span><span class="f-k">↑↓</span></div>
         <div
            class="f-cards"
            tabindex="0"
            (keydown.arrowUp)="stepSlide(-1, $event)"
            (keydown.arrowDown)="stepSlide(1, $event)"
         >
            @for (f of shown(); track f.id; let i = $index) {
               <div
                  class="fs"
                  [class.on]="f.id === active_()"
                  [class.skipped]="!!f.slide?.hidden"
                  (click)="onRowClick(f, $event)"
               >
                  <span class="n">{{ i + 1 }}</span>
                  <span class="tn" [style.aspect-ratio]="f.width + ' / ' + f.height">
                     @if (thumbs().get(thumbId(f)); as src) {
                        <img [src]="src" alt="" draggable="false" />
                     }
                     <span class="bd">
                        @if (f.slide?.hidden) {
                           <span class="bdg">skipped</span>
                        } @else {
                           @if (animCount(f); as c) {
                              <span class="bdg">▶ {{ c }}</span>
                           }
                        }
                     </span>
                  </span>
               </div>
            }
         </div>
         @if (canEdit()) {
            <div class="f-foot">
               <button class="f-go" (click)="command.emit({ kind: 'add' })"><span>+ Slide</span></button>
               <button
                  class="f-tb"
                  [ddPopoverTrigger]="focusLayoutMenu"
                  placement="above-start"
                  aria-label="New slide with a layout"
               >
                  Layout ▾
               </button>
               <ng-template #focusLayoutMenu let-close>
                  <div class="dd-menu">
                     @for (l of menuLayouts(); track l.id) {
                        <button class="dd-menu-item lay-item" (click)="addWithLayout(l.id); close()">
                           <span class="mthumb" [style.aspect-ratio]="l.width + ' / ' + l.height">
                              @if (layoutThumbs().get(l.id); as src) {
                                 <img [src]="src" alt="" draggable="false" />
                              }</span
                           >{{ layoutName(l) }}
                        </button>
                     }
                     @if (!menuLayouts().length) {
                        <div class="f-hint">No layouts yet.</div>
                     }
                  </div>
               </ng-template>
            </div>
         }
      }

      @if (part() === 'focus-settings') {
         <div class="f-tabs" role="tablist">
            <button class="f-tab" [class.on]="ftab() === 'slide'" (click)="ftab.set('slide')">Slide</button>
            <button class="f-tab" [class.on]="ftab() === 'transition'" (click)="ftab.set('transition')">
               Transition
            </button>
            <button class="f-tab" [class.on]="ftab() === 'animations'" (click)="ftab.set('animations')">
               Animations <span class="cnt">{{ active() ? animCount(active()!) : 0 }}</span>
            </button>
            <button class="f-tab" [class.on]="ftab() === 'notes'" (click)="ftab.set('notes')">Notes</button>
         </div>
         <div class="f-body" [class.gap12]="ftab() === 'transition'">
            @if (ftab() === 'transition') {
               <ng-container [ngTemplateOutlet]="transitionBody" />
               @if (active() && hasTransitionTarget()) {
                  <button class="f-tb outline" (click)="command.emit({ kind: 'screen', screen: 'morph' })">
                     <dd-icon name="open_in_full" />Refine
                  </button>
               }
            } @else if (ftab() === 'animations') {
               @if (active(); as a) {
                  <app-animation-pane [slide]="a" (play)="command.emit({ kind: 'present', from: 'current' })" />
               } @else {
                  <p class="hint">Select a slide.</p>
               }
            } @else if (active(); as a) {
               @if (ftab() === 'slide') {
                  <div class="f-between">
                     <span class="f-lab">Layout</span>
                     @if (canEdit() && drift()) {
                        <button class="f-link" (click)="resetSlide(false)">Reset slide to layout</button>
                     }
                  </div>
                  <div class="f-lays">
                     @for (l of designLayouts(); track l.id) {
                        <button
                           class="lay"
                           [class.on]="activeLayoutValue() === l.id"
                           [disabled]="!canEdit()"
                           (click)="setLayout(l.id)"
                        >
                           <span class="lt" [style.aspect-ratio]="l.width + ' / ' + l.height">
                              @if (thumbs().get(l.id); as src) {
                                 <img [src]="src" alt="" draggable="false" />
                              }
                           </span>
                           {{ layoutName(l) }}
                        </button>
                     }
                     <button
                        class="lay"
                        [class.on]="activeLayoutValue() === ''"
                        [disabled]="!canEdit()"
                        (click)="setLayout('')"
                     >
                        <span class="lt" [style.aspect-ratio]="a.width + ' / ' + a.height"></span>Blank
                     </button>
                  </div>
                  <div class="f-row">
                     <span>Background</span>
                     <span class="f-sws">
                        @for (k of bgTokens; track k) {
                           <button
                              class="sw"
                              [class.on]="a.backgroundColor === token(k) && a.fillStyle !== 'none'"
                              [style.background]="css(deckTheme().colors[k])"
                              [disabled]="!canEdit()"
                              [attr.aria-label]="'Background ' + colorLabels[k]"
                              (click)="setBackground(token(k))"
                           ></button>
                        }
                     </span>
                  </div>
                  <div class="f-row">
                     <span>Skip in slideshow</span>
                     <button
                        class="tg"
                        [class.on]="!!a.slide?.hidden"
                        [disabled]="!canEdit()"
                        (click)="toggleHidden(a)"
                        aria-label="Skip in slideshow"
                     ></button>
                  </div>
                  <div class="f-row">
                     <span>Edited master items</span>
                     @if (standIns().length) {
                        <button class="f-link" [disabled]="!canEdit()" (click)="resetMaster(false)">
                           {{ standIns().length }} · Revert
                        </button>
                     } @else {
                        <span class="muted">None</span>
                     }
                  </div>
                  <div class="f-row">
                     <span>Present from here</span>
                     <button class="f-k btnk" (click)="command.emit({ kind: 'present', from: 'current' })">
                        Shift F5
                     </button>
                  </div>
               } @else if (ftab() === 'notes') {
                  <textarea
                     class="f-notes"
                     rows="8"
                     placeholder="Shown to the presenter (press N while presenting)"
                     [ngModel]="a.slide?.notes ?? ''"
                     [disabled]="!canEdit()"
                     (blur)="setNotes($any($event.target).value)"
                  ></textarea>
               }
            } @else {
               <p class="hint">Select a slide.</p>
            }
         </div>
      }

      @if (part() === 'focus-transition') {
         <div class="f-tabs" role="tablist">
            <button class="f-tab" (click)="ftab.set('slide'); command.emit({ kind: 'screen', screen: 'main' })">
               Slide
            </button>
            <button class="f-tab on">Transition</button>
            <button class="f-tab" (click)="ftab.set('animations'); command.emit({ kind: 'screen', screen: 'main' })">
               Animations
            </button>
         </div>
         <div class="f-body gap12">
            <ng-container [ngTemplateOutlet]="transitionBody" />
         </div>
      }

      <ng-template #transitionBody>
         @if (active() && hasTransitionTarget()) {
            <div class="f-lab">Into this slide</div>
            <div class="f-seg">
               @for (t of focusTypes; track t.value) {
                  <button
                     [class.on]="transition().type === t.value"
                     [disabled]="!canEdit()"
                     (click)="setTransition({ type: t.value })"
                  >
                     {{ t.label }}
                  </button>
               }
            </div>
            @if (transition().type !== 'none') {
               <div class="f-row">
                  Duration
                  <span class="f-seg">
                     @for (d of [200, 300, 500]; track d) {
                        <button
                           [class.on]="transition().duration === d"
                           [disabled]="!canEdit()"
                           (click)="setTransition({ duration: d })"
                        >
                           {{ d }}
                        </button>
                     }
                     <button
                        [class.on]="![200, 300, 500].includes(transition().duration)"
                        [disabled]="!canEdit()"
                        [ddPopoverTrigger]="durMenu"
                        placement="below-end"
                     >
                        ms…
                     </button>
                  </span>
                  <ng-template #durMenu let-close>
                     <div class="picker">
                        <input
                           class="f-num"
                           type="number"
                           min="100"
                           max="5000"
                           step="50"
                           [value]="transition().duration"
                           (change)="setDuration($any($event.target).value); close()"
                        />
                     </div>
                  </ng-template>
               </div>
               <div class="f-row">
                  Easing
                  <dd-select
                     class="f-select"
                     [options]="easingOptions"
                     [ngModel]="transition().easing"
                     [disabled]="!canEdit()"
                     (ngModelChange)="setTransition({ easing: $event })"
                  />
               </div>
            }
            @if (transition().type === 'slide') {
               <div class="f-row">
                  Direction
                  <dd-select
                     class="f-select"
                     [options]="directionOptions"
                     [ngModel]="transition().direction ?? 'left'"
                     [disabled]="!canEdit()"
                     (ngModelChange)="setTransition({ direction: $event })"
                  />
               </div>
            }
            @if (transition().type === 'morph') {
               <div class="f-row">
                  Morph text by
                  <span class="f-seg">
                     @for (m of focusMorphBy; track m.value) {
                        <button
                           [class.on]="(transition().morphBy ?? 'character') === m.value"
                           [disabled]="!canEdit()"
                           (click)="setTransition({ morphBy: m.value })"
                        >
                           {{ m.label }}
                        </button>
                     }
                  </span>
               </div>
            }
            @if (canEdit()) {
               <button class="f-tb outline" (click)="applyToAll()">Apply to all slides</button>
            }
         } @else {
            <p class="hint">The first slide has no transition into it.</p>
            @if (frames().length > 1) {
               <button class="f-tb outline" (click)="command.emit({ kind: 'screen', screen: 'morph' })">
                  <dd-icon name="open_in_full" />Refine
               </button>
            }
         }

         @if (canEdit() && morphRelevant() && tagCount() === 1) {
            <div class="f-sect">
               <div class="f-between">
                  <span class="f-lab">Selected · morph tag</span>
                  @if (splitTarget(); as st) {
                     <button
                        class="f-link"
                        (click)="toggleSplit(st)"
                        [title]="
                           st.split
                              ? 'Use one tag both ways again'
                              : 'Use a different tag into this slide than out of it'
                        "
                     >
                        {{ st.split ? 'Join in / out' : 'Split in / out' }}
                     </button>
                  }
               </div>
               @if (splitTarget()?.split) {
                  <div class="f-split">
                     <span class="f-small">In · from the slide before</span>
                     <dd-tag-input
                        [value]="tagText(splitTarget()!.in)"
                        [suggestions]="morphTagSuggestions()"
                        [maxlength]="80"
                        placeholder="type a tag…"
                        (commit)="setSplitTag('in', $event)"
                     />
                     <span class="f-small">Out · to the slide after</span>
                     <dd-tag-input
                        [value]="tagText(splitTarget()!.out)"
                        [maxlength]="80"
                        placeholder="type a tag…"
                        (commit)="setSplitTag('out', $event)"
                     />
                  </div>
               } @else {
                  <dd-tag-input
                     [value]="morphTag()"
                     [suggestions]="morphTagSuggestions()"
                     [taken]="takenTags()"
                     [maxlength]="80"
                     placeholder="type a tag…"
                     (commit)="setMorphTag($event)"
                  />
               }
               @if (morphTagSuggestions().length) {
                  <div class="f-small">
                     Tags used on the previous slide:
                     @for (t of morphTagSuggestions(); track t; let last = $last) {
                        <span [class.taken]="takenTags().includes(t)" class="vt">{{ t }}</span
                        >{{ last ? '' : ' · ' }}
                     }
                  </div>
               }
            </div>
         }
         @if (canEdit() && pairable()) {
            <button class="f-tb outline" (click)="pairSelected()">
               Treat the {{ pairable() }} selected items as the same object
            </button>
         }
      </ng-template>

      @if (part() === 'design-layouts') {
         <div class="f-head">
            <span class="f-lab"
               >Layouts
               <dd-icon
                  name="info"
                  class="info"
                  tabindex="0"
                  matTooltip="A layout holds the logo, bars and text boxes that repeat on slides. The master shows under all of them."
               />
            </span>
         </div>
         <div class="f-cards">
            @if (master(); as m) {
               <button class="ly" [class.on]="m.id === active_()" (click)="command.emit({ kind: 'focus', id: m.id })">
                  <span class="lt" [style.aspect-ratio]="m.width + ' / ' + m.height">
                     @if (thumbs().get(m.id); as src) {
                        <img [src]="src" alt="" draggable="false" />
                     }
                  </span>
                  <span class="meta"><b>Master</b><span>under all</span></span>
               </button>
               <div class="f-div"></div>
            }
            @for (l of designLayouts(); track l.id; let li = $index) {
               <div
                  class="lyw"
                  [class.ly-dragging]="lyDrag()?.from === li"
                  [class.ly-copy]="lyDrag()?.from === li && lyDrag()?.alt"
                  [class.ly-before]="lyDrag()?.to === li && lyDrag()?.from !== li"
                  [class.ly-after]="lyDrag()?.to === designLayouts().length && li === designLayouts().length - 1"
                  (pointerdown)="onLayoutDown(li, $event)"
               >
                  @if (canEdit() && !l.slide?.defaultLayout) {
                     <button
                        class="rec-edit del ly-del"
                        (click)="command.emit({ kind: 'delete', id: l.id })"
                        title="Delete layout and its items"
                        aria-label="Delete layout"
                     >
                        <dd-icon name="delete" />
                     </button>
                  }
                  <button
                     class="ly"
                     [class.on]="l.id === active_()"
                     (click)="!lySuppress && command.emit({ kind: 'focus', id: l.id })"
                  >
                     <span class="lt" [style.aspect-ratio]="l.width + ' / ' + l.height">
                        @if (thumbs().get(l.id); as src) {
                           <img [src]="src" alt="" draggable="false" />
                        }
                     </span>
                     <span class="meta"
                        ><span class="nm">{{ layoutName(l) }}</span
                        ><span>{{ usage(l.id) }} slide{{ usage(l.id) === 1 ? '' : 's' }}</span></span
                     >
                  </button>
               </div>
            }
         </div>
         @if (canEdit()) {
            <div class="f-foot col">
               <button class="f-tb outline" (click)="command.emit({ kind: 'add', layout: true })">
                  + Empty layout
               </button>
               @if (missingKinds().length) {
                  <button class="f-tb outline" (click)="addStandard(missingKinds())">
                     + Standard layouts{{
                        missingKinds().length < standardKinds.length ? ' (' + missingKinds().length + ' missing)' : ''
                     }}
                  </button>
               }
            </div>
         }
      }

      @if (part() === 'design-theme') {
         <input
            #themeFileInput
            type="file"
            accept=".json,application/json"
            hidden
            (change)="importDesign(themeFileInput)"
         />
         <div class="f-body gap14 fill">
            <div class="f-design top">
               <div class="f-lab">
                  Design = layouts + theme
                  <dd-icon
                     name="info"
                     class="info"
                     tabindex="0"
                     matTooltip="A design is one set of layouts plus the theme it uses."
                  />
               </div>
               <div class="f-acts">
                  <dd-select
                     class="f-select grow"
                     [options]="designOptions()"
                     [ngModel]="design().id"
                     [disabled]="!canEdit()"
                     (ngModelChange)="pickDesign($event)"
                     (rename)="renameRecord($event.value, $event.label)"
                     [removable]="true"
                     (remove)="deleteDesignById($event)"
                  />
                  @if (canEdit()) {
                     <button class="f-tb sm" (click)="newDesign()">Save as new</button>
                     <button class="f-tb sm" (click)="exportDesign('design')">Export</button>
                  }
               </div>
            </div>
            <div class="f-between">
               <span class="f-lab"
                  >Theme
                  <dd-icon
                     name="info"
                     class="info"
                     tabindex="0"
                     matTooltip="The design's colors and fonts. Items set in a theme color or font follow it. Changing a built-in theme saves a custom copy."
                  />
               </span>
               @if (canEdit()) {
                  <span class="f-acts">
                     <button class="f-tb sm" (click)="importPart.set('theme'); themeFileInput.click()">Import</button>
                     <button class="f-tb sm" (click)="exportDesign('theme')">Export</button>
                  </span>
               }
            </div>
            @for (g of themeGroups(); track g.name) {
               <div class="f-sub">{{ g.name }}</div>
               <div class="th-grid">
                  @for (t of g.items; track t.id) {
                     <div class="th" [class.on]="t.on">
                        <button
                           class="pv"
                           [disabled]="!canEdit()"
                           (click)="pickTheme(t.id)"
                           [style.background]="css(t.theme!.colors.background)"
                           [style.color]="css(t.theme!.colors.heading)"
                           [style.font-family]="stackOf(t.theme!.fonts.heading)"
                        >
                           Aa
                           <span class="bars">
                              @for (k of ['accent1', 'accent2', 'accent3']; track k) {
                                 <span [style.background]="css($any(t.theme!.colors)[k])"></span>
                              }
                           </span>
                        </button>
                        @if (renaming() === t.id) {
                           <input
                              class="rec-input card"
                              [value]="t.name"
                              (keydown.enter)="finishRename(t.id, $any($event.target).value)"
                              (keydown.escape)="renaming.set(null)"
                              (blur)="finishRename(t.id, $any($event.target).value)"
                              appAutofocus
                              [attr.aria-label]="'Rename ' + t.name"
                           />
                        } @else {
                           <span class="nm">
                              <span>{{ t.name }}</span>
                              @if (t.custom && canEdit()) {
                                 <span class="nm-acts">
                                    <button
                                       class="rec-edit"
                                       (click)="renaming.set(t.id)"
                                       [attr.aria-label]="'Rename ' + t.name"
                                       title="Rename"
                                    >
                                       <dd-icon name="edit" />
                                    </button>
                                    <button
                                       class="rec-edit del"
                                       (click)="deleteThemeById(t.id)"
                                       [attr.aria-label]="'Delete ' + t.name"
                                       title="Delete"
                                    >
                                       <dd-icon name="delete" />
                                    </button>
                                 </span>
                              }
                           </span>
                        }
                     </div>
                  }
               </div>
            }
            <div class="f-lab">Colors</div>
            <div class="tok-grid">
               @for (k of colorTokens; track k) {
                  <button class="tok" [ddPopoverTrigger]="tokPick" placement="below-start" [disabled]="!canEdit()">
                     <span
                        class="sq"
                        [style.background]="
                           isFollow(deckTheme().colors[k]) || deckTheme().colors[k] === 'transparent'
                              ? null
                              : css(deckTheme().colors[k])
                        "
                     ></span>
                     {{ colorLabels[k] }}
                  </button>
                  <ng-template #tokPick let-close>
                     <div class="picker">
                        <dd-color-swatches
                           [value]="deckTheme().colors[k]"
                           noneValue="transparent"
                           noneLabel="None"
                           [themeValue]="followValue(k)"
                           (pick)="setThemeColor(k, $event); close()"
                        />
                     </div>
                  </ng-template>
               }
            </div>
            <div class="f-lab">Fonts</div>
            <div class="fnt">
               <span class="muted">Heading</span>
               <dd-select
                  class="f-select"
                  [options]="fontOptions"
                  [ngModel]="deckTheme().fonts.heading"
                  [disabled]="!canEdit()"
                  (ngModelChange)="setThemeFont('heading', $event)"
               />
            </div>
            <div class="fnt">
               <span class="muted">Body</span>
               <dd-select
                  class="f-select"
                  [options]="fontOptions"
                  [ngModel]="deckTheme().fonts.body"
                  [disabled]="!canEdit()"
                  (ngModelChange)="setThemeFont('body', $event)"
               />
            </div>
         </div>
      }
   `,
   styles: [
      `
         .map-pairs {
            margin: 10px 0 6px;
         }
         .tagline {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
         }
         .sublab {
            font-size: 11px;
            color: var(--dd-text-muted);
         }
         /* ---- Focus mode views (DeckFocus / DeckMorph / DeckDesign mocks) ---- */
         .rec-menu {
            min-width: 240px;
            max-height: 60vh;
            overflow-y: auto;
         }
         .grp {
            padding: 8px 10px 4px;
         }
         .rec-row {
            display: flex;
            align-items: center;
         }
         .rec-row.on .rec-pick {
            color: var(--dd-primary);
            font-weight: 600;
         }
         .rec-pick {
            flex: 1;
            min-width: 0;
         }
         .rec-sw {
            display: inline-flex;
            margin-right: 8px;
            border-radius: 4px;
            overflow: hidden;
            box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.15);
         }
         .rec-sw span {
            width: 8px;
            height: 16px;
         }
         .rec-edit {
            width: 26px;
            height: 26px;
            flex: none;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border: none;
            border-radius: 6px;
            background: transparent;
            color: var(--dd-text-muted);
            cursor: pointer;
            --dd-icon-size: 14px;
         }
         .rec-edit:hover {
            background: var(--dd-surface-2);
            color: var(--dd-text);
         }
         .rec-edit.del:hover {
            background: color-mix(in srgb, #ef6b6b 18%, transparent);
            color: #ef6b6b;
         }
         .nm-acts {
            display: inline-flex;
         }
         .lyw {
            position: relative;
            display: grid;
            touch-action: none;
         }
         .lyw.ly-dragging {
            opacity: 0.45;
         }
         .lyw.ly-copy {
            opacity: 1;
            cursor: copy;
         }
         .lyw.ly-before::before,
         .lyw.ly-after::after {
            content: '';
            position: absolute;
            left: 6px;
            right: 6px;
            height: 3px;
            border-radius: 2px;
            background: var(--dd-primary);
            z-index: 2;
         }
         .lyw.ly-before::before {
            top: -2px;
         }
         .lyw.ly-after::after {
            bottom: -2px;
         }
         .ly-del {
            position: absolute;
            top: 10px;
            right: 10px;
            z-index: 1;
            background: var(--dd-surface);
            opacity: 0;
         }
         .lyw:hover .ly-del,
         .ly-del:focus-visible {
            opacity: 1;
         }
         .rec-input {
            margin: 2px 6px;
            width: calc(100% - 12px);
            box-sizing: border-box;
            height: 30px;
            padding: 0 8px;
            border: 1px solid var(--dd-primary);
            border-radius: 6px;
            background: var(--dd-surface);
            color: var(--dd-text);
            font: inherit;
            outline: none;
         }
         .rec-input.card {
            margin: 4px;
            width: calc(100% - 8px);
            height: 26px;
            font-size: 12px;
         }
         .f-split {
            display: grid;
            gap: 6px;
         }
         .f-sub {
            font-size: 12px;
            color: var(--dd-text-muted);
            margin-bottom: -6px;
         }
         .th .pv {
            width: 100%;
            border: none;
            cursor: pointer;
            text-align: left;
         }
         .th .nm {
            align-items: center;
         }
         .f-design.top {
            margin-top: 0;
            border-top: none;
            padding-top: 0;
            padding-left: 0;
            padding-right: 0;
            border-bottom: 1px solid var(--dd-border);
            padding-bottom: 12px;
         }

         :host(.fdock) {
            border-radius: 14px;
         }
         .f-head {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 14px 6px;
         }
         .f-lab {
            font-size: 11px;
            font-weight: 600;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            color: var(--dd-text-muted);
            display: inline-flex;
            align-items: center;
            gap: 6px;
         }
         .f-k {
            font-family: var(--dd-mono, monospace);
            font-size: 11px;
            color: var(--dd-text-muted);
            background: var(--dd-surface-2);
            border: 1px solid var(--dd-border);
            padding: 1px 5px;
            border-radius: 4px;
         }
         .btnk {
            cursor: pointer;
         }
         .f-cards {
            flex: 1 1 auto;
            min-height: 0;
            overflow-y: auto;
            padding: 0 8px;
            display: flex;
            flex-direction: column;
            gap: 2px;
            outline: none;
         }
         .fs {
            display: grid;
            grid-template-columns: 20px minmax(0, 1fr);
            gap: 8px;
            align-items: start;
            padding: 6px;
            border-radius: 9px;
            cursor: pointer;
         }
         .fs.on {
            background: var(--dd-primary-weak);
         }
         .fs.skipped {
            opacity: 0.55;
         }
         .fs .n {
            font-size: 12px;
            color: var(--dd-text-muted);
            text-align: right;
            padding-top: 4px;
         }
         .fs .tn {
            position: relative;
            display: block;
            border-radius: 5px;
            border: 1px solid var(--dd-border-strong, var(--dd-border));
            overflow: hidden;
            background: var(--dd-surface-2);
         }
         .fs.on .tn {
            border: 2px solid var(--dd-primary);
         }
         .fs .tn img,
         .lt img {
            display: block;
            width: 100%;
            height: 100%;
            object-fit: contain;
         }
         .bd {
            position: absolute;
            bottom: 4px;
            right: 6px;
            display: flex;
            gap: 3px;
         }
         .bdg {
            font-size: 9px;
            font-weight: 600;
            padding: 1px 4px;
            border-radius: 3px;
            background: rgba(35, 38, 44, 0.75);
            color: #fff;
         }
         .f-foot {
            display: flex;
            gap: 4px;
            padding: 8px;
         }
         .f-foot.col {
            flex-direction: column;
         }
         .f-go {
            flex: 1;
            height: 32px;
            border: none;
            border-radius: 7px;
            background: var(--dd-primary);
            color: #fff;
            font: inherit;
            font-weight: 600;
            cursor: pointer;
         }
         .f-tb {
            height: 32px;
            padding: 0 9px;
            border: none;
            border-radius: 7px;
            background: transparent;
            color: var(--dd-text);
            font: inherit;
            font-weight: 500;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            white-space: nowrap;
         }
         .f-tb:hover:not(:disabled) {
            background: var(--dd-surface-2);
         }
         .f-tb.outline,
         .f-foot .f-tb {
            border: 1px solid var(--dd-border);
         }
         .f-tb.sm {
            height: 26px;
            font-size: 12px;
         }
         .f-tabs {
            display: flex;
            gap: 2px;
            padding: 4px 12px 0;
            border-bottom: 1px solid var(--dd-border);
         }
         .f-tab {
            height: 36px;
            border: none;
            border-bottom: 2px solid transparent;
            background: transparent;
            padding: 0 8px;
            font: inherit;
            font-weight: 500;
            color: var(--dd-text-muted);
            display: inline-flex;
            align-items: center;
            gap: 5px;
            cursor: pointer;
            white-space: nowrap;
         }
         .f-tab.on {
            border-bottom-color: var(--dd-primary);
            color: var(--dd-text);
            font-weight: 600;
         }
         .cnt {
            font-size: 10px;
            background: var(--dd-surface-2);
            color: var(--dd-text-muted);
            border-radius: 999px;
            padding: 0 5px;
         }
         .f-body {
            padding: 14px 16px;
            display: flex;
            flex-direction: column;
            gap: 10px;
            overflow-y: auto;
            min-height: 0;
         }
         .f-body.gap12 {
            gap: 12px;
         }
         .f-body.gap14 {
            gap: 14px;
         }
         .f-body.fill {
            flex: 1 1 auto;
         }
         .f-between {
            display: flex;
            justify-content: space-between;
            align-items: center;
         }
         .f-link {
            border: none;
            background: transparent;
            color: var(--dd-primary);
            font: inherit;
            font-size: 12px;
            cursor: pointer;
            padding: 4px 6px;
            border-radius: 6px;
         }
         .f-link:hover {
            background: var(--dd-surface-2);
         }
         .f-lays {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 8px;
         }
         .lay {
            display: flex;
            flex-direction: column;
            gap: 4px;
            padding: 0;
            border: none;
            background: transparent;
            font: inherit;
            font-size: 11px;
            color: var(--dd-text-secondary, var(--dd-text));
            text-align: center;
            cursor: pointer;
         }
         .lay .lt {
            display: block;
            border-radius: 4px;
            border: 1px solid var(--dd-border);
            background: var(--dd-surface-2);
            overflow: hidden;
         }
         .lay.on .lt {
            border: 2px solid var(--dd-primary);
         }
         .f-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 8px;
            font-size: 13px;
            padding: 9px 0 0;
            border-top: 1px solid var(--dd-border);
         }
         .f-body.gap12 .f-row {
            border-top: none;
            padding: 0;
         }
         .f-sws {
            display: flex;
            gap: 6px;
         }
         .sw {
            width: 22px;
            height: 22px;
            padding: 0;
            border: none;
            border-radius: 5px;
            box-shadow: inset 0 0 0 1px var(--dd-border-strong, rgba(127, 127, 127, 0.55));
            cursor: pointer;
         }
         .sw.on {
            outline: 2px solid var(--dd-primary);
            outline-offset: 2px;
         }
         .tg {
            position: relative;
            width: 34px;
            height: 20px;
            padding: 0;
            border: none;
            border-radius: 999px;
            background: var(--dd-border-strong, var(--dd-border));
            cursor: pointer;
         }
         .tg::after {
            content: '';
            position: absolute;
            left: 2px;
            top: 2px;
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background: var(--dd-surface);
            transition: left 0.12s;
         }
         .tg.on {
            background: var(--dd-primary);
         }
         .tg.on::after {
            left: 16px;
         }
         .muted {
            color: var(--dd-text-muted);
         }
         .f-notes {
            width: 100%;
            box-sizing: border-box;
            resize: vertical;
            padding: 8px 10px;
            border: 1px solid var(--dd-border);
            border-radius: 8px;
            background: var(--dd-surface);
            color: var(--dd-text);
            font: inherit;
         }
         .f-seg {
            display: flex;
            flex-wrap: wrap;
            gap: 2px;
            padding: 3px;
            border-radius: 8px;
            background: var(--dd-surface-2);
         }
         .f-seg button {
            border: none;
            background: transparent;
            font: inherit;
            font-size: 12px;
            padding: 4px 8px;
            border-radius: 6px;
            color: var(--dd-text-muted);
            cursor: pointer;
         }
         .f-seg button.on {
            background: var(--dd-surface);
            color: var(--dd-text);
            font-weight: 600;
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
         }
         .f-select {
            min-width: 120px;
         }
         .f-select.grow {
            flex: 1;
         }
         .f-num {
            width: 90px;
            height: 28px;
            padding: 0 8px;
            border: 1px solid var(--dd-border);
            border-radius: 6px;
            background: var(--dd-surface);
            color: var(--dd-text);
            font: inherit;
         }
         .f-sect {
            border-top: 1px solid var(--dd-border);
            padding-top: 12px;
            display: flex;
            flex-direction: column;
            gap: 8px;
         }
         .f-small {
            font-size: 12px;
            color: var(--dd-text-muted);
         }
         .vt {
            color: #7048e8;
         }
         .vt.taken {
            text-decoration: line-through;
            color: var(--dd-text-muted);
         }
         .f-hint {
            padding: 6px 10px;
            font-size: 12px;
            color: var(--dd-text-muted);
         }
         .ly {
            display: grid;
            gap: 4px;
            padding: 6px;
            border: none;
            border-radius: 9px;
            background: transparent;
            font: inherit;
            font-size: 12px;
            color: var(--dd-text);
            text-align: left;
            cursor: pointer;
         }
         .ly.on {
            background: var(--dd-primary-weak);
         }
         .ly .lt {
            display: block;
            border-radius: 5px;
            border: 1px solid var(--dd-border);
            overflow: hidden;
            background: var(--dd-surface-2);
         }
         .ly.on .lt {
            border: 2px solid var(--dd-primary);
         }
         .ly .meta {
            display: flex;
            justify-content: space-between;
            color: var(--dd-text-muted);
         }
         .ly .meta b {
            color: var(--dd-text);
         }
         .ly.on .meta .nm {
            color: var(--dd-primary);
            font-weight: 600;
         }
         .f-div {
            height: 1px;
            background: var(--dd-border);
            margin: 4px 6px;
            flex-shrink: 0;
         }
         .f-acts {
            display: flex;
            gap: 4px;
            align-items: center;
         }
         .th-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 8px;
         }
         .th {
            padding: 0;
            border: 1px solid var(--dd-border);
            border-radius: 10px;
            overflow: hidden;
            background: transparent;
            font: inherit;
            font-size: 12px;
            color: var(--dd-text);
            text-align: left;
            cursor: pointer;
         }
         .th.on {
            outline: 2px solid var(--dd-primary);
            outline-offset: 1px;
         }
         .th .pv {
            display: flex;
            justify-content: space-between;
            height: 52px;
            padding: 8px;
            box-sizing: border-box;
            font-weight: 700;
            font-size: 14px;
         }
         .th .bars {
            display: flex;
            gap: 2px;
         }
         .th .bars span {
            width: 8px;
            height: 22px;
         }
         .th .nm {
            display: flex;
            justify-content: space-between;
            padding: 6px 8px;
            color: var(--dd-text-muted);
         }
         .th.on .nm span:first-child {
            color: var(--dd-text);
            font-weight: 600;
         }
         .tok-grid {
            display: grid;
            grid-template-columns: repeat(5, minmax(0, 1fr));
            gap: 8px 4px;
         }
         .tok {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 4px;
            padding: 0;
            border: none;
            background: transparent;
            font: inherit;
            font-size: 10px;
            color: var(--dd-text-muted);
            cursor: pointer;
         }
         .tok .sq {
            width: 26px;
            height: 26px;
            box-sizing: border-box;
            border-radius: 5px;
            border: 1px solid var(--dd-border-strong, rgba(127, 127, 127, 0.55));
         }
         .fnt {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 8px;
            padding: 4px 4px 4px 10px;
            border: 1px solid var(--dd-border);
            border-radius: 8px;
            font-size: 12px;
         }
         .f-design {
            margin-top: auto;
            border-top: 1px solid var(--dd-border);
            padding-top: 12px;
            display: flex;
            flex-direction: column;
            gap: 6px;
         }
         :host {
            display: flex;
            flex-direction: column;
            background: var(--dd-surface);
            border: 1px solid var(--dd-border);
            border-radius: 14px;
            box-shadow: var(--dd-shadow-2);
            color: var(--dd-text);
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
            color: var(--dd-text);
            background: transparent;
            border: 1px solid transparent;
            border-radius: 8px;
            padding: 0 8px;
            box-sizing: border-box;
            text-overflow: ellipsis;
         }
         .rename:hover:not(:disabled) {
            background: var(--dd-surface-2);
         }
         .rename:focus {
            outline: none;
            background: var(--dd-surface-2);
            border-color: var(--dd-primary);
         }
         h3 {
            margin: 0 0 8px;
            font-size: 11px;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            color: var(--dd-text-muted);
            display: flex;
            align-items: center;
            justify-content: space-between;
         }
         .actions {
            display: flex;
            gap: 8px;
            padding: 6px 12px 10px;
            align-items: center;
         }
         .split {
            display: inline-flex;
            flex: 1 1 auto;
            /* Never squeezed under its buttons (they would slide under New). */
            min-width: max-content;
         }
         .split button {
            height: 32px;
            border: 1px solid var(--dd-border);
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
            padding: 0 10px;
            border-radius: 8px 0 0 8px;
            background: var(--dd-primary);
            border-color: var(--dd-primary);
            color: #fff;
         }
         .split .from {
            flex: none;
            padding: 0 10px;
            border-radius: 0 8px 8px 0;
            border-left: none;
            background: var(--dd-surface-2);
            color: var(--dd-text);
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
         .newsplit {
            position: relative;
            display: inline-flex;
            flex: none;
         }
         .newsplit .new {
            padding: 0 8px;
            border-top-right-radius: 0;
            border-bottom-right-radius: 0;
         }
         .newsplit .caret {
            height: 32px;
            padding: 0 4px;
            border-top-left-radius: 0;
            border-bottom-left-radius: 0;
            border-left: none;
         }
         .menu {
            position: absolute;
            top: calc(100% + 4px);
            right: 0;
            z-index: 5;
            width: 200px;
            max-height: 320px;
            overflow-y: auto;
            padding: 4px;
            background: var(--dd-surface);
            border: 1px solid var(--dd-border);
            border-radius: 10px;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
            display: flex;
            flex-direction: column;
            gap: 2px;
         }
         .menu button {
            display: flex;
            align-items: center;
            gap: 8px;
            border: none;
            background: transparent;
            color: var(--dd-text);
            font: inherit;
            font-size: 12.5px;
            text-align: left;
            padding: 5px 6px;
            border-radius: 6px;
            cursor: pointer;
         }
         .menu button:hover {
            background: var(--dd-surface-2);
         }
         .mthumb {
            width: 48px;
            flex: none;
            aspect-ratio: 16 / 9;
            border: 1px solid var(--dd-border);
            border-radius: 3px;
            overflow: hidden;
            background: var(--dd-bg, transparent);
         }
         .lay-item {
            display: flex;
            align-items: center;
            gap: 8px;
         }
         .mthumb img {
            width: 100%;
            height: 100%;
            display: block;
         }
         .btn {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            height: 30px;
            padding: 0 10px;
            border-radius: 8px;
            border: 1px solid var(--dd-border);
            background: var(--dd-surface-2);
            color: var(--dd-text);
            font: inherit;
            font-weight: 600;
            cursor: pointer;
         }
         .btn:disabled {
            opacity: 0.45;
            cursor: default;
         }
         .btn.primary {
            background: var(--dd-primary);
            border-color: var(--dd-primary);
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
            color: var(--dd-text-muted);
            cursor: pointer;
         }
         .icon:hover {
            background: var(--dd-surface-2);
            color: var(--dd-text);
         }
         .top {
            flex: none;
            padding: 0 10px;
         }
         .row {
            display: flex;
            gap: 6px;
            margin: 4px 0 10px;
         }
         .layout-list {
            list-style: none;
            margin: 0;
            padding: 0;
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(92px, 1fr));
            gap: 6px;
         }
         .lcard {
            display: flex;
            flex-direction: column;
            gap: 2px;
            cursor: pointer;
            border: 1px solid var(--dd-border);
            border-radius: 6px;
            padding: 3px;
            position: relative;
         }
         .lcard.current {
            border-color: var(--dd-primary);
         }
         .lcard .lname {
            font-size: 11px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
         }
         .lcard .licons {
            position: absolute;
            top: 2px;
            right: 2px;
            display: none;
            gap: 2px;
         }
         .lcard:hover .licons {
            display: inline-flex;
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
            min-width: 0;
         }
         .design-seg {
            display: flex;
            margin: 14px 0 8px;
         }
         .tab {
            border: none;
            background: transparent;
            color: var(--dd-text-muted);
            font: inherit;
            font-size: 12px;
            font-weight: 600;
            padding: 5px 7px;
            border-radius: 8px;
            cursor: pointer;
            white-space: nowrap;
            flex: none;
         }
         .tab:hover {
            background: var(--dd-surface-2);
            color: var(--dd-text);
         }
         .tab.on {
            background: var(--dd-primary-weak);
            color: var(--dd-primary);
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
            color: var(--dd-text-muted);
            font: inherit;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
         }
         .strip:hover {
            color: var(--dd-text);
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
            color: var(--dd-text-muted);
         }
         .empty,
         .hint {
            margin: 6px 4px 10px;
            color: var(--dd-text-muted);
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
            background: var(--dd-surface-2);
         }
         .card.on {
            background: var(--dd-primary-weak);
            border-color: color-mix(in srgb, var(--dd-primary) 40%, transparent);
         }
         .card.current .thumb {
            border-color: var(--dd-primary);
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
            background: var(--dd-surface-2);
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
            color: var(--dd-primary);
         }
         .row.current .name {
            color: var(--dd-primary);
         }
         .row.over {
            box-shadow: 0 -2px 0 var(--dd-primary);
         }
         .row.hidden .thumb,
         .row.hidden .meta {
            opacity: 0.45;
         }
         .num {
            color: var(--dd-text-muted);
            font-size: 11px;
            font-weight: 700;
            text-align: center;
         }
         .card.current .num {
            color: var(--dd-primary);
         }
         .thumb {
            position: relative;
            display: block;
            width: 100%;
            border-radius: 6px;
            overflow: hidden;
            border: 1px solid var(--dd-border);
            background: var(--dd-canvas-bg);
         }
         .thumb .foreign {
            position: absolute;
            top: 3px;
            right: 3px;
            padding: 2px;
            border-radius: 4px;
            background: var(--dd-surface);
            color: var(--dd-warning, #d97706);
            font-size: 14px;
         }
         .design-pick {
            display: block;
            margin: 0 0 6px;
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
            color: var(--dd-text-muted);
         }
         .more {
            justify-self: end;
         }
         .listbar-actions {
            display: inline-flex;
            gap: 10px;
         }
         .listbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 4px 6px;
            font-size: 12px;
         }
         .muted {
            color: var(--dd-text-muted);
         }
         .btn.on {
            background: var(--dd-primary-weak);
            border-color: color-mix(in srgb, var(--dd-primary) 40%, transparent);
            color: var(--dd-primary);
         }
         .detail,
         .loose {
            margin-top: 14px;
            padding-top: 12px;
            border-top: 1px solid var(--dd-border);
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
            color: var(--dd-primary);
            font: inherit;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            padding: 2px 0;
            text-transform: none;
            letter-spacing: 0;
         }
         .theme-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
            margin-bottom: 12px;
         }
         .theme-card {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            gap: 6px;
            padding: 10px;
            border: 1px solid var(--dd-border);
            border-radius: var(--dd-radius-sm);
            cursor: pointer;
            text-align: left;
         }
         .theme-card.on {
            outline: 2px solid var(--dd-primary);
            outline-offset: 1px;
         }
         .theme-card:disabled {
            cursor: default;
         }
         .theme-name {
            font-size: 14px;
            font-weight: 600;
         }
         .theme-dots {
            display: flex;
            gap: 4px;
         }
         .theme-dots .dot {
            width: 12px;
            height: 12px;
            border-radius: 50%;
         }
         .sub {
            display: flex;
            align-items: center;
            justify-content: space-between;
            font-size: 11px;
            font-weight: 600;
            color: var(--dd-text-muted);
            margin: 4px 0 6px;
         }
         .token-grid {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 6px 8px;
         }
         .token {
            display: flex;
            align-items: center;
            gap: 6px;
            min-width: 0;
            padding: 0;
            border: none;
            background: none;
            font: inherit;
            font-size: 11px;
            color: var(--dd-text);
            cursor: pointer;
            text-align: left;
         }
         .token:disabled {
            cursor: default;
         }
         .tsw {
            flex: none;
            width: 26px;
            height: 26px;
            border-radius: 6px;
            border: 1px solid var(--dd-border);
         }
         .subt {
            display: inline-flex;
            align-items: center;
            gap: 4px;
         }
         .info {
            --dd-icon-size: 13px;
            color: var(--dd-text-muted);
            cursor: help;
         }
         .sub-actions {
            display: inline-flex;
            gap: 2px;
            --dd-icon-size: 15px;
         }
         .customize {
            margin: 2px 0 10px;
            border: 1px solid var(--dd-border);
            border-radius: var(--dd-radius-sm);
            padding: 6px 10px;
         }
         .customize > summary {
            cursor: pointer;
            font-size: 12px;
            font-weight: 600;
            color: var(--dd-text);
            padding: 2px 0;
         }
         .customize[open] > summary {
            margin-bottom: 8px;
         }
         .mine {
            position: relative;
            display: grid;
         }
         .mine-x {
            position: absolute;
            top: 2px;
            right: 2px;
            --dd-icon-size: 14px;
         }
         .theme-actions {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin: 4px 0 10px;
         }
         .tsw.follow {
            display: grid;
            place-items: center;
            background: linear-gradient(135deg, #ffffff 0 50%, #1e293b 50% 100%);
            color: #64748b;
            --dd-icon-size: 14px;
         }
         .tsw.none {
            background-image: linear-gradient(
               45deg,
               transparent 45%,
               var(--dd-danger) 45%,
               var(--dd-danger) 55%,
               transparent 55%
            );
         }
         .token:hover:not(:disabled) .tsw {
            outline: 2px solid var(--dd-primary);
            outline-offset: 1px;
         }
         .tlabel {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
         }
         .picker {
            display: block;
            padding: 8px;
            background: var(--dd-surface);
            border: 1px solid var(--dd-border);
            border-radius: var(--dd-radius);
            box-shadow: var(--dd-shadow-3);
         }
         .field {
            display: flex;
            flex-direction: column;
            gap: 4px;
            margin-bottom: 10px;
         }
         .field > span {
            font-size: 11px;
            color: var(--dd-text-muted);
         }
         .two {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
         }
         input[type='number'],
         .text-input,
         textarea {
            font: inherit;
            color: var(--dd-text);
            background: var(--dd-surface-2);
            border: 1px solid var(--dd-border);
            border-radius: var(--dd-radius-sm);
            padding: 6px 8px;
            box-sizing: border-box;
            width: 100%;
         }
         input[type='number'],
         .text-input {
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
            background: var(--dd-surface-2);
         }
      `,
   ],
})
export class SlidesPanelComponent {
   readonly command = output<SlidesCommand>();
   /** `list`: the slide cards (left of the frame); `settings`: transition/size/notes (right). */
   readonly part = input<
      | 'list'
      | 'settings'
      | 'size-menu'
      | 'theme-menu'
      | 'design-menu'
      | 'focus-list'
      | 'focus-settings'
      | 'focus-transition'
      | 'design-layouts'
      | 'design-theme'
   >('list');
   /** Settings panel only: folded sideways to a narrow strip. */
   readonly folded = input<boolean>(false);
   /** The slide of this presentation currently shown on the canvas (the only one visible). */
   readonly active_ = input<string | null>(null, { alias: 'active' });
   /** The presentation this panel belongs to (its name). */
   readonly presentation = input.required<string>();
   /** The last slide shown before a layout was opened (kept highlighted while editing it). */
   readonly lastSlide = input<string | null>(null);

   protected readonly store = inject(ProjectStore);
   private readonly render = inject(SlideRenderService);
   private readonly theme = inject(ThemeService);
   private readonly tagSuggestions = inject(MorphTagSuggestions);
   private readonly destroyRef = inject(DestroyRef);

   protected readonly typeOptions = TYPE_OPTIONS;
   protected readonly directionOptions = DIRECTION_OPTIONS;
   protected readonly easingOptions = EASING_OPTIONS;
   protected readonly morphByOptions = MORPH_BY_SELECT;

   protected readonly canEdit = this.store.canEdit;
   /** Slides of this presentation, in order (skipped ones included). */
   protected readonly frames = computed(() => presentationSlides(this.store.slideFrames(), this.presentation()));

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
      // Layouts carry the presentation name too.
      const slides = this.store.slideFrames().filter((f) => presentationOf(f) === current);
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
   private readonly pendingClone = signal<{ srcId: string; to: number; known: Set<string> } | null>(null);
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
   /** Layouts of this presentation. */
   protected readonly layouts = computed(() => presentationLayouts(this.store.slideFrames(), this.presentation()));
   /** The layouts shown in the Layout tab: the built-in Blank one is not edited. */
   /** The presentation's master (drawn under every slide and layout). */
   protected readonly master = computed(
      () => presentationMaster(this.store.slideFrames(), this.presentation()) ?? null
   );
   protected readonly editableLayouts = computed(() => this.layouts().filter((l) => !l.slide?.defaultLayout));
   /** The Layouts tab's cards: the design's own layouts (not ones kept from another design). */
   protected readonly designLayouts = computed(() => this.editableLayouts().filter((l) => !this.foreign(l)));
   /** The New menu's layouts: standard kinds first in their usual order, then the rest. */
   protected readonly menuLayouts = computed(() => {
      const rank = (l: CanvasElementModel): number => {
         const k = l.slide?.layoutKind;
         return k ? LAYOUT_KINDS.indexOf(k) : LAYOUT_KINDS.length;
      };
      return this.layouts()
         .filter((l) => !this.foreign(l))
         .sort((a, b) => rank(a) - rank(b));
   });
   protected readonly standardKinds = LAYOUT_KINDS.filter((k) => k !== 'blank');
   protected readonly kindLabels = LAYOUT_KIND_LABELS;
   /** Standard layout kinds this design doesn't have yet. */
   protected readonly missingKinds = computed(() => {
      const have = new Set(
         this.designLayouts()
            .map((l) => l.slide?.layoutKind)
            .filter(Boolean)
      );
      return this.standardKinds.filter((k) => !have.has(k));
   });

   /** Keep the shown layout's card in view (e.g. one just added). */
   private readonly followLayout = effect(() => {
      if (this.part() !== 'design-layouts') return;
      this.active_();
      this.designLayouts();
      setTimeout(
         () =>
            (this.host.nativeElement as HTMLElement)
               .querySelector('.f-cards .ly.on')
               ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
         60
      );
   });

   // ---- Layout cards: drag to reorder, Alt-drag to duplicate ----
   protected readonly lyDrag = signal<{ from: number; to: number; alt: boolean } | null>(null);
   protected lySuppress = false;
   protected onLayoutDown(index: number, event: PointerEvent): void {
      if (event.button !== 0 || !this.canEdit()) return;
      if ((event.target as HTMLElement).closest('.ly-del')) return;
      const scroller = (event.currentTarget as HTMLElement).parentElement as HTMLElement;
      const sx = event.clientX;
      const sy = event.clientY;
      let started = false;
      let lastY = sy;
      let alt = event.altKey;
      let raf = 0;
      /** The gap (0..n) the pointer is over: how many card centres lie above it. */
      const gapAt = (y: number): number => {
         let i = 0;
         for (const c of Array.from(scroller.querySelectorAll<HTMLElement>(':scope > .lyw'))) {
            const r = c.getBoundingClientRect();
            if (y > r.top + r.height / 2) i++;
         }
         return i;
      };
      const update = (): void => this.lyDrag.set({ from: index, to: gapAt(lastY), alt });
      const tick = (): void => {
         const r = scroller.getBoundingClientRect();
         if (lastY < r.top + 28) scroller.scrollTop -= 8;
         else if (lastY > r.bottom - 28) scroller.scrollTop += 8;
         update();
         raf = requestAnimationFrame(tick);
      };
      const move = (e: PointerEvent): void => {
         lastY = e.clientY;
         alt = e.altKey;
         if (!started) {
            if (Math.hypot(e.clientX - sx, e.clientY - sy) < 5) return;
            started = true;
            raf = requestAnimationFrame(tick);
         }
         update();
      };
      const onKey = (e: KeyboardEvent): void => {
         if (e.key === 'Alt' && started) {
            alt = e.type === 'keydown';
            e.preventDefault();
            update();
         }
      };
      const up = (e: PointerEvent): void => {
         window.removeEventListener('pointermove', move);
         window.removeEventListener('pointerup', up);
         window.removeEventListener('pointercancel', up);
         window.removeEventListener('keydown', onKey);
         window.removeEventListener('keyup', onKey);
         cancelAnimationFrame(raf);
         const d = this.lyDrag();
         this.lyDrag.set(null);
         if (!started || !d || e.type !== 'pointerup') return;
         this.lySuppress = true;
         setTimeout(() => (this.lySuppress = false), 0);
         const cards = this.designLayouts();
         const src = cards[index];
         if (!src) return;
         if (d.alt) {
            // Position in the deck's full layout list (other designs' layouts included).
            const all = this.layouts();
            const toIndex = d.to < cards.length ? all.indexOf(cards[d.to]) : all.indexOf(cards[cards.length - 1]) + 1;
            this.command.emit({ kind: 'duplicate', id: src.id, toIndex });
            return;
         }
         const to = d.to > index ? d.to - 1 : d.to;
         if (to === index) return;
         const next = [...cards];
         next.splice(index, 1);
         next.splice(to, 0, src);
         // Reuse the cards' own order slots, so other designs' layouts keep their places.
         const slots = cards.map((c) => c.slide?.order ?? 0).sort((a, b) => a - b);
         void this.store.batchHistory(async () => {
            for (let i = 0; i < next.length; i++) {
               const f = next[i];
               if (f.slide && f.slide.order !== slots[i]) {
                  await this.store.updateElement(f.id, { slide: { ...f.slide, order: slots[i] } });
               }
            }
         });
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
      window.addEventListener('keydown', onKey);
      window.addEventListener('keyup', onKey);
   }

   /** Add standard layouts to this presentation and show the first one. */
   protected async addStandard(kinds: readonly LayoutKind[]): Promise<void> {
      const anchor = this.active();
      if (!anchor || !this.canEdit()) return;
      const ids = await addStandardLayouts(this.store, anchor, kinds);
      if (ids[0]) this.command.emit({ kind: 'focus', id: ids[0] });
   }
   /** The layout on the canvas right now (being edited), if one is. */
   protected readonly shownLayout = computed(
      () =>
         this.layouts().find((l) => l.id === this.active_()) ??
         (this.master()?.id === this.active_() ? this.master() : null)
   );
   /** Showing a layout opens this tab, so its editing tools are at hand. */
   private readonly shownLayoutId = computed(() => this.shownLayout()?.id ?? null);
   private readonly layoutTab = effect(() => {
      if (this.shownLayoutId()) {
         untracked(() => {
            this.tab.set('design');
            this.designTab.set('layouts');
         });
      }
   });
   /** Leave the layout: show the first slide using it, else the first slide. */
   protected backToSlide(): void {
      const l = this.shownLayout();
      const slide =
         this.frames().find((f) => f.id === this.lastSlide()) ??
         this.frames().find((f) => f.slide?.layoutId === l?.id) ??
         this.frames()[0];
      if (slide) this.command.emit({ kind: 'focus', id: slide.id });
   }
   protected layoutName(l: CanvasElementModel): string {
      return layoutNameOf(l, this.store.slideFrames());
   }
   protected renameLayout(l: CanvasElementModel, input: HTMLInputElement): void {
      const name = input.value.trim().slice(0, 120);
      if (!l.slide || !name || name === this.layoutName(l)) {
         input.value = this.layoutName(l);
         return;
      }
      void this.store.updateElement(l.id, { slide: { ...l.slide, layoutName: name } });
   }
   protected readonly layoutOptions = computed<SelectOption<string>[]>(() =>
      this.layouts().map((l) => ({
         value: l.id,
         label: this.foreign(l) ? `⚠ ${this.layoutName(l)} (not in this design)` : this.layoutName(l),
      }))
   );
   /** The selected slides' common layout ('' = none; first slide's when they differ). */
   protected readonly activeLayoutValue = computed(() => {
      const a = this.active();
      return (a && layoutOf(a, this.store.slideFrames())?.id) ?? '';
   });
   protected setLayout(id: string): void {
      const targets = this.activeSlides().length ? this.activeSlides() : this.active() ? [this.active()!] : [];
      const layout = this.layouts().find((l) => l.id === id) ?? null;
      void this.store.batchHistory(async () => {
         for (const f of targets) {
            if (f.slide && (f.slide.layoutId ?? '') !== id) {
               await switchLayout(this.store, f, layout);
            }
         }
      });
   }

   protected readonly roleOptions: SelectOption<string>[] = [
      { value: '', label: 'None' },
      ...PLACEHOLDER_ROLES.map((r) => ({ value: r, label: r[0].toUpperCase() + r.slice(1) })),
   ];
   /** Selected text boxes on the shown layout (they can be made placeholders). */
   protected readonly layoutTextSelection = computed(() => {
      const l = this.shownLayout();
      const ids = new Set(this.store.selectedElementIds());
      return l ? this.store.elements().filter((e) => ids.has(e.id) && e.slideId === l.id && e.type === 'text') : [];
   });
   /** The shown slide (not a layout) when exactly it is what the tab edits. */
   private readonly driftSlide = computed(() => {
      const a = this.active();
      return a && !a.slide?.layout && this.activeSlides().length <= 1 ? a : null;
   });
   /** Placeholders on the slide moved/restyled or deleted away from its layout; null = none. */
   protected readonly drift = computed(() => {
      this.store.elements();
      const slide = this.driftSlide();
      const d = slide ? placeholderDrift(this.store, slide) : null;
      return d && (d.changed.length || d.missing.length || d.objects.length) ? d : null;
   });
   /** Selected placeholders that drifted (reset just those). */
   protected readonly selectedDrifted = computed(() => {
      const ids = new Set(this.store.selectedElementIds());
      const d = this.drift();
      return d ? [...d.changed, ...d.objects].filter((c) => ids.has(c.id)) : [];
   });
   protected driftLabel(d: PlaceholderDrift): string {
      const parts = [
         d.changed.length ? `${d.changed.length} placeholder${d.changed.length > 1 ? 's' : ''} changed` : '',
         d.missing.length ? `${d.missing.length} deleted` : '',
         d.objects.length ? `${d.objects.length} object${d.objects.length > 1 ? 's' : ''} changed` : '',
      ].filter(Boolean);
      return parts.join(', ') + ' from the layout';
   }
   protected resetSlide(selectedOnly: boolean): void {
      const slide = this.driftSlide();
      if (!slide) return;
      const only = selectedOnly ? new Set(this.selectedDrifted().map((c) => c.id)) : undefined;
      void this.store.batchHistory(() => resetSlideToLayout(this.store, slide, only));
   }
   /** Master items the shown slide or layout replaced with its own (double-click to make). */
   protected readonly standIns = computed(() => {
      this.store.elements();
      // The shown layout when editing one (a layout can change the master too), else the slide.
      const a = this.shownLayout() ?? (this.activeSlides().length <= 1 ? this.active() : null);
      // A copy made by just clicking the item, still as the master has it, is not a change.
      return a && !a.slide?.master
         ? masterStandIns(this.store, a.id).filter(
              (e) => !isLayoutStandIn(this.store, e) && standInChanged(this.store, e)
           )
         : [];
   });
   protected readonly selectedStandIns = computed(() => {
      const ids = new Set(this.store.selectedElementIds());
      return this.standIns().filter((e) => ids.has(e.id));
   });
   protected resetMaster(selectedOnly: boolean): void {
      const items = selectedOnly ? this.selectedStandIns() : this.standIns();
      void this.store.batchHistory(() => resetToMaster(this.store, items));
   }
   /** Change the selected layout text boxes' placeholders, then bring slides in line. */
   private editPlaceholders(fn: (e: CanvasElementModel) => PlaceholderConfig | null): void {
      const items = this.layoutTextSelection();
      const layout = this.shownLayout();
      if (!layout) return;
      void this.store.batchHistory(async () => {
         for (const e of items) await this.store.updateElement(e.id, { placeholder: fn(e) });
         await syncLayoutCopies(this.store, layout);
      });
   }
   protected setPlaceholder(on: boolean): void {
      this.editPlaceholders((e) => (on ? (e.placeholder ?? {}) : null));
   }
   protected setRole(role: string): void {
      this.editPlaceholders((e) => {
         const { role: _old, ...rest } = e.placeholder ?? {};
         return role ? { ...rest, role: role as PlaceholderRole } : rest;
      });
   }
   /** The New button's layout menu is open. */
   protected readonly newMenu = signal(false);
   private readonly closeNewMenu = (): void => this.newMenu.set(false);
   private readonly newMenuWatch = effect((onCleanup) => {
      if (!this.newMenu()) return;
      // Any press outside the menu closes it.
      const t = setTimeout(() => document.addEventListener('pointerdown', this.closeNewMenu));
      onCleanup(() => {
         clearTimeout(t);
         document.removeEventListener('pointerdown', this.closeNewMenu);
      });
   });
   /** The layout plain "New" uses (the shown layout or the shown slide's), for its tooltip. */
   protected readonly newLayoutName = computed(() => {
      const shown = this.store.slideFrames().find((f) => f.id === this.active_());
      const l = shown?.slide?.layout ? shown : shown && layoutOf(shown, this.store.slideFrames());
      return l ? this.layoutName(l) : null;
   });
   protected addWithLayout(layoutId: string | null): void {
      this.newMenu.set(false);
      this.command.emit({ kind: 'add', layoutId });
   }
   /** Layout thumbnails for the list panel's New menu (rendered here, the settings panel has its own). */
   protected readonly layoutThumbs = signal<ReadonlyMap<string, string>>(new Map());
   private readonly layoutThumbWatch = effect((onCleanup) => {
      // The list panel renders on opening its New menu; the focus filmstrip's popover can't signal open, so it renders up front.
      const part = this.part();
      if (!(part === 'list' && this.newMenu()) && part !== 'focus-list') return;
      const layouts = [...this.layouts()];
      this.theme.dark();
      let live = true;
      void this.render.render(layouts, { fonts: false }).then((rs) => {
         if (live) this.layoutThumbs.set(new Map(rs.map((r) => [r.id, SlideRenderService.dataUrl(r.svg)])));
      });
      onCleanup(() => (live = false));
   });
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
   /** Settings tab; shared with focus mode so the choice survives going in and out of it. */
   protected readonly tab = inject(FocusUiState).canvasTab;

   protected pick(tab: 'transition' | 'design' | 'size' | 'notes' | 'animations'): void {
      this.tab.set(tab);
   }

   /** A tab the deck header asked to open (a fresh object each request). */
   readonly requestTab = input<{ tab: 'transition' | 'design' | 'size' | 'notes' | 'animations' } | null>(null);
   private readonly applyRequestedTab = effect(() => {
      const r = this.requestTab();
      if (r) untracked(() => this.tab.set(r.tab));
   });

   /** The selected slides (the details edit all of them at once). */
   protected readonly activeSlides = computed<CanvasElementModel[]>(() => {
      const ids = new Set(this.store.selectedElementIds());
      return this.frames().filter((f) => ids.has(f.id));
   });
   protected readonly selectedCount = computed(() => this.activeSlides().length);
   /** The slide the details show: the first selected one, else the slide on the canvas. */
   protected readonly active = computed<CanvasElementModel | null>(
      () => this.activeSlides()[0] ?? this.frames().find((f) => f.id === this.active_()) ?? null
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
   /** On the first slide: there is a next slide whose transition can be mapped. */
   protected readonly morphRelevantNext = computed(() => this.frames().length > 1 && this.activeSlides().length <= 1);

   protected readonly hasTransitionTarget = computed(() => {
      const first = this.frames()[0]?.id;
      const targets = this.activeSlides().length ? this.activeSlides() : this.active() ? [this.active()!] : [];
      return targets.some((f) => f.id !== first);
   });

   protected readonly sizeOptions = computed<SelectOption<string>[]>(() => {
      const opts = FRAME_PRESETS.map((p) => ({
         value: p.id,
         label: `${p.label} (${p.width} × ${p.height})`,
      }));
      return this.sizeValue() === 'custom' ? [{ value: 'custom', label: 'Custom / mixed' }, ...opts] : opts;
   });
   /** The preset every slide matches, or 'custom'. */
   protected readonly sizeValue = computed(() => {
      // Every slide of a presentation shares one size.
      const slides = this.frames();
      const hit = FRAME_PRESETS.find((p) =>
         slides.every((f) => Math.round(f.width) === p.width && Math.round(f.height) === p.height)
      );
      return slides.length && hit ? hit.id : 'custom';
   });
   protected readonly transition = computed<SlideTransition>(() =>
      effectiveTransition((this.activeSlides().find((f) => f.id !== this.frames()[0]?.id) ?? this.active())?.slide)
   );

   /** True when a morph is involved: the transition into this slide or into the one before it. */
   protected readonly morphRelevant = computed(() => {
      const frames = this.frames();
      // Layouts (and masters) feed every slide that uses them, so their objects can be tagged.
      const layoutIds = new Set(
         this.store
            .slideFrames()
            .filter((f) => f.slide?.layout)
            .map((f) => f.id)
      );
      if (this.selectedObjects().some((e) => !!e.slideId && layoutIds.has(e.slideId))) {
         return true;
      }
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
            out.push({
               kind: 'lifeline',
               id: l.id,
               morphId: l.morphId,
               slideId: diagrams.get(l.diagramId)?.slideId,
            });
         }
      }
      for (const m of this.store.sequenceMessages()) {
         if (messages.has(m.id)) {
            out.push({
               kind: 'message',
               id: m.id,
               morphId: m.morphId,
               slideId: diagrams.get(m.diagramId)?.slideId,
            });
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
   /** The single selected element, with its split in / out tags (split = either is set). */
   protected readonly splitTarget = computed(() => {
      const t = this.tagTargets();
      if (t.length !== 1 || t[0].kind !== 'element') return null;
      const e = this.store.elements().find((x) => x.id === t[0].id);
      if (!e) return null;
      const split = e.morphIn != null || e.morphOut != null;
      return { id: e.id, split, in: e.morphIn ?? e.morphId, out: e.morphOut ?? e.morphId };
   });
   protected tagText(key: string | undefined): string {
      const t = morphTagOf(key);
      return t && !t.startsWith('solo-') ? t : '';
   }
   /** Split: start both sides from the shared tag. Join: drop both (the shared tag applies). */
   protected toggleSplit(st: { id: string; split: boolean; in?: string; out?: string }): void {
      const e = this.store.elements().find((x) => x.id === st.id);
      if (!e) return;
      const base = e.morphId ?? `tag:solo-${e.id.slice(0, 8)}`;
      void this.store.updateElement(
         e.id,
         st.split ? { morphIn: null, morphOut: null } : { morphIn: base, morphOut: base }
      );
   }
   protected setSplitTag(side: 'in' | 'out', value: string): void {
      const st = this.splitTarget();
      if (!st) return;
      const key = morphIdForTag(value) ?? `tag:solo-${side}-${st.id.slice(0, 8)}`;
      void this.store.updateElement(st.id, side === 'in' ? { morphIn: key } : { morphOut: key });
   }
   /** Tags other objects on this slide already carry: one tag names one object per slide. */
   protected readonly takenTags = computed(() => {
      const targets = this.tagTargets();
      const slideId = targets.find((e) => e.slideId)?.slideId ?? this.store.activeSlideId();
      return this.tagSuggestions.tagsTakenOn(slideId, new Set(targets.map((t) => t.id)));
   });
   /** The morph tag shared by the selection ('' when none or they differ). */
   protected readonly morphTag = computed(() => {
      // A slide's placeholder copy without its own tag shows the one set on the layout's placeholder.
      const byId = new Map(this.selectedObjects().map((e) => [e.id, e] as const));
      const inherited = (id: string): string | undefined => {
         const of = byId.get(id)?.placeholder?.of;
         return of ? this.store.elements().find((p) => p.id === of)?.morphId : undefined;
      };
      const tags = new Set(this.tagTargets().map((e) => morphTagOf(e.morphId ?? inherited(e.id)) ?? ''));
      return tags.size === 1 ? [...tags][0] : '';
   });
   /** Tags used on the slide before the selection's, offered while typing a tag. */
   protected readonly morphTagSuggestions = computed(() =>
      this.tagSuggestions.previousSlideTags(
         this.tagTargets().find((e) => e.slideId)?.slideId ?? this.store.activeSlideId()
      )
   );
   /** How many selected non-frame elements could be linked as one object (2+). */
   protected readonly pairable = computed(() => {
      const n = this.selectedObjects().length;
      return n >= 2 ? n : 0;
   });

   private renderToken = 0;

   // ---- Focus mode views ----
   /** Focus settings dock: Slide or Notes (Transition / Animations open their own screens). */
   /** Focus dock tab; kept outside this panel so it survives trips to the other focus screens. */
   protected readonly ftab = inject(FocusUiState).tab;
   /** The custom theme / design being renamed in a focus menu or card. */
   protected readonly renaming = signal<string | null>(null);
   protected finishRename(id: string, value: string): void {
      if (this.renaming() !== id) return;
      this.renaming.set(null);
      const name = value.trim();
      if (name) void this.renameRecord(id, name);
   }
   /** Themes for the focus menus and cards: built-in, then custom ("My themes"). */
   protected readonly themeGroups = computed(() => {
      const cur = this.deckTheme().id ?? 'default';
      const item = (t: SlideTheme, custom: boolean) => ({
         id: t.id!,
         name: t.name,
         custom,
         on: t.id === cur,
         theme: t,
      });
      const custom = this.library().filter((r) => recordKind(r) === 'theme' && r.id);
      return [
         { name: 'Built-in', items: BUILT_IN_THEMES.map((t) => item(t, false)) },
         ...(custom.length ? [{ name: 'My themes', items: custom.map((t) => item(t, true)) }] : []),
      ];
   });
   /** Designs for the focus top-bar menu: built-in, then custom. */
   protected readonly designGroups = computed(() => {
      const cur = this.design().id;
      const groups = new Map<
         string,
         { id: string; name: string; custom: boolean; on: boolean; theme: SlideTheme | null }[]
      >();
      for (const o of this.designOptions()) {
         const g = o.group ?? 'Designs';
         const list = groups.get(g) ?? [];
         list.push({ id: o.value, name: o.label, custom: !isBuiltInRecord(o.value), on: o.value === cur, theme: null });
         groups.set(g, list);
      }
      return [...groups.entries()].map(([name, items]) => ({ name, items }));
   });
   /** Theme colors offered as slide backgrounds (DeckFocus mock: four swatches). */
   protected readonly bgTokens = ['background', 'heading', 'accent1', 'surface'] as const;
   protected token(k: ThemeColorToken): string {
      return themeToken(k);
   }
   protected setBackground(color: string): void {
      const a = this.active();
      if (!a || !this.canEdit()) return;
      void this.store.updateElement(a.id, { backgroundColor: color, fillStyle: 'solid' });
   }
   /** Animation build steps on a slide (badge ▶ N). */
   protected animCount(f: CanvasElementModel): number {
      const steps = new Set<number>();
      for (const e of this.store.elements()) if (e.slideId === f.id && e.step) steps.add(e.step);
      return steps.size;
   }
   protected readonly transitionLabel = computed(() => {
      const t = this.active()?.slide?.transition?.type ?? 'none';
      return t === 'none' ? 'None' : t.charAt(0).toUpperCase() + t.slice(1);
   });
   protected readonly focusTypes: { value: SlideTransitionType; label: string }[] = [
      { value: 'morph', label: 'Morph' },
      { value: 'fade', label: 'Fade' },
      { value: 'slide', label: 'Slide' },
      { value: 'zoom', label: 'Zoom' },
      { value: 'none', label: 'None' },
   ];
   protected readonly focusMorphBy: { value: MorphBy; label: string }[] = [
      { value: 'character', label: 'Char' },
      { value: 'word', label: 'Word' },
      { value: 'object', label: 'Object' },
   ];
   /** Slides of this deck that use a layout (DeckDesign "N slides"). */
   protected usage(layoutId: string): number {
      return this.frames().filter((f) => f.slide?.layoutId === layoutId).length;
   }
   /** Theme cards for the design screen: built-in themes, then custom ones. */
   protected readonly themeCards = computed(() => [
      ...BUILT_IN_THEMES.map((t) => ({ ...t, custom: false })),
      ...this.library()
         .filter((r) => recordKind(r) === 'theme' && r.id)
         .map((t) => ({ ...t, custom: true })),
   ]);

   private readonly hostEl = inject(ElementRef<HTMLElement>);
   /** Focus slide list: keep the current slide in view (entering focus, switching slides). */
   private readonly keepCurrentInView = effect(() => {
      if (this.part() !== 'focus-list') return;
      this.active_();
      this.shown();
      setTimeout(() => {
         const el = (this.hostEl.nativeElement as HTMLElement).querySelector('.fs.on');
         el?.scrollIntoView({ block: 'nearest' });
      }, 60);
   });

   constructor() {
      // Re-render thumbnails (debounced) whenever anything that can appear on a slide changes.
      effect((onCleanup) => {
         const master = this.master();
         const frames =
            this.part() === 'list' || this.part() === 'focus-list'
               ? [...this.frames()]
               : [...(master ? [master] : []), ...this.layouts()];
         this.store.elements();
         this.store.tables();
         this.store.relationships();
         this.store.sequenceDiagrams();
         this.store.lifelines();
         this.store.sequenceMessages();
         this.theme.dark();
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
      const rendered = dirty.length ? await this.render.render(dirty, { fonts: false, ghosts: true }) : [];
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
         layoutOf(frame, this.store.slideFrames())?.id,
         masterOf(frame, this.store.slideFrames())?.id
      );
      // Fields ({{slide}} / {{total}}) change with the deck's order and size.
      const deckOrder = presentableSlides(this.store.slideFrames())
         .filter((f) => presentationOf(f) === presentationOf(frame))
         .map((f) => f.id)
         .join();
      // Rows not assigned to any slide are offered to every frame and cropped away when
      // outside it, so only those overlapping the frame affect its picture.
      const f = { x0: frame.x, y0: frame.y, x1: frame.x + frame.width, y1: frame.y + frame.height };
      const overlaps = (b: { x0: number; y0: number; x1: number; y1: number } | null): boolean =>
         !!b && b.x1 >= f.x0 && b.x0 <= f.x1 && b.y1 >= f.y0 && b.y0 <= f.y1;
      const elements = mine.elements.filter(
         (e) => e.id === frame.id || e.slideId === frame.id || overlaps(elementBox(e))
      );
      const tables = mine.tables.filter((t) => t.slideId === frame.id || overlaps(tableBox(t)));
      const diagrams = mine.diagrams.filter(
         (d) => d.slideId === frame.id || overlaps(sequenceDiagramBox(d, mine.lifelines, mine.messages))
      );
      const diagramIds = new Set(diagrams.map((d) => d.id));
      const columns = new Set(tables.flatMap((t) => t.columns.map((c) => c.id)));
      const relationships = this.store
         .relationships()
         .filter((r) => columns.has(r.sourceColumnId) || columns.has(r.targetColumnId));
      // Layout items arrive as re-stacked copies; compare the stored rows instead.
      const rows = new Map(this.store.elements().map((e) => [e.id, e] as const));
      return [
         frame,
         // Thumbnails bake in the theme's colors.
         this.theme.dark(),
         deckOrder,
         ...elements.map((e) => rows.get(e.id) ?? e),
         // Empty placeholders are drawn from their layout slot: redraw when either changes.
         ...placeholderGhosts(frame.id, this.store.elements()).sources,
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
      const base = this.activeSlides().length ? this.activeSlides() : this.active() ? [this.active()!] : [];
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

   protected readonly colorTokens = THEME_COLOR_TOKENS;
   protected readonly accentTokens = ['heading', 'accent1', 'accent2', 'accent3', 'accent4'] as const;
   protected readonly colorLabels = THEME_COLOR_LABELS;
   protected readonly css = themeSwatchCss;
   /** The follow-light/dark-mode choice for a theme color: the surface for fills, text otherwise. */
   protected followValue(token: ThemeColorToken): string {
      return token === 'background' || token === 'surface' ? THEME_FILL : THEME_STROKE;
   }
   protected isFollow(color: string): boolean {
      return color === THEME_FILL || color === THEME_STROKE;
   }
   protected readonly fontOptions: SelectOption[] = FONT_OPTIONS.map((f) => ({ ...f, font: fontStack(f.value) }));
   protected stackOf(key: string): string {
      return fontStack(key);
   }

   // ---- Designs: one layout set plus a selected theme ----
   // Built-in themes, layout sets and designs never change: editing one saves a custom copy.
   // Custom records live in the project (shared with collaborators) and in My designs.

   private readonly userThemes = inject(UserThemesService);
   private readonly loadMyThemes = effect(() => {
      if (
         this.tab() === 'design' ||
         this.part() === 'design-theme' ||
         this.part() === 'theme-menu' ||
         this.part() === 'design-menu'
      )
         untracked(() => void this.userThemes.load());
   });
   /** The project's custom records. */
   protected readonly customThemes = this.store.customThemes;
   /** Every custom record: the project's, then the rest of My designs. */
   protected readonly library = computed<SlideTheme[]>(() => {
      const out = [...this.customThemes()];
      const ids = new Set(out.map((r) => r.id));
      for (const row of this.userThemes.themes()) if (!ids.has(row.theme.id)) out.push(row.theme);
      return out;
   });
   private record(id: string | undefined): SlideTheme | undefined {
      if (!id) return undefined;
      return (
         [...BUILT_IN_THEMES, ...BUILT_IN_LAYOUT_SETS, ...BUILT_IN_DESIGNS].find((r) => r.id === id) ??
         this.library().find((r) => r.id === id)
      );
   }

   /** The deck's design and layout set, as its frames record them. */
   private readonly deckRefs = computed(() => {
      const name = this.presentation();
      // Prefer a frame that records the design: frames added later may carry only the theme.
      const mine = this.store.slideFrames().filter((f) => presentationOf(f) === name && f.slide?.theme);
      const t = (mine.find((f) => f.slide!.theme!.designId) ?? mine[0])?.slide?.theme;
      return { designId: t?.designId, layoutsId: t?.layoutsId };
   });
   /** The deck's design (Default until another is picked). */
   protected readonly design = computed<SlideTheme>(() => {
      const d = this.record(this.deckRefs().designId);
      return d && recordKind(d) === 'design' ? d : DEFAULT_DESIGN;
   });
   protected readonly designIsCustom = computed(() => !isBuiltInRecord(this.design().id));
   /** The deck's layout set. */
   protected readonly layoutSetId = computed(
      () => this.deckRefs().layoutsId ?? this.design().layoutsId ?? DEFAULT_LAYOUT_SET.id!
   );
   protected readonly layoutSet = computed<SlideTheme>(() => this.record(this.layoutSetId()) ?? DEFAULT_LAYOUT_SET);

   /** The deck's selected theme (the default until one is picked). */
   protected readonly deckTheme = computed<SlideTheme>(() => {
      const name = this.presentation();
      const stored = (name ? this.store.presentationThemes().get(name) : undefined) ?? DEFAULT_THEME;
      const rec = this.record(stored.id);
      return rec && recordKind(rec) === 'theme' ? themeTokensOnly(rec) : themeTokensOnly(stored);
   });
   protected readonly themeIsCustom = computed(() => {
      const id = this.deckTheme().id;
      return !!id && !isBuiltInRecord(id) && this.library().some((r) => r.id === id);
   });

   protected readonly designOptions = computed<SelectOption<string>[]>(() => [
      ...BUILT_IN_DESIGNS.map((d) => ({ value: d.id!, label: d.name, group: 'Built-in' })),
      ...this.library()
         .filter((r) => recordKind(r) === 'design' && r.id)
         .map((d) => ({ value: d.id!, label: d.name, group: 'Custom', renamable: this.canEdit() })),
   ]);
   protected readonly themeOptions = computed<SelectOption<string>[]>(() => {
      const opts: SelectOption<string>[] = [
         ...BUILT_IN_THEMES.map((t) => ({ value: t.id!, label: t.name, group: 'Built-in' })),
         ...this.library()
            .filter((r) => recordKind(r) === 'theme' && r.id)
            .map((t) => ({ value: t.id!, label: t.name, group: 'Custom', renamable: this.canEdit() })),
      ];
      const cur = this.deckTheme();
      if (cur.id && !opts.some((o) => o.value === cur.id))
         opts.push({ value: cur.id, label: cur.name, group: 'Custom' });
      return opts;
   });

   /** A layout from a layout set the deck no longer uses, kept because slides still use it. */
   protected foreign(l: CanvasElementModel): boolean {
      return isForeignLayout(l, this.layoutSetId());
   }
   /** A slide whose layout is not one of the design's layouts. */
   protected slideForeign(f: CanvasElementModel): boolean {
      const l = layoutOf(f, this.store.slideFrames());
      return !!l && this.foreign(l);
   }

   /** Feedback from design, theme and layout actions. */
   protected readonly themeNote = signal<string | null>(null);
   /** Shown after a switch that kept layouts slides still use. */
   protected readonly relayoutNote = signal<string | null>(null);

   /** Design tab sub-tab: the design's layouts, or its theme. */
   protected readonly designTab = signal<'layouts' | 'theme'>('layouts');
   protected readonly designTabOptions: SegmentedOption<'layouts' | 'theme'>[] = [
      { value: 'layouts', label: 'Layouts' },
      { value: 'theme', label: 'Theme' },
   ];
   /** Which part the next imported file is used as. */
   protected readonly importPart = signal<ThemeFilePart>('design');

   private newId(): string {
      return `custom-${crypto.randomUUID()}`;
   }
   /** A name not yet used by a custom record. */
   private freshName(base: string): string {
      const names = new Set(this.library().map((c) => c.name));
      let name = base;
      for (let n = 2; names.has(name); n++) name = `${base} ${n}`;
      return name;
   }
   /** Add or replace custom records (by id) in the project and My designs, and drop `remove`. */
   private async saveRecords(upserts: SlideTheme[], remove: string[] = []): Promise<void> {
      const ids = new Set([...upserts.map((u) => u.id), ...remove]);
      await this.store.setCustomThemes([...this.customThemes().filter((c) => !ids.has(c.id)), ...upserts]);
      for (const u of upserts) {
         this.userThemes.save(u).catch(() => this.themeNote.set('Could not save to My designs.'));
      }
      for (const id of remove) {
         const row = this.userThemes.themes().find((t) => t.theme.id === id);
         if (row) void this.userThemes.remove(row.id);
      }
   }
   private designRecord(name: string, themeId: string | undefined, layoutsId: string): SlideTheme {
      return {
         ...themeTokensOnly(DEFAULT_THEME),
         kind: 'design',
         id: this.newId(),
         name,
         themeId,
         layoutsId,
      };
   }
   private layoutsRecord(name: string, content: Pick<SlideTheme, 'layouts' | 'extraLayouts' | 'master'>): SlideTheme {
      return {
         ...themeTokensOnly(DEFAULT_THEME),
         kind: 'layouts',
         id: this.newId(),
         name,
         ...content,
      };
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
      const name = this.presentation();
      const tokens = themeTokensOnly(theme);
      const touched: string[] = [];
      for (const f of this.store.slideFrames()) {
         if (!f.slide) continue;
         let next: SlideTheme | null = null;
         if (presentationOf(f) === name) next = { ...tokens, designId, layoutsId };
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
   private fontsDiffer(a: SlideTheme, b: SlideTheme): boolean {
      return a.fonts.heading !== b.fonts.heading || a.fonts.body !== b.fonts.body;
   }
   private async loadFonts(theme: SlideTheme): Promise<void> {
      await Promise.all([
         ensureFontLoaded(theme.fonts.heading as FontFamily),
         ensureFontLoaded(theme.fonts.body as FontFamily),
      ]);
   }

   /** Put the deck on a design: its layout set's layouts and the given theme. */
   private async switchTo(design: SlideTheme, set: SlideTheme, theme: SlideTheme): Promise<void> {
      const name = this.presentation();
      if (!name || !this.canEdit()) return;
      const fromSetId = this.layoutSetId();
      const from = this.deckTheme();
      await this.loadFonts(theme);
      this.applying = true;
      try {
         await this.store.batchHistory(async () => {
            const frames = await this.stamp(theme, design.id!, set.id!);
            if (set.id !== fromSetId) {
               const editing = this.shownLayoutId();
               const { kept, replaced } = await applyLayoutSet(this.store, name, fromSetId, set, theme);
               // Keep editing the layout that was on the canvas, now under the new set's id.
               const next = editing && replaced.get(editing);
               if (next) this.command.emit({ kind: 'focus', id: next });
               this.relayoutNote.set(
                  kept
                     ? `${kept} layout${kept > 1 ? 's' : ''} not in this design ${kept > 1 ? 'are' : 'is'} kept for the slides that use ${kept > 1 ? 'them' : 'it'} (flagged).`
                     : null
               );
            }
            if (this.fontsDiffer(from, theme)) await this.refitText(frames);
         });
      } finally {
         this.applying = false;
      }
      this.rebaseline();
   }

   protected async pickDesign(id: string): Promise<void> {
      if (id === this.design().id) return;
      const target = this.record(id);
      if (!target) return;
      this.themeNote.set(null);
      await this.flushLayouts();
      const set = this.record(target.layoutsId) ?? DEFAULT_LAYOUT_SET;
      const theme = this.record(target.themeId) ?? DEFAULT_THEME;
      await this.switchTo(target, set, themeTokensOnly(theme));
   }

   /** New design: a copy of this one (its layouts and theme) to change freely. */
   protected async newDesign(): Promise<void> {
      const name = this.presentation();
      if (!name || !this.canEdit()) return;
      await this.flushLayouts();
      const d = this.design();
      const cur = this.deckTheme();
      const designName = this.freshName(`${d.name} copy`);
      const theme: SlideTheme = {
         ...cur,
         kind: 'theme',
         id: this.newId(),
         name: this.freshName(`${cur.name} copy`),
      };
      const set = this.layoutsRecord(`${designName} layouts`, captureLayoutSet(this.store, name, this.layoutSetId()));
      const design = this.designRecord(designName, theme.id, set.id!);
      await this.saveRecords([theme, set, design]);
      await this.store.batchHistory(async () => {
         await this.retagLayouts(set.id!, false);
         await this.stamp(theme, design.id!, set.id!);
      });
      this.rebaseline();
   }

   /** The option above `id` in a dropdown list, or the one below when it is first. */
   private neighborOf(opts: SelectOption<string>[], id: string): string | undefined {
      const i = opts.findIndex((o) => o.value === id);
      if (i < 0) return undefined;
      return (opts[i - 1] ?? opts[i + 1])?.value;
   }

   /** Delete the deck's custom design; the deck moves to the design above it in the list (or below). */
   protected async deleteDesign(): Promise<void> {
      const d = this.design();
      if (!this.designIsCustom() || !this.canEdit()) return;
      clearTimeout(this.layoutTimer);
      const setId = this.layoutSetId();
      const nextId = this.neighborOf(this.designOptions(), d.id!);
      const next = (nextId && this.record(nextId)) || DEFAULT_DESIGN;
      if (next === DEFAULT_DESIGN) {
         await this.switchTo(DEFAULT_DESIGN, DEFAULT_LAYOUT_SET, this.deckTheme());
      } else {
         const set = this.record(next.layoutsId) ?? DEFAULT_LAYOUT_SET;
         const theme = this.record(next.themeId) ?? DEFAULT_THEME;
         await this.switchTo(next, set, themeTokensOnly(theme));
      }
      const setShared = this.library().some(
         (r) => r.id !== d.id && recordKind(r) === 'design' && r.layoutsId === setId
      );
      await this.saveRecords([], [d.id!, ...(setShared || isBuiltInRecord(setId) ? [] : [setId])]);
      this.themeNote.set(`Deleted "${d.name}".`);
   }

   /** Select a theme for the design (a custom design remembers it). */
   protected async pickTheme(id: string): Promise<void> {
      if (id === this.deckTheme().id) return;
      const rec = this.record(id);
      if (!rec) return;
      const theme = themeTokensOnly(rec);
      const d = this.design();
      if (this.designIsCustom()) await this.saveRecords([{ ...d, themeId: id }]);
      await this.writeTheme(theme, d.id!);
   }

   /** Put a theme's colors and fonts on the deck (and on other decks using it, when it was edited). */
   private async writeTheme(theme: SlideTheme, designId: string, everywhere = false): Promise<void> {
      if (!this.presentation() || !this.canEdit()) return;
      const from = this.deckTheme();
      await this.loadFonts(theme);
      await this.store.batchHistory(async () => {
         const frames = await this.stamp(theme, designId, this.layoutSetId(), everywhere);
         if (this.fontsDiffer(from, theme)) await this.refitText(frames);
      });
   }

   /**
    * Change the theme's colors, fonts or name. A built-in theme is copied into a custom one,
    * and a built-in design into a custom design using it, so the defaults never change.
    */
   private async editTheme(patch: Partial<SlideTheme>): Promise<void> {
      if (!this.canEdit()) return;
      const cur = this.deckTheme();
      const custom = this.themeIsCustom();
      const theme: SlideTheme = custom
         ? { ...cur, kind: 'theme', ...patch }
         : {
              ...cur,
              kind: 'theme',
              id: this.newId(),
              name: this.freshName(`${cur.name} custom`),
              ...patch,
           };
      const upserts: SlideTheme[] = [theme];
      let design = this.design();
      if (!this.designIsCustom()) {
         design = this.designRecord(this.freshName(`${design.name} custom`), theme.id, this.layoutSetId());
         upserts.push(design);
         this.themeNote.set(`Saved your changes as "${design.name}".`);
      } else if (design.themeId !== theme.id) {
         design = { ...design, themeId: theme.id };
         upserts.push(design);
      }
      await this.saveRecords(upserts);
      await this.writeTheme(theme, design.id!, custom);
   }

   protected setThemeColor(token: ThemeColorToken, color: string): void {
      void this.editTheme({ colors: { ...this.deckTheme().colors, [token]: color } });
   }
   protected setThemeFont(token: ThemeFontToken, font: string): void {
      void this.editTheme({ fonts: { ...this.deckTheme().fonts, [token]: font } });
   }
   /** Rename a custom design or theme (from the pencil in its dropdown). */
   protected async renameRecord(id: string, name: string): Promise<void> {
      const rec = this.library().find((r) => r.id === id);
      if (!rec || isBuiltInRecord(id) || !this.canEdit()) return;
      const renamed = { ...rec, name };
      await this.saveRecords([renamed]);
      // Slides carry their theme's name too: keep it in step.
      if (recordKind(rec) === 'theme' && this.deckTheme().id === id) {
         await this.writeTheme(themeTokensOnly(renamed), this.design().id!, true);
      }
   }

   /** Delete any custom theme (the deck's own one moves to its neighbour first). */
   protected async deleteThemeById(id: string): Promise<void> {
      if (!this.canEdit() || isBuiltInRecord(id)) return;
      if (id === this.deckTheme().id) return this.deleteTheme();
      await this.saveRecords([], [id]);
   }

   /** Delete any custom design (and its layout set when nothing else uses it). */
   protected async deleteDesignById(id: string): Promise<void> {
      if (!this.canEdit() || isBuiltInRecord(id)) return;
      if (id === this.design().id) return this.deleteDesign();
      const rec = this.record(id);
      if (!rec) return;
      const setId = rec.layoutsId;
      const setShared = this.library().some((r) => r.id !== id && recordKind(r) === 'design' && r.layoutsId === setId);
      await this.saveRecords([], [id, ...(!setId || setShared || isBuiltInRecord(setId) ? [] : [setId])]);
      this.themeNote.set(`Deleted "${rec.name}".`);
   }

   /** Delete the selected custom theme; the deck takes the theme above it in the list (or below). */
   protected async deleteTheme(): Promise<void> {
      const t = this.deckTheme();
      if (!this.themeIsCustom() || !this.canEdit()) return;
      await this.pickTheme(this.neighborOf(this.themeOptions(), t.id!) ?? DEFAULT_THEME.id!);
      await this.saveRecords([], [t.id!]);
   }

   // ---- Layout edits: saved into the design's layout set ----
   private applying = false;
   private layoutTimer?: ReturnType<typeof setTimeout>;
   /** The deck's layouts as last saved (or first seen), per deck and set. */
   private layoutBaseline: { key: string; sig: string } | null = null;
   private readonly watchLayouts = effect(() => {
      this.store.elements();
      const name = this.presentation();
      this.layoutSetId();
      if (!name || !this.canEdit()) return;
      untracked(() => {
         clearTimeout(this.layoutTimer);
         this.layoutTimer = setTimeout(() => void this.checkLayouts(), 800);
      });
   });
   private layoutSignature(): {
      key: string;
      sig: string;
      content: ReturnType<typeof captureLayoutSet>;
   } | null {
      const name = this.presentation();
      if (!name) return null;
      const setId = this.layoutSetId();
      const content = captureLayoutSet(this.store, name, setId);
      return { key: `${name}|${setId}`, sig: JSON.stringify(content), content };
   }
   /** Until when changes to the layouts are follow-ups of our own switch (saves, refits), not edits. */
   private settleUntil = 0;
   private rebaseline(): void {
      clearTimeout(this.layoutTimer);
      this.settleUntil = Date.now() + 2500;
      const s = this.layoutSignature();
      this.layoutBaseline = s ? { key: s.key, sig: s.sig } : null;
   }
   /** Save pending layout edits now (before the deck switches design). */
   private async flushLayouts(): Promise<void> {
      clearTimeout(this.layoutTimer);
      await this.checkLayouts();
   }
   private async checkLayouts(): Promise<void> {
      if (this.applying || !this.canEdit()) return;
      const s = this.layoutSignature();
      if (!s) return;
      if (!this.layoutBaseline || this.layoutBaseline.key !== s.key || Date.now() < this.settleUntil) {
         this.layoutBaseline = { key: s.key, sig: s.sig };
         return;
      }
      if (s.sig === this.layoutBaseline.sig) return;
      this.layoutBaseline.sig = s.sig;
      const set = this.layoutSet();
      if (!isBuiltInRecord(set.id)) {
         await this.saveRecords([{ ...set, ...s.content }]);
         return;
      }
      // The first edit to built-in layouts: they become a custom set (and design) of their own.
      const wasBuiltIn = !this.designIsCustom();
      let design = this.design();
      const fresh = this.layoutsRecord(
         this.freshName(`${this.designIsCustom() ? design.name : `${design.name} custom`} layouts`),
         s.content
      );
      design = this.designIsCustom()
         ? { ...design, layoutsId: fresh.id }
         : this.designRecord(this.freshName(`${design.name} custom`), this.deckTheme().id, fresh.id!);
      await this.saveRecords([fresh, design]);
      this.applying = true;
      try {
         await this.retagLayouts(fresh.id!, true);
         await this.stamp(this.deckTheme(), design.id!, fresh.id!, false, true);
      } finally {
         this.applying = false;
      }
      this.rebaseline();
      if (wasBuiltIn) this.themeNote.set(`Saved your changes as "${design.name}".`);
   }
   /** Hand the deck's current layouts over to the set `setId`. */
   private async retagLayouts(setId: string, silent: boolean): Promise<void> {
      const name = this.presentation();
      if (!name) return;
      for (const l of deckLayouts(this.store, name)) {
         if (l.slide?.master || this.foreign(l) || !l.slide?.layoutSetId) continue;
         const patch = { slide: { ...l.slide, layoutSetId: setId } };
         if (silent) await this.store.patchElementSilently(l.id, patch);
         else await this.store.updateElement(l.id, patch);
      }
   }

   // ---- Files ----
   /** The deck's layouts as a layout set (for export). */
   private exportedLayouts(): SlideTheme {
      const name = this.presentation() ?? '';
      const set = this.layoutSet();
      return {
         ...themeTokensOnly(DEFAULT_THEME),
         kind: 'layouts',
         name: isBuiltInRecord(set.id) ? `${this.design().name} layouts` : set.name,
         ...captureLayoutSet(this.store, name, this.layoutSetId()),
      };
   }

   /** Download the design (layouts and theme), just its layouts, or just its theme. */
   protected exportDesign(part: ThemeFilePart): void {
      const d = this.design();
      const layouts = this.exportedLayouts();
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
   protected async importDesign(input: HTMLInputElement): Promise<void> {
      const part = this.importPart();
      const file = input.files?.[0];
      input.value = '';
      if (!file || !this.canEdit()) return;
      let parsed: ParsedThemeFile | string;
      try {
         parsed = parseThemeFile(JSON.parse(await file.text()));
      } catch {
         parsed = 'The file is not valid JSON.';
      }
      if (typeof parsed === 'string') {
         this.themeNote.set(parsed);
         return;
      }
      await this.flushLayouts();
      if (part === 'theme') {
         if (!parsed.theme) return this.themeNote.set('The file has no theme.');
         const theme: SlideTheme = {
            ...parsed.theme,
            kind: 'theme',
            id: this.newId(),
            name: this.freshName(parsed.theme.name),
         };
         await this.saveRecords([theme]);
         await this.pickTheme(theme.id!);
         this.themeNote.set(`Imported the theme "${theme.name}".`);
         return;
      }
      if (part === 'layouts') {
         if (!parsed.layouts) return this.themeNote.set('The file has no layouts.');
         const set: SlideTheme = {
            ...parsed.layouts,
            kind: 'layouts',
            id: this.newId(),
            name: this.freshName(parsed.layouts.name),
         };
         const design = this.designIsCustom()
            ? { ...this.design(), layoutsId: set.id }
            : this.designRecord(this.freshName(`${this.design().name} custom`), this.deckTheme().id, set.id!);
         await this.saveRecords([set, design]);
         await this.switchTo(design, set, this.deckTheme());
         this.themeNote.set(`Imported the layouts "${set.name}".`);
         return;
      }
      const upserts: SlideTheme[] = [];
      let theme = this.deckTheme();
      if (parsed.theme) {
         theme = {
            ...parsed.theme,
            kind: 'theme',
            id: this.newId(),
            name: this.freshName(parsed.theme.name),
         };
         upserts.push(theme);
      }
      let set = this.layoutSet();
      if (parsed.layouts) {
         set = {
            ...parsed.layouts,
            kind: 'layouts',
            id: this.newId(),
            name: this.freshName(parsed.layouts.name),
         };
         upserts.push(set);
      }
      const design = this.designRecord(this.freshName(parsed.name), theme.id, set.id!);
      upserts.push(design);
      await this.saveRecords(upserts);
      await this.switchTo(design, set, themeTokensOnly(theme));
      this.themeNote.set(`Imported the design "${design.name}".`);
   }

   protected isSelected(id: string): boolean {
      return this.activeSlides().some((f) => f.id === id);
   }

   protected selectAll(): void {
      this.store.setSelection(
         [],
         [],
         this.frames().map((f) => f.id)
      );
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
            revealCard(cards?.querySelectorAll('li.card, .fs')[index], cards);
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
      const targets = [...this.frames(), ...this.layouts()];
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
      count: number;
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
      const cards = Array.from((this.host.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('li.card'));
      const slots = cards.map((el) => ({ top: el.offsetTop, height: el.offsetHeight }));
      const me = slots[index];
      if (!me) {
         return;
      }
      const gap = slots.length > 1 ? Math.max(0, slots[1].top - slots[0].top - slots[0].height) : 0;
      const centers = slots.map((s) => s.top + s.height / 2);
      const srcFrame = this.shown()[index];
      // Alt-dragging one of several selected slides copies all of them, in deck order.
      const selected = new Set(this.activeSlides().map((f) => f.id));
      const copyIds =
         srcFrame && selected.has(srcFrame.id) && selected.size > 1
            ? this.shown()
                 .filter((f) => selected.has(f.id))
                 .map((f) => f.id)
            : srcFrame
              ? [srcFrame.id]
              : [];
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
               ? {
                    id: srcFrame.id,
                    top: me.top,
                    height: me.height,
                    fw: srcFrame.width,
                    fh: srcFrame.height,
                    count: copyIds.length,
                 }
               : null
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
               this.command.emit({ kind: 'duplicate', id: srcFrame.id, ids: copyIds, toIndex: to });
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
      // A placeholder copy whose layout slot is tagged would fall back to that tag when
      // cleared, so clearing gives it its own id instead (an untagged override).
      const slotTag = (id: string): string | undefined => {
         const of = this.store.elements().find((e) => e.id === id)?.placeholder?.of;
         const tag = of ? this.store.elements().find((p) => p.id === of)?.morphId : undefined;
         return morphTagOf(tag) !== null ? tag : undefined;
      };
      const next = (t: { kind: string; id: string }): string | null =>
         morphId === null && t.kind === 'element' && slotTag(t.id) ? t.id : morphId;
      const targets = this.tagTargets().filter((e) =>
         morphId === null
            ? morphTagOf(e.morphId) !== null || (e.kind === 'element' && !e.morphId && !!slotTag(e.id))
            : e.morphId !== morphId
      );
      if (!targets.length) {
         return;
      }
      void this.store.batchHistory(async () => {
         for (const t of targets) {
            if (t.kind === 'element') {
               await this.store.updateElement(t.id, { morphId: next(t) });
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
   return a.every(
      (v, i) => v === b[i] || (typeof v === 'object' && v !== null && shiftedKey(v, 0, 0) === shiftedKey(b[i], dx, dy))
   );
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
