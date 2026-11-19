import { InspectorPanelService } from '../../../../services/inspector-panel.service';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { themeColorCss, type SequenceMessageModel } from '@devdesigner/shared';
import { SequenceEdits } from '../../services/sequence-edits.service';
import { IconComponent } from '../../../../../../shared/ui/components/icon/icon.component';
import { ColorSwatchesComponent } from '../../../../../../shared/ui/components/color-swatches/color-swatches.component';
import { PopoverTriggerDirective } from '../../../../../../shared/ui/directives/popover-trigger.directive';

/**
 * On-canvas contextual bar that floats above the selected sequence message
 * (matching the mock): style toggle (Sync / Return / Break), flip direction,
 * edit label, and delete. The parent positions the host via left/top bindings.
 */
@Component({
   selector: 'dd-sequence-message-toolbar',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [IconComponent, ColorSwatchesComponent, PopoverTriggerDirective],
   templateUrl: './sequence-message-toolbar.component.html',
   styleUrl: './sequence-message-toolbar.component.scss',
})
export class SequenceMessageToolbarComponent {
   protected readonly inspector = inject(InspectorPanelService);
   protected readonly edits = inject(SequenceEdits);
   protected readonly message = computed(() => this.edits.selectedMessage());
   protected readonly canEdit = computed(() => this.edits.canEdit());
   protected readonly css = themeColorCss;

   protected setColor(color: string): void {
      const m = this.message();
      if (m) void this.edits.updateMessage(m.id, { color });
   }

   protected setStyle(style: SequenceMessageModel['style']): void {
      const m = this.message();
      if (m) void this.edits.updateMessage(m.id, { style });
   }
   protected flip(): void {
      const m = this.message();
      if (m) {
         void this.edits.updateMessage(m.id, {
            direction: m.direction === 'forward' ? 'reverse' : 'forward',
         });
      }
   }
   protected toggleWrap(): void {
      const m = this.message();
      if (m) void this.edits.updateMessage(m.id, { wrap: m.wrap === false });
   }
   protected edit(): void {
      const m = this.message();
      if (m) this.edits.requestMessageEdit(m.id);
   }
   protected remove(): void {
      const m = this.message();
      if (m) void this.edits.deleteMessage(m.id);
   }
}
