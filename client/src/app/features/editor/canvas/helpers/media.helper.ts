import type { MediaConfig } from '@devdesigner/shared';

/** A rectangle in world coordinates. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The smallest crop side (as a fraction of the source) a drag can make. */
const MIN_CROP = 0.01;

/**
 * Where an image element's whole source picture lands, given its box and crop: the
 * box shows the `crop` part of the source, so the source is the box scaled up by
 * 1/crop and shifted back by the crop offset. Uncropped = the box itself.
 */
export function mediaSourceRect(box: Rect, crop: MediaConfig['crop']): Rect {
  if (!crop) {
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  }
  const width = box.width / crop.width;
  const height = box.height / crop.height;
  return { x: box.x - crop.x * width, y: box.y - crop.y * height, width, height };
}

/** The crop that shows the part of `source` (where the whole picture lands) under `box`. */
export function cropFor(box: Rect, source: Rect): NonNullable<MediaConfig['crop']> {
  return {
    x: (box.x - source.x) / source.width,
    y: (box.y - source.y) / source.height,
    width: Math.max(MIN_CROP, box.width / source.width),
    height: Math.max(MIN_CROP, box.height / source.height),
  };
}

/** True when a crop shows the whole source (so it can be dropped). */
export function isFullCrop(crop: MediaConfig['crop']): boolean {
  const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-4;
  return !crop || (near(crop.x, 0) && near(crop.y, 0) && near(crop.width, 1) && near(crop.height, 1));
}
