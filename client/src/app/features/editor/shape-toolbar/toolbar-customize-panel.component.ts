import { ChangeDetectionStrategy, Component, HostListener, inject, signal } from '@angular/core';
import { IconComponent } from '../../../shared/ui/icon/icon.component';
import { DockPosition, DockPreset, DockToolId, ToolbarPrefsService } from './toolbar-prefs.service';

/**
 * Customize toolbar panel: presets, drag-to-reorder tool list, a drop zone that
 * hides tools, dock position and dock behaviour. Opened from the dock's "…"
 * button or the main menu; everything saves as it changes.
 */
@Component({
   selector: 'dd-toolbar-customize-panel',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [IconComponent],
   template: `
      <div class="scrim" (pointerdown)="close()"></div>
      <div class="panel" role="dialog" aria-label="Customize toolbar" (pointerdown)="$event.stopPropagation()">
         <div class="head">
            <span class="title">Customize toolbar</span>
            <label class="preset">
               <span class="sr">Preset</span>
               <select [value]="prefs.activePreset() ?? ''" (change)="pickPreset($any($event.target).value)">
                  @if (!prefs.activePreset()) {
                     <option value="">Custom</option>
                  }
                  @for (p of prefs.presets; track p.id) {
                     <option [value]="p.id">{{ p.label }}</option>
                  }
               </select>
            </label>
            <button class="x" (click)="close()" aria-label="Close"><dd-icon name="close" /></button>
         </div>

         <div class="body">
            <div class="col">
               <div class="lab">In toolbar · drag to reorder</div>
               <div class="list" (dragover)="allowDrop($event)" (drop)="dropShown($event, null)">
                  <div class="row fixed">
                     <span class="grip"></span><span class="name">Select</span><span class="k">V</span
                     ><span class="fx">fixed</span>
                  </div>
                  @for (t of shown(); track t.id) {
                     <div
                        class="row"
                        draggable="true"
                        [class.over]="overId() === t.id"
                        (dragstart)="dragStart($event, t.id)"
                        (dragend)="dragId = null; overId.set(null)"
                        (dragover)="allowDrop($event); overId.set(t.id)"
                        (dragleave)="overId.set(null)"
                        (drop)="dropShown($event, t.id)"
                     >
                        <span class="grip">⋮⋮</span>
                        <span class="name"
                           >{{ t.label }}
                           @if (t.note) {
                              <small> · {{ t.note }}</small>
                           }
                        </span>
                        <span class="k">{{ t.key || '—' }}</span>
                        <button
                           class="hide"
                           (click)="prefs.setVisible(t.id, false)"
                           [attr.aria-label]="'Hide ' + t.label"
                        >
                           <dd-icon name="visibility_off" />
                        </button>
                     </div>
                  }
               </div>

               <div class="lab">Hidden · still in “More” at the end of the bar, and keys still work</div>
               <div
                  class="list hidden-zone"
                  [class.over]="overHidden()"
                  (dragover)="allowDrop($event); overHidden.set(true)"
                  (dragleave)="overHidden.set(false)"
                  (drop)="dropHidden($event)"
               >
                  @for (t of hiddenList(); track t.id) {
                     <div class="row" draggable="true" (dragstart)="dragStart($event, t.id)" (dragend)="dragId = null">
                        <span class="grip">⋮⋮</span>
                        <span class="name">{{ t.label }}</span>
                        <span class="k">{{ t.key || '—' }}</span>
                        <button class="show" (click)="prefs.setVisible(t.id, true)">Show</button>
                     </div>
                  } @empty {
                     <div class="empty">Drag a tool here to hide it</div>
                  }
               </div>
            </div>

            <div class="col side">
               <div class="lab">Toolbar position</div>
               <div class="seg">
                  @for (p of positions; track p.id) {
                     <button [class.on]="prefs.position() === p.id" (click)="prefs.setPosition(p.id)">
                        {{ p.label }}
                     </button>
                  }
               </div>

               <div class="lab">Behaviour</div>
               <label class="tog"
                  ><input
                     type="checkbox"
                     [checked]="prefs.labels()"
                     (change)="prefs.setFlag('labels', $any($event.target).checked)"
                  />Labels under icons</label
               >
               <label class="tog"
                  ><input
                     type="checkbox"
                     [checked]="prefs.compact()"
                     (change)="prefs.setFlag('compact', $any($event.target).checked)"
                  />Compact buttons (32 px)</label
               >
               <label class="tog"
                  ><input
                     type="checkbox"
                     [checked]="prefs.twoColumns()"
                     [disabled]="prefs.position() === 'top' || prefs.position() === 'bottom'"
                     (change)="prefs.setFlag('twoColumns', $any($event.target).checked)"
                  />Two columns (side dock)</label
               >
               <label class="tog"
                  ><input
                     type="checkbox"
                     [checked]="prefs.stayOnTool()"
                     (change)="prefs.setFlag('stayOnTool', $any($event.target).checked)"
                  />Stay on tool after placing (else back to Select)</label
               >
               <label class="tog"
                  ><input
                     type="checkbox"
                     [checked]="prefs.fadeWhileDragging()"
                     (change)="prefs.setFlag('fadeWhileDragging', $any($event.target).checked)"
                  />Fade islands while dragging or drawing</label
               >

               <p class="note">Saved in this browser, so it applies to every project.</p>
            </div>
         </div>

         <div class="foot">
            <button class="ghost" (click)="prefs.reset()">Reset to default</button>
            <button class="primary" (click)="close()">Done</button>
         </div>
      </div>
   `,
   styles: `
      :host {
         position: fixed;
         inset: 0;
         z-index: 1000;
         pointer-events: auto;
      }
      .scrim {
         position: absolute;
         inset: 0;
         background: rgba(10, 12, 18, 0.35);
      }
      .panel {
         position: absolute;
         top: 50%;
         left: 50%;
         transform: translate(-50%, -50%);
         width: min(760px, calc(100vw - 32px));
         max-height: calc(100vh - 48px);
         display: flex;
         flex-direction: column;
         background: var(--dd-surface);
         color: var(--dd-text);
         border: 1px solid var(--dd-border);
         border-radius: 14px;
         box-shadow: 0 24px 60px -12px rgba(0, 0, 0, 0.45);
         font-size: 13px;
         overflow: hidden;
      }
      .head {
         display: flex;
         align-items: center;
         gap: 10px;
         padding: 12px 14px;
         border-bottom: 1px solid var(--dd-border);
      }
      .title {
         font-weight: 600;
         font-size: 15px;
      }
      .preset {
         margin-left: auto;
      }
      .preset select {
         height: 30px;
         padding: 0 8px;
         border-radius: 7px;
         border: 1px solid var(--dd-border);
         background: var(--dd-surface);
         color: var(--dd-text);
         font: inherit;
      }
      .sr {
         position: absolute;
         width: 1px;
         height: 1px;
         overflow: hidden;
         clip: rect(0 0 0 0);
      }
      .x,
      .hide {
         width: 30px;
         height: 30px;
         border: none;
         border-radius: 7px;
         background: transparent;
         color: var(--dd-text-muted);
         display: inline-flex;
         align-items: center;
         justify-content: center;
         cursor: pointer;
         --dd-icon-size: 16px;
      }
      .x:hover,
      .hide:hover {
         background: var(--dd-surface-2);
         color: var(--dd-text);
      }
      .body {
         display: grid;
         grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
         gap: 18px;
         padding: 14px;
         overflow-y: auto;
      }
      @media (max-width: 640px) {
         .body {
            grid-template-columns: 1fr;
         }
      }
      .col {
         display: flex;
         flex-direction: column;
         gap: 6px;
         min-width: 0;
      }
      .lab {
         font-size: 11px;
         font-weight: 600;
         letter-spacing: 0.05em;
         text-transform: uppercase;
         color: var(--dd-text-muted);
         margin-top: 6px;
      }
      .list {
         display: flex;
         flex-direction: column;
         gap: 2px;
         border: 1px solid var(--dd-border);
         border-radius: 10px;
         padding: 4px;
      }
      .row {
         display: grid;
         grid-template-columns: 18px minmax(0, 1fr) auto 32px;
         align-items: center;
         gap: 8px;
         min-height: 32px;
         padding: 0 4px 0 6px;
         border-radius: 7px;
         cursor: grab;
      }
      .row:hover {
         background: var(--dd-surface-2);
      }
      .row.over {
         box-shadow: inset 0 2px 0 var(--dd-primary);
      }
      .row.fixed {
         cursor: default;
      }
      .grip {
         color: var(--dd-text-muted);
         font-size: 11px;
         letter-spacing: -2px;
      }
      .name {
         overflow: hidden;
         text-overflow: ellipsis;
         white-space: nowrap;
      }
      .name small {
         color: var(--dd-text-muted);
      }
      .k {
         font-family: var(--dd-mono, monospace);
         font-size: 11px;
         color: var(--dd-text-muted);
         background: var(--dd-surface-2);
         border: 1px solid var(--dd-border);
         padding: 1px 5px;
         border-radius: 4px;
         white-space: nowrap;
      }
      .fx {
         font-size: 11px;
         color: var(--dd-text-muted);
      }
      .hidden-zone {
         min-height: 44px;
         border-style: dashed;
      }
      .hidden-zone.over {
         border-color: var(--dd-primary);
         background: var(--dd-primary-weak);
      }
      .empty {
         padding: 10px;
         color: var(--dd-text-muted);
         text-align: center;
      }
      .show {
         height: 26px;
         border: none;
         border-radius: 6px;
         background: transparent;
         color: var(--dd-primary);
         font: inherit;
         font-size: 12px;
         cursor: pointer;
      }
      .seg {
         display: flex;
         gap: 2px;
         padding: 3px;
         border-radius: 8px;
         background: var(--dd-surface-2);
      }
      .seg button {
         flex: 1;
         height: 28px;
         border: none;
         border-radius: 6px;
         background: transparent;
         color: var(--dd-text-muted);
         font: inherit;
         font-size: 12px;
         cursor: pointer;
      }
      .seg button.on {
         background: var(--dd-surface);
         color: var(--dd-text);
         font-weight: 600;
         box-shadow: var(--dd-shadow-1);
      }
      .tog {
         display: flex;
         align-items: center;
         gap: 8px;
         min-height: 30px;
         cursor: pointer;
      }
      .tog input {
         accent-color: var(--dd-primary);
         width: 16px;
         height: 16px;
      }
      .note {
         margin: 8px 0 0;
         font-size: 12px;
         color: var(--dd-text-muted);
      }
      .foot {
         display: flex;
         justify-content: space-between;
         padding: 10px 14px;
         border-top: 1px solid var(--dd-border);
      }
      .ghost,
      .primary {
         height: 32px;
         padding: 0 14px;
         border-radius: 8px;
         font: inherit;
         font-weight: 500;
         cursor: pointer;
      }
      .ghost {
         border: 1px solid var(--dd-border);
         background: transparent;
         color: var(--dd-text);
      }
      .primary {
         border: none;
         background: var(--dd-primary);
         color: #fff;
         font-weight: 600;
      }
   `,
})
export class ToolbarCustomizePanelComponent {
   protected readonly prefs = inject(ToolbarPrefsService);

