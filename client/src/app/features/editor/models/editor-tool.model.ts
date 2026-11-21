/** The active canvas tool: 'select', the 'hand' pan tool, the ERD 'table', plus one per drawable element kind. */
export type EditorTool =
   | 'select'
   | 'hand'
   | 'table'
   | 'sequence'
   | 'rectangle'
   | 'ellipse'
   | 'diamond'
   | 'triangle'
   | 'arrow'
   | 'line'
   | 'text'
   | 'freedraw'
   | 'frame'
   | 'slide'
   | 'code'
   | 'grid'
   /** A live frame (sandboxed iframe of a URL). */
   | 'embed'
   | 'laser';
