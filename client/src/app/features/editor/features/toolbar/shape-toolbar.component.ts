import {
   ChangeDetectionStrategy,
   Component,
   DestroyRef,
   ElementRef,
   afterNextRender,
   computed,
   effect,
   inject,
   input,
   model,
   output,
   signal,
} from '@angular/core';
import { DEFAULT_FRAME_PRESET, FRAME_PRESETS } from '../../shared/constants/frame-presets';
import { MatTooltipModule } from '@angular/material/tooltip';
import { IconComponent } from '../../../../shared/ui/components/icon/icon.component';
import { PopoverTriggerDirective } from '../../../../shared/ui/directives/popover-trigger.directive';
import { ProjectStore } from '../../state/project/project.store';
import type { EditorTool } from '../../models/editor-tool.model';
import { DockToolId, ToolbarPrefsService } from './services/toolbar-prefs.service';
import type { AlignAction, ExportImageFormat } from '../../models/toolbar-actions';

/** Default corner radius (px) applied when the rounded-rectangle variant is picked. */
const ROUNDED_RADIUS = 12;

/** Shape tools grouped behind the dock's Shape flyout. */
const SHAPE_TOOLS: readonly EditorTool[] = ['rectangle', 'ellipse', 'diamond'];

const SHAPE_ICONS: Record<string, string> = {
   rectangle: 'crop_square',
   ellipse: 'circle',
   diamond: 'diamond',
};

/**
 * The canvas command surface, split into two floating bars over the canvas:
 * a left vertical tool DOCK (select / table / shapes flyout / arrow / line /
 * draw / text) and a bottom-left STATUS bar (undo, redo, zoom, grid snap,
 * align, export, save state). The host is a pointer-transparent overlay so the
 * canvas underneath stays interactive.
 */
@Component({
   selector: 'dd-shape-toolbar',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [MatTooltipModule, IconComponent, PopoverTriggerDirective],
   templateUrl: './shape-toolbar.component.html',
   styleUrl: './shape-toolbar.component.scss',
})
export class ShapeToolbarComponent {
   /** Dock modifiers: position, labels, compact. */
   protected readonly dockClass = computed(() => {
      const p = this.prefs;
      return `dock at-${p.position()}${p.labels() ? ' labels' : ''}${p.compact() ? ' compact' : ''}${this.wrapped() || p.twoColumns() ? ' wrap' : ''}`;
   });
   /** A side dock too tall for the space (short window, browser zoom) flows into two columns. */
   protected readonly wrapped = signal(false);
   /** Height the dock needs as a single column, measured while unwrapped. */
   private singleColumnHeight = 0;
   private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
   private readonly destroyRef = inject(DestroyRef);
   /** Tooltips open away from the dock's edge. */
   protected readonly tipPos = computed(() => {
      const pos = this.prefs.position();
      return pos === 'left' ? 'right' : pos === 'right' ? 'left' : pos === 'top' ? 'below' : 'above';
   });
   /** Flyouts open away from the dock's edge. */
   protected readonly morePlacement = computed(() => {
      const pos = this.prefs.position();
      return pos === 'left'
         ? 'right-start'
         : pos === 'right'
           ? 'left-start'
           : pos === 'top'
             ? 'below-start'
             : 'above-start';
   });

   private fitDock(): void {
      const dock = this.host.nativeElement.querySelector<HTMLElement>('.dock');
      const pos = this.prefs.position();
      queueMicrotask(() => this.prefs.leftDockWidth.set(dock && pos === 'left' ? dock.offsetWidth : 0));
      if (!dock || (pos !== 'left' && pos !== 'right')) {
         if (this.wrapped()) this.wrapped.set(false);
         return;
      }
      if (this.prefs.twoColumns()) return; // always two columns: nothing to decide
      // Room the dock may use: its container minus the top offset and the bottom bar
      // (mirrors the CSS max-height, which getComputedStyle may report as a calc()).
      const host = this.host.nativeElement;
      const avail = host.clientHeight - dock.offsetTop - 76;
      // Measure the single-column height fresh each time (labels/compact change it),
      // briefly dropping the wrap class if it is on.
      const hadWrap = dock.classList.contains('wrap');
      if (hadWrap) dock.classList.remove('wrap');
      this.singleColumnHeight = dock.scrollHeight;
      if (hadWrap) dock.classList.add('wrap');
      const needWrap = this.singleColumnHeight > avail + 1;
      if (needWrap !== this.wrapped()) this.wrapped.set(needWrap);
   }

   /** Use a tool the dock hides (from the More menu). */
   protected useHidden(id: DockToolId): void {
      switch (id) {
         case 'shape':
            this.onChange(this.lastShape());
            return;
         case 'connector':
            this.onChange(this.lastConnector());
            return;
         case 'image':
            this.addImage.emit();
            return;
         default:
            this.onChange(id);
      }
   }

