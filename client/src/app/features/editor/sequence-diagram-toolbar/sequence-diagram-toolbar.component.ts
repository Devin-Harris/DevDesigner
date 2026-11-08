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
  selector: 'app-sequence-diagram-toolbar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, ColorSwatchesComponent, PopoverTriggerDirective],
  template: `
    @if (diagram(); as d) {
      <button
        type="button"
        class="ico-act"
        [dbdPopoverTrigger]="bgMenu"
        placement="below-start"
        [disabled]="!canEdit()"
        title="Background"
        aria-label="Background"
      >
        <span
          class="color-dot"
          [class.none]="d.backgroundColor === 'transparent'"
          [style.background]="d.backgroundColor && d.backgroundColor !== 'transparent' ? d.backgroundColor : 'var(--dbd-surface)'"
        ></span>
      </button>
      <ng-template #bgMenu let-close>
        <div class="color-grid">
          <div class="grid-label">Background</div>
          <dbd-color-swatches
            [value]="d.backgroundColor"
            noneValue="transparent"
            noneLabel="No background"
            themeValue=""
            (pick)="patch({ backgroundColor: $event }); close()"
          />
        </div>
      </ng-template>

      <button
        type="button"
        class="ico-act"
        [dbdPopoverTrigger]="borderMenu"
        placement="below-start"
        [disabled]="!canEdit()"
        title="Border"
        aria-label="Border"
      >
        <span
          class="color-dot ring"
          [class.none]="d.borderColor === 'transparent'"
          [style.border-color]="d.borderColor && d.borderColor !== 'transparent' ? d.borderColor : 'var(--dbd-border-strong)'"
        ></span>
      </button>
      <ng-template #borderMenu let-close>
        <div class="color-grid">
          <div class="grid-label">Border</div>
          <dbd-color-swatches
            [value]="d.borderColor"
            noneValue="transparent"
            noneLabel="No border"
            themeValue=""
            (pick)="patch({ borderColor: $event }); close()"
          />
        </div>
      </ng-template>
      <button type="button" class="ico-act details" [class.on]="inspector.shown()" (click)="inspector.toggle()" title="Details" aria-label="Details">
        <dbd-icon name="tune" />
      </button>
    }
  `,
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
