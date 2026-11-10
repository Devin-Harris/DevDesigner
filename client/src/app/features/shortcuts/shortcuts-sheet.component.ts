import { ChangeDetectionStrategy, Component, HostListener, output } from '@angular/core';
import { IconComponent } from '../../shared/ui/icon/icon.component';

interface ShortcutGroup {
   name: string;
   items: [keys: string, label: string][];
}

const GROUPS: ShortcutGroup[] = [
   {
      name: 'Tools',
      items: [
         ['V', 'Select'],
         ['H', 'Hand / pan (or hold Space)'],
         ['R · O · D', 'Rectangle · ellipse · diamond (press again to cycle)'],
         ['A · L', 'Arrow · line'],
         ['P', 'Draw'],
         ['T', 'Text'],
         ['E', 'ERD table'],
         ['Q', 'Sequence diagram'],
         ['G', 'Grid table'],
         ['C', 'Code block'],
         ['F', 'Frame'],
         ['S', 'Presentation'],
         ['K', 'Laser pointer'],
      ],
   },
   {
      name: 'Edit',
      items: [
         ['Ctrl Z', 'Undo'],
         ['Ctrl Shift Z', 'Redo'],
         ['Ctrl C · Ctrl V', 'Copy · paste'],
         ['Delete', 'Delete selection'],
         ['Ctrl G', 'Group'],
         ['Ctrl Shift G', 'Ungroup'],
         ['Ctrl ] · Ctrl [', 'Bring forward · send backward'],
         ['Ctrl Shift ] · [', 'Bring to front · send to back'],
         ['Shift Alt F', 'Format code'],
      ],
   },
   {
      name: 'View',
      items: [
         ['Ctrl K', 'Projects & commands'],
         ['Shift 1', 'Zoom to fit'],
         ['Shift 2', 'Zoom to selection'],
         ['Home', 'Go to home view'],
         ['Ctrl scroll', 'Zoom'],
         ['Esc', 'Back to Select · leave focus mode'],
         ['?', 'This sheet'],
      ],
   },
   {
      name: 'Presenting',
      items: [
         ['Shift F', 'Focus the selected presentation · leave focus'],
         ['F5', 'Present from the start'],
         ['Shift F5', 'Present from this slide'],
         ['→ · Space', 'Next step or slide'],
         ['←', 'Previous'],
         ['G', 'All slides'],
         ['N', 'Speaker notes'],
         ['K', 'Laser pointer'],
         ['Esc', 'Stop presenting'],
      ],
   },
];

/** Keyboard shortcuts reference (? or main menu). */
@Component({
   selector: 'app-shortcuts-sheet',
   standalone: true,
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [IconComponent],
   template: `
      <div class="scrim" (pointerdown)="closed.emit()"></div>
      <div class="sheet" role="dialog" aria-label="Keyboard shortcuts">
         <div class="head">
            <span class="title">Keyboard shortcuts</span>
            <button class="x" (click)="closed.emit()" aria-label="Close"><dd-icon name="close" /></button>
         </div>
         <div class="cols">
            @for (g of groups; track g.name) {
               <section>
                  <h3>{{ g.name }}</h3>
                  @for (it of g.items; track it[1]) {
                     <div class="row">
                        <span class="lbl">{{ it[1] }}</span
                        ><span class="k">{{ it[0] }}</span>
                     </div>
                  }
               </section>
            }
         </div>
      </div>
   `,
   styles: `
      :host {
         position: fixed;
         inset: 0;
         z-index: 1000;
      }
      .scrim {
         position: absolute;
         inset: 0;
         background: rgba(10, 12, 18, 0.35);
      }
      .sheet {
         position: absolute;
         top: 50%;
         left: 50%;
         transform: translate(-50%, -50%);
         width: min(880px, calc(100vw - 32px));
         max-height: calc(100vh - 48px);
         overflow-y: auto;
         background: var(--dd-surface);
         color: var(--dd-text);
         border: 1px solid var(--dd-border);
         border-radius: 14px;
         box-shadow: 0 24px 60px -12px rgba(0, 0, 0, 0.45);
         font-size: 13px;
      }
      .head {
         display: flex;
         align-items: center;
         padding: 12px 14px;
         border-bottom: 1px solid var(--dd-border);
      }
      .title {
         font-weight: 600;
         font-size: 15px;
      }
      .x {
         margin-left: auto;
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
      }
      .x:hover {
         background: var(--dd-surface-2);
         color: var(--dd-text);
      }
      .cols {
         display: grid;
         grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
         gap: 8px 24px;
         padding: 14px 18px 18px;
      }
      h3 {
         margin: 6px 0 6px;
         font-size: 11px;
         font-weight: 600;
         letter-spacing: 0.05em;
         text-transform: uppercase;
         color: var(--dd-text-muted);
      }
      .row {
         display: flex;
         align-items: center;
         gap: 12px;
         min-height: 28px;
      }
      .lbl {
         min-width: 0;
      }
      .k {
         margin-left: auto;
         font-family: var(--dd-mono, monospace);
         font-size: 11px;
         color: var(--dd-text-muted);
         background: var(--dd-surface-2);
         border: 1px solid var(--dd-border);
         padding: 1px 6px;
         border-radius: 4px;
         white-space: nowrap;
      }
   `,
})
export class ShortcutsSheetComponent {
   readonly closed = output<void>();
   protected readonly groups = GROUPS;

   @HostListener('document:keydown.escape')
   protected onEsc(): void {
      this.closed.emit();
   }
}
