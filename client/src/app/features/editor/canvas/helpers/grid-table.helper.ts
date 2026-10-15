// The grid table data format lives in @dbdesigner/shared (the MCP server writes it
// too); re-exported here under the short names the editor code uses.
export {
  GRID_MIN_CELL,
  GRID_CELL_PAD,
  GRID_DEFAULT_COL_W,
  GRID_DEFAULT_ROW_H,
  defaultGrid,
  parseGrid,
  serializeGrid,
  gridSizes,
  gridCellAt,
  gridInPixels,
  gridEdges as edges,
  gridInsertRow as insertRow,
  gridInsertCol as insertCol,
  gridDeleteRow as deleteRow,
  gridDeleteCol as deleteCol,
  gridDragBorder as dragBorder,
  gridCellKey as cellKey,
  gridMergeAt as mergeAt,
  gridCellOrigin as cellOrigin,
  gridExpandToMerges as expandToMerges,
  gridMergeBlock as mergeBlock,
  gridUnmergeBlock as unmergeBlock,
} from '@dbdesigner/shared';
export type {
  GridData,
  GridEdit,
  GridCellStyle as CellStyle,
  GridCellMerge as CellMerge,
} from '@dbdesigner/shared';
