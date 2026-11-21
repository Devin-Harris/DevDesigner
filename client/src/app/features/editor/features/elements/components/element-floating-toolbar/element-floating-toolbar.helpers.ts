import type { ArrowheadType, StrokeStyle } from '@devdesigner/shared';

/** Module-level pieces of element-floating-toolbar.component. */

export const STROKE_WIDTHS: { value: number; label: string }[] = [
   { value: 1, label: 'Thin' },
   { value: 2, label: 'Bold' },
   { value: 4, label: 'Extra bold' },
];

export const STROKE_STYLE_ICONS: { value: StrokeStyle; icon: string }[] = [
   { value: 'solid', icon: 'remove' },
   { value: 'dashed', icon: 'more_horiz' },
   { value: 'dotted', icon: 'drag_handle' },
];

export const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 36, 44, 48, 60, 72, 96];

/** Element types that carry text (their own, or a label) and take font styling. */
export const TEXT_TYPES = new Set(['text', 'rectangle', 'ellipse', 'diamond', 'grid']);

export const TEXT_SIZE_DEFAULT = 20;

export const CODE_FONT_SIZES = [11, 12, 14, 16, 18, 20, 24];

export const ARROWHEADS: { value: ArrowheadType; icon: string; label: string }[] = [
   { value: 'none', icon: 'horizontal_rule', label: 'None' },
   { value: 'arrow', icon: 'east', label: 'Arrow' },
   { value: 'triangle', icon: 'play_arrow', label: 'Triangle' },
   { value: 'dot', icon: 'circle', label: 'Dot' },
   { value: 'bar', icon: 'menu', label: 'Bar' },
];
