/**
 * Upper bounds for arrays in request bodies (security M-5). better-sqlite3 is
 * synchronous, so an unbounded list turns into an unbounded stall of the event
 * loop. The caps sit well above anything the editor or the MCP sends for a real
 * project; they only stop abuse.
 */

/** Ids are UUIDs (36 chars); a little headroom for hand-made import ids. */
export const MAX_ID_LENGTH = 64;
/** Element ids in one reorder (the client and MCP send the whole project's list). */
export const MAX_REORDER_ELEMENTS = 20_000;
/** Column ids in one table's reorder. */
export const MAX_TABLE_COLUMNS = 1_000;
/** Index ids in one table's reorder. */
export const MAX_TABLE_INDEXES = 500;
/** Columns covered by a single index. */
export const MAX_INDEX_COLUMNS = 100;
/** Points of one line / arrow / freehand stroke. */
export const MAX_ELEMENT_POINTS = 20_000;
/** Manual waypoints of one relationship connector. */
export const MAX_WAYPOINTS = 1_000;
/** Data-type arguments (DECIMAL(10,2), ENUM('a','b',...)). */
export const MAX_TYPE_ARGS = 500;
/** One data-type argument (an ENUM value, a length). */
export const MAX_TYPE_ARG_LENGTH = 255;
