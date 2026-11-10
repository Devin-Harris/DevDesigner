import { IconComponent } from '../../../../../../shared/ui/components/icon/icon.component';
import { InspectorPanelService } from '../../../../services/inspector-panel.service';
import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import type { SequenceDiagramModel } from '@devdesigner/shared';
import { ColorSwatchesComponent } from '../../../../../../shared/ui/components/color-swatches/color-swatches.component';
import { PopoverTriggerDirective } from '../../../../../../shared/ui/directives/popover-trigger.directive';

export interface SequenceDiagramColors {
   backgroundColor?: string;
   borderColor?: string;
}

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
   /** The selected diagram (the bar renders nothing without one). */
   readonly diagram = input<SequenceDiagramModel | null>(null);
   readonly canEdit = input(false);
   /** A color was picked for the diagram; the host persists it. */
   readonly diagramPatch = output<{ id: string; patch: SequenceDiagramColors }>();

   protected patch(patch: SequenceDiagramColors): void {
      const d = this.diagram();
      if (d) this.diagramPatch.emit({ id: d.id, patch });
   }
}
