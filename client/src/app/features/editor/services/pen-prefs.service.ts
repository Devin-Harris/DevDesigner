import { Injectable, signal } from '@angular/core';

/** Pen settings that apply only to the Draw tool. */
@Injectable({ providedIn: 'root' })
export class PenPrefsService {
   /** Strokes are drawn wide and half see-through, like a marker. */
   readonly highlighter$ = signal(false);
   /** Dragging erases the pen strokes it touches instead of drawing. */
   readonly eraser$ = signal(false);
   /** Eraser diameter in screen pixels. */
   readonly eraserSize$ = signal(24);
   /** Pen thickness, kept apart from the shapes' stroke width. */
   readonly width = signal(2);
}
