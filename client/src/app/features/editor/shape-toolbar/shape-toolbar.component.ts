import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { AlignAction, ExportImageFormat } from '../canvas-toolbar/canvas-toolbar.component';

/** The active canvas tool: 'select', the ERD 'table', plus one per drawable element kind. */
export type EditorTool =
  | 'select'
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
  imports: [MatButtonModule, MatIconModule, MatMenuModule, MatTooltipModule],
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

  /** True when a shape tool is active, so the dock's Shape button reads as selected. */
  protected readonly isShape = computed(() => SHAPE_TOOLS.includes(this.tool()));
  /** The icon the Shape dock button shows — the active shape, or a rectangle default. */
  protected readonly shapeIcon = computed(() => SHAPE_ICONS[this.tool()] ?? 'crop_square');

  protected onChange(value: EditorTool): void {
    this.toolChange.emit(value);
  }
}
