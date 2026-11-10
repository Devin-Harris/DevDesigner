/** What the current canvas pointer gesture is doing. */
export type DragMode =
   | 'idle'
   | 'pan'
   | 'node'
   | 'marquee'
   | 'draw'
   | 'element'
   | 'element-resize'
   | 'element-rotate'
   /** Resizing a multi-selection (elements + sequence diagrams) as one box. */
   | 'group-resize'
   /** Dragging a gap handle to respace an evenly spaced selection. */
   | 'spacing'
   | 'arrow-endpoint'
   | 'arrow-bend'
   /** Pen eraser: dragging removes the pen strokes it touches. */
   | 'erase'
   /** Alt-drag: waiting for the copies to be created before the drag can start. */
   | 'duplicating';
