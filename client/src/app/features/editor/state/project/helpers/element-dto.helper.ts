import type { CanvasElementModel, CreateElementDto, UpdateElementDto } from '@devdesigner/shared';

/** Build a create DTO from an existing element (for undo/redo re-creation). */
export function elementToCreateDto(e: CanvasElementModel): CreateElementDto {
   return {
      type: e.type,
      x: e.x,
      y: e.y,
      width: e.width,
      height: e.height,
      angle: e.angle,
      strokeColor: e.strokeColor,
      backgroundColor: e.backgroundColor,
      fillStyle: e.fillStyle,
      strokeWidth: e.strokeWidth,
      strokeStyle: e.strokeStyle,
      opacity: e.opacity,
      zIndex: e.zIndex,
      cornerRadius: e.cornerRadius,
      ellipticCorners: e.ellipticCorners,
      elbow: e.elbow,
      clipContent: e.clipContent,
      points: e.points,
      text: e.text,
      fontSize: e.fontSize,
      fontFamily: e.fontFamily,
      bold: e.bold,
      aboveTables: e.aboveTables,
      italic: e.italic,
      lineHeight: e.lineHeight,
      wrap: e.wrap,
      runs: e.runs,
      textAlign: e.textAlign,
      verticalAlign: e.verticalAlign,
      startBinding: e.startBinding,
      endBinding: e.endBinding,
      startArrowhead: e.startArrowhead,
      endArrowhead: e.endArrowhead,
      curvature: e.curvature,
      fileId: e.fileId,
      language: e.language,
      fileName: e.fileName,
      diffText: e.diffText,
      diffView: e.diffView,
      diffSplit: e.diffSplit,
      diffShowWhitespace: e.diffShowWhitespace,
      expandedHeight: e.expandedHeight,
      slide: e.slide,
      placeholder: e.placeholder,
      overrides: e.overrides,
      morphId: e.morphId,
      morphIn: e.morphIn,
      morphOut: e.morphOut,
      step: e.step,
      slideId: e.slideId,
   };
}

/** Capture the current values of the keys a patch will change (for undo). */
export function captureBefore(element: CanvasElementModel, patch: UpdateElementDto): UpdateElementDto {
   const before: Record<string, unknown> = {};
   for (const key of Object.keys(patch)) {
      if (
         key === 'startBinding' ||
         key === 'endBinding' ||
         key === 'slide' ||
         key === 'runs' ||
         key === 'morphId' ||
         key === 'step' ||
         key === 'slideId' ||
         key === 'expandedHeight' ||
         key === 'diffText' ||
         key === 'media'
      ) {
         before[key] = element[key] ?? null;
      } else if (key === 'fileName') {
         before[key] = element.fileName ?? '';
      } else {
         before[key] = (element as unknown as Record<string, unknown>)[key];
      }
   }
   return before as UpdateElementDto;
}
