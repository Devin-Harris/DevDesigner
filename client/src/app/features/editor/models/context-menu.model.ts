/** One row of the canvas context menu: an action, a divider or a small section heading. */
export type ContextMenuEntry =
   | {
        label: string;
        icon?: string;
        /** Shortcut hint shown on the right. */
        kbd?: string;
        /** A toggle's current state (shows a check). */
        on?: boolean;
        danger?: boolean;
        run: () => void;
     }
   | { sep: true }
   | { heading: string };

/** An open context menu at a screen point. */
export interface CanvasContextMenu {
   x: number;
   y: number;
   title?: string;
   items: ContextMenuEntry[];
}