   readonly tool = input.required<EditorTool>();
   readonly disabled = input<boolean>(false);
   readonly zoomLabel = input<string>('100%');
   readonly saveLabel = input<string>('');
   readonly gridSnap = input<boolean>(false);
   readonly smartGuides = input<boolean>(false);
   /** Minimap shown (bottom right). */
   readonly minimap = input<boolean>(true);
   readonly canAlign = input<boolean>(false);
   /** Three or more units selected, so distribute is meaningful. */
   readonly canDistribute = input<boolean>(false);
   /** A lone selection aligns to its surrounding frame/shape rather than to peers. */
   readonly alignToContainer = input<boolean>(false);
   readonly canExport = input<boolean>(false);
   readonly canUndo = input<boolean>(false);
   readonly canRedo = input<boolean>(false);
   /** True when the project has a saved home view. */
   readonly hasHome = input<boolean>(false);
   /** Whether the viewer may save/clear the shared home view (editors only). */
   readonly canSetHome = input<boolean>(false);

   /** The aspect-ratio preset new frames are drawn with (two-way bound to the editor). */
   readonly framePreset = model<string>(DEFAULT_FRAME_PRESET);
   protected readonly framePresets = FRAME_PRESETS;

   readonly toolChange = output<EditorTool>();
   readonly undo = output<void>();
   readonly redo = output<void>();
   readonly zoomIn = output<void>();
   readonly zoomOut = output<void>();
   readonly resetView = output<void>();
   readonly zoomFit = output<void>();
   readonly zoomSelection = output<void>();
   readonly setHome = output<void>();
   readonly clearHome = output<void>();
   readonly toggleGrid = output<void>();
   readonly toggleSmartGuides = output<void>();
   readonly toggleMinimap = output<void>();
   readonly align = output<AlignAction>();
   readonly exportSql = output<void>();
   /** Open the image picker (images are placed via the editor, not drawn). */
   readonly addImage = output<void>();
   readonly exportImage = output<ExportImageFormat>();

   /**
    * The last shape tool the user picked, so the dock's Shape button keeps
    * showing that shape (and re-activates it on click) after a draw commits and
    * the active tool reverts to 'select'.
    */
   protected readonly lastShape = signal<EditorTool>('rectangle');
   /** Last of Arrow / Line, so the merged dock button keeps showing it. */
   protected readonly lastConnector = signal<EditorTool>('arrow');

   /** True when a shape tool is active, so the dock's Shape button reads as selected. */
   protected readonly isShape = computed(() => SHAPE_TOOLS.includes(this.tool()));
   /** The icon the Shape dock button shows — the last-picked shape. */
   protected readonly shapeIcon = computed(() => SHAPE_ICONS[this.lastShape()] ?? 'crop_square');

   private readonly store = inject(ProjectStore);

   /** Dock customization (which tools show, in what order). */
   protected readonly prefs = inject(ToolbarPrefsService);
   protected readonly dockTools = this.prefs.visibleTools;

   /**
    * Which rectangle variant was last chosen — sharp (0) or rounded (>0) — so the
    * square and rounded-square flyout buttons highlight independently and new
    * rectangles keep the picked corner radius. Defaults to rounded.
    */
   protected readonly rectRadius = signal<number>(ROUNDED_RADIUS);

   constructor() {
      afterNextRender(() => {
         const ro = new ResizeObserver(() => this.fitDock());
         ro.observe(this.host.nativeElement);
         const dock = this.host.nativeElement.querySelector('.dock');
         if (dock) ro.observe(dock);
         this.destroyRef.onDestroy(() => ro.disconnect());
      });
      // Tool set / sizing changes alter the dock's height: re-check.
      effect(() => {
         this.dockClass();
         this.dockTools();
         queueMicrotask(() => this.fitDock());
      });
      // Remember the most recent shape tool so the dock reflects it afterward.
      effect(() => {
         const t = this.tool();
         if (SHAPE_TOOLS.includes(t)) {
            this.lastShape.set(t);
         }
         if (t === 'arrow' || t === 'line') {
            this.lastConnector.set(t);
         }
      });
   }

   protected onChange(value: EditorTool): void {
      this.toolChange.emit(value);
   }

   /** Pick the frame tool with a specific page ratio. */
   protected pickFrame(presetId: string): void {
      this.framePreset.set(presetId);
      this.onChange('frame');
   }

   /** Pick the rectangle tool with a specific corner radius (square vs rounded). */
   protected pickRectangle(radius: number): void {
      this.rectRadius.set(radius);
      this.store.setElementStyle({ cornerRadius: radius });
      this.onChange('rectangle');
   }
}
