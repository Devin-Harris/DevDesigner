import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ProjectStore } from '../../../stores/project.store';
import { IconComponent } from '../../../shared/ui/icon/icon.component';
import { PopoverTriggerDirective } from '../../../shared/ui/popover/popover-trigger.directive';

/**
 * On-canvas contextual bar that floats above the selected sequence participant
 * (lifeline), matching the message toolbar: a header-color popover, inline
 * rename, and delete. The parent positions the host via left/top bindings.
 */
@Component({
  selector: 'app-sequence-participant-toolbar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, PopoverTriggerDirective],
  templateUrl: './sequence-participant-toolbar.component.html',
  styleUrl: './sequence-participant-toolbar.component.scss',
})
export class SequenceParticipantToolbarComponent {
  protected readonly store = inject(ProjectStore);
  protected readonly lifeline = computed(() => this.store.selectedLifeline());
  protected readonly canEdit = computed(() => this.store.canEdit());

  protected readonly swatches = [
    '',
    '#e5484d',
    '#f5a623',
    '#12b76a',
    '#0ea5e9',
    '#2f6bff',
    '#7c5cff',
    '#ec4899',
  ];

  protected setColor(color: string): void {
    const l = this.lifeline();
    if (l) void this.store.updateLifeline(l.id, { color });
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
