import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import type { LifelineModel } from '@dbdesigner/shared';
import { ProjectStore } from '../../../stores/project.store';
import { IconComponent } from '../../../shared/ui/icon/icon.component';

const COLORS = ['#0ea5e9', '#e5484d', '#f5a623', '#12b76a', '#2f6bff', '#7c5cff', '#ec4899', '#64748b'];

@Component({
  selector: 'app-lifeline-inspector',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  templateUrl: './lifeline-inspector.component.html',
  styleUrl: './lifeline-inspector.component.scss',
})
export class LifelineInspectorComponent {
  protected readonly store = inject(ProjectStore);
  readonly lifeline = input.required<LifelineModel>();

  protected readonly colors = COLORS;

  protected onLabelChange(value: string): void {
    void this.store.updateLifeline(this.lifeline().id, { label: value });
  }

  protected onColorPick(color: string): void {
    void this.store.updateLifeline(this.lifeline().id, { color });
  }

  protected onWidthChange(value: number): void {
    void this.store.updateLifeline(this.lifeline().id, { width: value });
  }

  protected onDelete(): void {
    void this.store.deleteLifeline(this.lifeline().id);
  }
}
