/** Geometry of the slide list / settings panels drawn beside a deck's shown slide (world units). */
/** Panels hug the frame: this is the gap to its edge, and the outline's padding. */
export const PANEL_GAP = 8;
export const PANEL_PAD = 6;
/** Smallest outline padding on screen, so the dashed border clears the panels at any zoom. */
export const PANEL_MIN_PAD_PX = 2;
/** The panels' own corner radius (world units); the outline's is concentric with it. */
export const PANEL_RADIUS = 14;
export const PANEL_LIST_W = 296;
export const PANEL_SETTINGS_W = 400;
export const PANEL_FOLDED_W = 44;
/** As tall as the frame on screen, but never so short that the panel stops being usable. */
export const PANEL_MIN_H = 320;
