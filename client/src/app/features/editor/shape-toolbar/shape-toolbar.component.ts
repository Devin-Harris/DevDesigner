import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
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
  | 'rectangle'
  | 'ellipse'
  | 'diamond'
  | 'arrow'
  | 'line'
  | 'text'
  | 'freedraw';

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
  readonly canExport = input<boolean>(false);
  readonly canUndo = input<boolean>(false);
  readonly canRedo = input<boolean>(false);

  readonly toolChange = output<EditorTool>();
  readonly undo = output<void>();
  readonly redo = output<void>();
  readonly zoomIn = output<void>();
  readonly zoomOut = output<void>();
  readonly resetView = output<void>();
  readonly toggleGrid = output<void>();
  readonly align = output<AlignAction>();
  readonly exportSql = output<void>();
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

  /** Pick the rectangle tool with a specific corner radius (square vs rounded). */
  protected pickRectangle(radius: number): void {
    this.rectRadius.set(radius);
    this.store.setElementStyle({ cornerRadius: radius });
    this.onChange('rectangle');
  }
}
