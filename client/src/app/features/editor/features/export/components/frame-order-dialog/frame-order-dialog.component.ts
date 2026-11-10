import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { IconComponent } from '../../../../../../shared/ui/components/icon/icon.component';

export interface FrameOrderItem {
   id: string;
   name: string;
   width: number;
   height: number;
}

export interface FrameOrderDialogData {
   frames: FrameOrderItem[];
}

/**
 * Lets the user arrange the page order of a multi-frame PDF before exporting.
 * Rows reorder with the arrow buttons or by dragging; closes with the ordered
 * frame ids, or undefined if cancelled.
 */
@Component({
   selector: 'dd-frame-order-dialog',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [MatDialogModule, IconComponent],
   templateUrl: './frame-order-dialog.component.html',
   styleUrl: './frame-order-dialog.component.scss',
})
export class FrameOrderDialogComponent {
   private readonly ref = inject<MatDialogRef<FrameOrderDialogComponent, string[]>>(MatDialogRef);
   private readonly data = inject<FrameOrderDialogData>(MAT_DIALOG_DATA);

   protected readonly items = signal<FrameOrderItem[]>([...this.data.frames]);
   protected readonly overIndex = signal<number | null>(null);
   protected dragFrom: number | null = null;

   protected move(index: number, by: -1 | 1): void {
      this.reorder(index, index + by);
   }

   protected drop(to: number): void {
      const from = this.dragFrom;
      this.dragFrom = null;
      this.overIndex.set(null);
      if (from !== null) {
         this.reorder(from, to);
      }
   }

   private reorder(from: number, to: number): void {
      const list = [...this.items()];
      if (to < 0 || to >= list.length || from === to) {
         return;
      }
      const [moved] = list.splice(from, 1);
      list.splice(to, 0, moved);
      this.items.set(list);
   }

   protected confirm(): void {
      this.ref.close(this.items().map((f) => f.id));
   }
}
