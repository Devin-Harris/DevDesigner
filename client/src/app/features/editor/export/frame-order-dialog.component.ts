import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { IconComponent } from '../../../shared/ui/icon/icon.component';

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
   template: `
      <h2 mat-dialog-title class="dlg-title">Arrange PDF pages</h2>
      <mat-dialog-content class="dlg-body">
         <p class="hint">Page 1 is at the top. Drag a row or use the arrows.</p>
         <ol class="pages">
            @for (f of items(); track f.id; let i = $index) {
               <li
                  class="page"
                  [class.over]="overIndex() === i"
                  draggable="true"
                  (dragstart)="dragFrom = i"
                  (dragover)="$event.preventDefault(); overIndex.set(i)"
                  (dragleave)="overIndex.set(null)"
                  (drop)="drop(i)"
                  (dragend)="overIndex.set(null)"
               >
                  <dd-icon name="drag_indicator" class="grip" />
                  <span class="num">{{ i + 1 }}</span>
                  <span class="name">{{ f.name }}</span>
                  <span class="size">{{ f.width }} × {{ f.height }}</span>
                  <button class="mv" [disabled]="i === 0" (click)="move(i, -1)" aria-label="Move up">
                     <dd-icon name="arrow_upward" />
                  </button>
                  <button class="mv" [disabled]="i === items().length - 1" (click)="move(i, 1)" aria-label="Move down">
                     <dd-icon name="arrow_downward" />
                  </button>
               </li>
            }
         </ol>
      </mat-dialog-content>
      <mat-dialog-actions class="dlg-actions">
         <button class="btn" mat-dialog-close>Cancel</button>
         <button class="btn primary" (click)="confirm()"><dd-icon name="picture_as_pdf" />Export PDF</button>
      </mat-dialog-actions>
   `,
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
