import { ChangeDetectionStrategy, Component, computed, effect, inject, input, model, output, signal } from '@angular/core';
import { DEFAULT_FRAME_PRESET, FRAME_PRESETS } from '../canvas/constants/frame-presets';
import { MatTooltipModule } from '@angular/material/tooltip';
import { IconComponent } from '../../../shared/ui/icon/icon.component';
import { PopoverTriggerDirective } from '../../../shared/ui/popover/popover-trigger.directive';
import { ProjectStore } from '../../../stores/project.store';
import type { AlignAction, ExportImageFormat } from '../canvas/models/toolbar-actions';

/** Default corner radius (px) applied when the rounded-rectangle variant is picked. */
const ROUNDED_RADIUS = 12;

/** The active canvas tool: 'select', the 'hand' pan tool, the ERD 'table', plus one per drawable element kind. */
export type EditorTool =
  | 'select'
  | 'hand'
  | 'table'
  | 'sequence'
  | 'rectangle'
  | 'ellipse'
  | 'diamond'
  | 'arrow'
  | 'line'
  | 'text'
  | 'freedraw'
  | 'frame'
  | 'slide'
  | 'code'
  | 'laser';

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
  selector: 'app-shape-toolbar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatTooltipModule, IconComponent, PopoverTriggerDirective],
  templateUrl: './shape-toolbar.component.html',
  styleUrl: './shape-toolbar.component.scss',
})
export class ShapeToolbarComponent {
  readonly tool = input.required<EditorTool>();
  readonly disabled = input<boolean>(false);
  readonly zoomLabel = input<string>('100%');
  readonly saveLabel = input<string>('');
  readonly gridSnap = input<boolean>(false);
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
  readonly setHome = output<void>();
  readonly clearHome = output<void>();
  readonly toggleGrid = output<void>();
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

  /** True when a shape tool is active, so the dock's Shape button reads as selected. */
  protected readonly isShape = computed(() => SHAPE_TOOLS.includes(this.tool()));
  /** The icon the Shape dock button shows — the last-picked shape. */
  protected readonly shapeIcon = computed(() => SHAPE_ICONS[this.lastShape()] ?? 'crop_square');

  private readonly store = inject(ProjectStore);

  /**
   * Which rectangle variant was last chosen — sharp (0) or rounded (>0) — so the
   * square and rounded-square flyout buttons highlight independently and new
   * rectangles keep the picked corner radius. Defaults to rounded.
   */
  protected readonly rectRadius = signal<number>(ROUNDED_RADIUS);

  constructor() {
    // Remember the most recent shape tool so the dock reflects it afterward.
    effect(() => {
      const t = this.tool();
      if (SHAPE_TOOLS.includes(t)) {
        this.lastShape.set(t);
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
