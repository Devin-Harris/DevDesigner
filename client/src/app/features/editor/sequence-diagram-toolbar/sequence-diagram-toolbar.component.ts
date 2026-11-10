import { IconComponent } from '../../../shared/ui/icon/icon.component';
import { InspectorPanelService } from '../inspector-panel.service';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ProjectStore } from '../../../stores/project.store';
import { ColorSwatchesComponent } from '../../../shared/ui/color-swatches/color-swatches.component';
import { PopoverTriggerDirective } from '../../../shared/ui/popover/popover-trigger.directive';

/**
 * On-canvas contextual bar that floats above the selected sequence diagram box:
 * background and border color. The parent positions the host via left/top bindings.
 */
@Component({
   selector: 'dd-sequence-diagram-toolbar',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [IconComponent, ColorSwatchesComponent, PopoverTriggerDirective],
   templateUrl: './sequence-diagram-toolbar.component.html',
   styleUrl: './sequence-diagram-toolbar.component.scss',
})
export class SequenceDiagramToolbarComponent {
   protected readonly inspector = inject(InspectorPanelService);
   protected readonly store = inject(ProjectStore);
   protected readonly diagram = computed(() => this.store.selectedDiagram());
   protected readonly canEdit = computed(() => this.store.canEdit());

   protected patch(patch: { backgroundColor?: string; borderColor?: string }): void {
      const d = this.diagram();
      if (d) void this.store.updateSequenceConfig(d.id, patch);
   }
}
