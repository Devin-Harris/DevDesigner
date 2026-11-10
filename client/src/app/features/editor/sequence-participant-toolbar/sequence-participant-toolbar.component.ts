import { InspectorPanelService } from '../inspector-panel.service';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { themeColorCss } from '@devdesigner/shared';
import { ProjectStore } from '../../../stores/project.store';
import { IconComponent } from '../../../shared/ui/components/icon/icon.component';
import { ColorSwatchesComponent } from '../../../shared/ui/components/color-swatches/color-swatches.component';
import { PopoverTriggerDirective } from '../../../shared/ui/directives/popover-trigger.directive';

/**
 * On-canvas contextual bar that floats above the selected sequence participant
 * (lifeline), matching the message toolbar: a header-color popover, inline
 * rename, and delete. The parent positions the host via left/top bindings.
 */
@Component({
   selector: 'dd-sequence-participant-toolbar',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [ColorSwatchesComponent, IconComponent, PopoverTriggerDirective],
   templateUrl: './sequence-participant-toolbar.component.html',
   styleUrl: './sequence-participant-toolbar.component.scss',
})
export class SequenceParticipantToolbarComponent {
   protected readonly inspector = inject(InspectorPanelService);
   protected readonly store = inject(ProjectStore);
   protected readonly lifeline = computed(() => this.store.selectedLifeline());
   protected readonly canEdit = computed(() => this.store.canEdit());
   protected readonly css = themeColorCss;

   protected setColor(color: string): void {
      const l = this.lifeline();
      if (l) void this.store.updateLifeline(l.id, { color });
   }
   protected setStroke(strokeColor: string): void {
      const l = this.lifeline();
      if (l) void this.store.updateLifeline(l.id, { strokeColor });
   }
   protected setText(textColor: string): void {
      const l = this.lifeline();
      if (l) void this.store.updateLifeline(l.id, { textColor });
   }
   protected edit(): void {
      const l = this.lifeline();
      if (l) this.store.requestLifelineEdit(l.id);
   }
   protected remove(): void {
      const l = this.lifeline();
      if (l) void this.store.deleteLifeline(l.id);
   }
}
