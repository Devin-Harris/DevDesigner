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
   selector: 'dd-shortcuts-sheet',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [IconComponent],
   templateUrl: './shortcuts-sheet.component.html',
   styleUrl: './shortcuts-sheet.component.scss',
})
export class ShortcutsSheetComponent {
   readonly closed = output<void>();
   protected readonly groups = GROUPS;

   @HostListener('document:keydown.escape')
   protected onEsc(): void {
      this.closed.emit();
   }
}
