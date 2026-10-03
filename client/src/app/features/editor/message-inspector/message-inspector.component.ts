import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import type { SequenceMessageModel } from '@dbdesigner/shared';
import { ProjectStore } from '../../../stores/project.store';
import { IconComponent } from '../../../shared/ui/icon/icon.component';

@Component({
  selector: 'app-message-inspector',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  templateUrl: './message-inspector.component.html',
  styleUrl: './message-inspector.component.scss',
})
export class MessageInspectorComponent {
  protected readonly store = inject(ProjectStore);
  readonly message = input.required<SequenceMessageModel>();

  protected onLabelChange(value: string): void {
    void this.store.updateSequenceMessage(this.message().id, { label: value || undefined });
  }

  protected onStyleToggle(style: 'solid' | 'dashed'): void {
    void this.store.updateSequenceMessage(this.message().id, { style });
  }

  protected onDirectionToggle(direction: 'forward' | 'reverse'): void {
    void this.store.updateSequenceMessage(this.message().id, { direction });
  }

  protected onArrowheadChange(arrowhead: 'arrow' | 'open' | 'none'): void {
    void this.store.updateSequenceMessage(this.message().id, { arrowhead });
  }

  protected onDelete(): void {
    void this.store.deleteSequenceMessage(this.message().id);
  }
}
