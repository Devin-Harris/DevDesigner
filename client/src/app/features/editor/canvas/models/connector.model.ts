import type { Point, Side } from './geometry.model';

/** A draggable straight segment of a connector route (midpoint + orientation). */
export interface RouteSegment {
  index: number;
  mid: Point;
  orient: 'h' | 'v';
}

/** Render data for one relationship connector plus its endpoint anchors. */
export interface Connector {
  id: string;
  /** SVG path data for the rounded elbow line. */
  d: string;
  /** Source anchor. */
  ax: number;
  ay: number;
  /** Target anchor. */
  bx: number;
  by: number;
  /** Midpoint of the middle segment, used to position the inline relationship UI. */
  mx: number;
  my: number;
  markerStart: string;
  markerEnd: string;
  selected: boolean;
  /** Orthogonal route corners (incl. endpoints), for segment-drag editing. */
  routePoints: Point[];
  /** Draggable segments between consecutive route points. */
  segments: RouteSegment[];
  /** Sides the line attaches to (pinned when manual, router-chosen when auto). */
  sourceSide: Side;
  targetSide: Side;
  /** Best-path routing on (false = manual, pinned sides). */
  autoRoute: boolean;
}
