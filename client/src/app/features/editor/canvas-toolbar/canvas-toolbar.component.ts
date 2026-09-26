import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';

export type AlignAction =
  | 'left'
  | 'hcenter'
  | 'right'
  | 'top'
  | 'vcenter'
  | 'bottom'
  | 'dist-h'
  | 'dist-v';

/** Image export formats offered in the export menu. */
export type ExportImageFormat = 'svg' | 'png' | 'pdf';

/** Floating canvas toolbar: add table, zoom, grid-snap, alignment, save status. */
@Component({
  selector: 'app-canvas-toolbar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule, MatMenuModule, MatTooltipModule],
  templateUrl: './canvas-toolbar.component.html',
  styleUrl: './canvas-toolbar.component.scss',
})
export class CanvasToolbarComponent {
  readonly zoomLabel = input.required<string>();
  readonly saveLabel = input<string>('');
  readonly canAdd = input<boolean>(false);
  readonly gridSnap = input<boolean>(false);
  readonly canAlign = input<boolean>(false);
  readonly canExport = input<boolean>(false);

  readonly addTable = output<void>();
  readonly zoomIn = output<void>();
  readonly zoomOut = output<void>();
  readonly resetView = output<void>();
  readonly toggleGrid = output<void>();
  readonly align = output<AlignAction>();
  readonly exportSql = output<void>();
  readonly exportImage = output<ExportImageFormat>();
}
