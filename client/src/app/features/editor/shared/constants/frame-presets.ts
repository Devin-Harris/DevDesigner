/**
 * Frame presets: a fixed aspect ratio (and a sensible default size) so every
 * exported page comes out the same shape. Sizes are in CSS px at 96dpi, so the
 * PDF export (1px = 0.75pt) lands on the real paper size for A4 and Letter.
 */
export interface FramePreset {
   id: string;
   label: string;
   /** Default size used for a click-only frame. */
   width: number;
   height: number;
   /** width / height to lock the draw gesture to; null = free-form. */
   ratio: number | null;
}

export const FRAME_PRESETS: readonly FramePreset[] = [
   { id: 'a4-landscape', label: 'A4 landscape', width: 1123, height: 794, ratio: 1123 / 794 },
   { id: 'a4-portrait', label: 'A4 portrait', width: 794, height: 1123, ratio: 794 / 1123 },
   { id: 'letter-landscape', label: 'Letter landscape', width: 1056, height: 816, ratio: 1056 / 816 },
   { id: 'letter-portrait', label: 'Letter portrait', width: 816, height: 1056, ratio: 816 / 1056 },
   { id: '16-9', label: 'Wide 16:9', width: 1280, height: 720, ratio: 16 / 9 },
   { id: '4-3', label: 'Standard 4:3', width: 1024, height: 768, ratio: 4 / 3 },
   { id: '1-1', label: 'Square 1:1', width: 800, height: 800, ratio: 1 },
   { id: 'free', label: 'Free-form', width: 800, height: 600, ratio: null },
];

export const DEFAULT_FRAME_PRESET = 'a4-landscape';

export function framePreset(id: string): FramePreset {
   return FRAME_PRESETS.find((p) => p.id === id) ?? FRAME_PRESETS[0];
}