   protected readonly positions: { id: DockPosition; label: string }[] = [
      { id: 'left', label: 'Left' },
      { id: 'top', label: 'Top' },
      { id: 'bottom', label: 'Bottom' },
      { id: 'right', label: 'Right' },
   ];

   protected readonly shown = () => this.prefs.allTools().filter((t) => t.visible);
   protected readonly hiddenList = () => this.prefs.hiddenTools();

   protected dragId: DockToolId | null = null;
   protected readonly overId = signal<DockToolId | null>(null);
   protected readonly overHidden = signal(false);

   @HostListener('document:keydown.escape')
   protected close(): void {
      this.prefs.panelOpen.set(false);
   }

   protected pickPreset(id: string): void {
      if (id) this.prefs.applyPreset(id as DockPreset);
   }

   protected dragStart(event: DragEvent, id: DockToolId): void {
      this.dragId = id;
      event.dataTransfer?.setData('text/plain', id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
   }

   protected allowDrop(event: DragEvent): void {
      if (this.dragId) event.preventDefault();
   }

   protected dropShown(event: DragEvent, before: DockToolId | null): void {
      event.preventDefault();
      event.stopPropagation();
      const id = this.dragId;
      this.dragId = null;
      this.overId.set(null);
      if (!id) return;
      this.prefs.setVisible(id, true);
      this.prefs.moveBefore(id, before);
   }

   protected dropHidden(event: DragEvent): void {
      event.preventDefault();
      const id = this.dragId;
      this.dragId = null;
      this.overHidden.set(false);
      if (id) this.prefs.setVisible(id, false);
   }
}
