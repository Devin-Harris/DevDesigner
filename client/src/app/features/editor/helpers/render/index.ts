// SVG render views for canvas elements (was helpers/shape-render.helper.ts, split in pass 3.2).
// Callers import from this barrel; the files behind it are internal to the render folder.
export { FONT_OPTIONS, FONT_STACKS, fontStack, fontWeightFor } from './fonts';
export { SURFACE_FILL, contrastSafe, type ThemeColors } from './theme-colors';
export { baselineInLine, clearShapeRenderCaches } from './text-layout';
export {
   CODE_DOTS_WIDTH,
   CODE_FONT_SIZE,
   CODE_PADDING,
   codeColumns,
   codeContentSize,
   codeDiffActive,
   codeDiffEditLayout,
   codeDiffSplit,
   codeElementContentSize,
   codeHeaderHeight,
   codeLayoutMetrics,
   codeLineCount,
   codePrintWidth,
   codeTitle,
} from './code-block.render';
export { gridColNeed, gridFont, gridRowNeeds } from './grid-table.render';
export {
   imageView,
   lineEnds,
   rectCornerRadius,
   splitAtGaps,
   shapeTextBox,
   shapeLabelOptions,
   SHAPE_TEXT_PADDING,
} from './shape-primitives';
export { layoutTextBlock } from './text-layout';
export { ShapeViewCache, buildShapeViews } from './shape-views';
