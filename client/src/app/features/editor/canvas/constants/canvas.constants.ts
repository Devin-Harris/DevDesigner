/**
 * Fixed canvas + connector geometry constants. Kept free of any logic so both
 * the render layer and the routing helpers share one source of truth.
 */

// Table node metrics. Connector anchors are derived from these, so the numbers
// must match the rendered header/row heights exactly.
// NODE_WIDTH is the default and minimum width; a node grows past it to fit long
// column/table names (see tableWidth), up to the MAX_NAME_CHARS cap.
export const NODE_WIDTH = 280;
export const HEADER_H = 40;
export const ROW_H = 34;

// Dynamic-width estimation. A node widens so its longest name shows in full, up
// to a name of MAX_NAME_CHARS; longer names ellipsize. The reserved widths below
// approximate the non-name controls in a row / header, kept a touch generous so
// names are never clipped early. The renderer and the geometry share tableWidth,
// so connector anchors always line up with the rendered edge regardless.
export const MAX_NAME_CHARS = 50;
export const NAME_CHAR_W = 8;
export const HEADER_CHAR_W = 8.5;
export const ROW_FIXED_W = 220;
export const VARCHAR_FIXED_W = 50;
export const HEADER_FIXED_W = 92;

// Viewport / world.
export const SVG_OFFSET = 5000;
export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 3;
export const GRID_SIZE = 24;

// Connector exit.
/** Ideal horizontal run out of a node before the line may turn (two grid spaces). */
export const EXIT_STUB = 2 * GRID_SIZE;
/**
 * Shortest allowed exit run. Facing anchors that sit closer than 2 * EXIT_STUB
 * clamp their stub toward half the gap so the line never overshoots past its
 * target and loops back. Keeps a small horizontal jog instead of a vertical drop.
 */
export const MIN_STUB = 10;

// Obstacle avoidance.
/** Clearance kept between a connector and any table it routes around. */
export const OBSTACLE_GAP = 16;
/**
 * A table only counts as an obstacle for a connector when its box lies within
 * this margin of the connector's endpoint bounding box. This keeps routing local
 * (fast, and it stops a far-away table from bending a line across the canvas).
 */
export const OBSTACLE_SEARCH_MARGIN = 140;

// Rendering.
/** Gap between a node edge and where its connector line starts (marker room). */
export const ANCHOR_GAP = 8;
/** Corner rounding radius for elbow paths. */
export const CORNER_RADIUS = 10;

// Routing search tunables.
/** Extra A* cost per 90-degree turn, so clean elbows beat zig-zags of equal length. */
export const BEND_PENALTY = 60;
