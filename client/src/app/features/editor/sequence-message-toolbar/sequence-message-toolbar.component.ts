import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { themeColorCss, type SequenceMessageModel } from '@dbdesigner/shared';
import { ProjectStore } from '../../../stores/project.store';
import { IconComponent } from '../../../shared/ui/icon/icon.component';
import { ColorSwatchesComponent } from '../../../shared/ui/color-swatches/color-swatches.component';
import { PopoverTriggerDirective } from '../../../shared/ui/popover/popover-trigger.directive';

/**
 * On-canvas contextual bar that floats above the selected sequence message
 * (matching the mock): style toggle (Sync / Return / Break), flip direction,
 * edit label, and delete. The parent positions the host via left/top bindings.
 */
@Component({
  selector: 'app-sequence-message-toolbar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, ColorSwatchesComponent, PopoverTriggerDirective],
  templateUrl: './sequence-message-toolbar.component.html',
  styleUrl: './sequence-message-toolbar.component.scss',
})
export class SequenceMessageToolbarComponent {
  protected readonly store = inject(ProjectStore);
  protected readonly message = computed(() => this.store.selectedMessage());
  protected readonly canEdit = computed(() => this.store.canEdit());
  protected readonly css = themeColorCss;

  protected setColor(color: string): void {
    const m = this.message();
    if (m) void this.store.updateMessage(m.id, { color });
  }

  protected setStyle(style: SequenceMessageModel['style']): void {
    const m = this.message();
    if (m) void this.store.updateMessage(m.id, { style });
  }
  protected flip(): void {
    const m = this.message();
    if (m) {
      void this.store.updateMessage(m.id, {
        direction: m.direction === 'forward' ? 'reverse' : 'forward',
      });
    }
  }
  protected toggleWrap(): void {
    const m = this.message();
    if (m) void this.store.updateMessage(m.id, { wrap: m.wrap === false });
  }
  protected edit(): void {
    const m = this.message();
    if (m) this.store.requestMessageEdit(m.id);
  }
  protected remove(): void {
    const m = this.message();
    if (m) void this.store.deleteMessage(m.id);
  }
}
