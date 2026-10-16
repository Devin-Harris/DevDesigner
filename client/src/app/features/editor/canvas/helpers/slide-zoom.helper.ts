import type { Box } from '../models/geometry.model';

/**
 * Slide zoom: a presentation's shown slide can be zoomed out inside its block (the
 * frame's spot on the canvas, which never changes size). The slide's frame and items
 * are drawn scaled by `scale` about the frame's centre, so the room around the frame
 * (where items are staged for morph entrances/exits) shows inside the block.
 *
 * Two coordinate spaces meet here: "inner" is where the slide's items really are (their
 * stored coordinates); "outer" is where they appear on the canvas. Everything maps
 * through `toOuter` / `toInner`, which are identity at scale 1.
 */

/** Furthest a slide can be zoomed out (shows 4x the frame across). */
export const MIN_SLIDE_ZOOM = 0.25;

export interface SlideView {
  /** The slide frame (id) and its presentation. */
  frameId: string;
  presentation: string;
  /** The block: the frame's own box on the canvas (outer space, fixed). */
  block: Box;
  cx: number;
  cy: number;
  scale: number;
}

interface FrameBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What a slide shows at `scale`, in inner coordinates (the frame's box at scale 1). */
export function slideViewRegion(frame: FrameBox, scale: number): Box {
  const cx = frame.x + frame.width / 2;
  const cy = frame.y + frame.height / 2;
  const hw = frame.width / 2 / scale;
  const hh = frame.height / 2 / scale;
  return { x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh };
}

export function slideView(
  frame: FrameBox & { id: string },
  presentation: string,
  scale: number,
): SlideView {
  return {
    frameId: frame.id,
    presentation,
    block: { x0: frame.x, y0: frame.y, x1: frame.x + frame.width, y1: frame.y + frame.height },
    cx: frame.x + frame.width / 2,
    cy: frame.y + frame.height / 2,
    scale,
  };
}

/** Where an inner point (stored coordinates) appears on the canvas. */
export function toOuter(v: SlideView, p: { x: number; y: number }): { x: number; y: number } {
  return { x: v.cx + (p.x - v.cx) * v.scale, y: v.cy + (p.y - v.cy) * v.scale };
}

/** The inner point (stored coordinates) drawn at canvas point `p`. */
export function toInner(v: SlideView, p: { x: number; y: number }): { x: number; y: number } {
  return { x: v.cx + (p.x - v.cx) / v.scale, y: v.cy + (p.y - v.cy) / v.scale };
}

/** A box in inner coordinates as it appears on the canvas. */
export function boxToOuter(v: SlideView, b: Box): Box {
  const a = toOuter(v, { x: b.x0, y: b.y0 });
  const c = toOuter(v, { x: b.x1, y: b.y1 });
  return { x0: a.x, y0: a.y, x1: c.x, y1: c.y };
}

export function inBlock(v: SlideView, p: { x: number; y: number }): boolean {
  return p.x >= v.block.x0 && p.x <= v.block.x1 && p.y >= v.block.y0 && p.y <= v.block.y1;
}

/**
 * CSS transform for the layer that draws a slide's items, placed at the block's
 * top-left with `transform-origin: 0 0`: inner coordinates -> block-local px.
 */
export function slideViewTransform(v: SlideView): string {
  const tx = v.cx - v.block.x0;
  const ty = v.cy - v.block.y0;
  return `translate(${tx}px, ${ty}px) scale(${v.scale}) translate(${-v.cx}px, ${-v.cy}px)`;
}
