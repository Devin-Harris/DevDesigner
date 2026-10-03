/** Shared action types for the editor toolbars (dock, status bar, top-bar). */

/** Alignment / distribution actions applied to the selected tables (≥2). */
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
