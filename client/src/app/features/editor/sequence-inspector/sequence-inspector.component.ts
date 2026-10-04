import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type { SequenceMessageModel } from '@dbdesigner/shared';
import { ProjectStore } from '../../../stores/project.store';
import { IconComponent } from '../../../shared/ui/icon/icon.component';
import { InputComponent } from '../../../shared/ui/input/input.component';
import { SelectComponent, type SelectOption } from '../../../shared/ui/select/select.component';

/**
 * Side panel for the selected sequence lifeline or message. Lifeline: label,
 * color, width + the diagram's layout/spacing config. Message: endpoints
 * (from/to), style (sync/return), direction, arrowhead, label. Everything is
 * also editable on the canvas; this panel gathers the levers in one place.
 */
@Component({
  selector: 'app-sequence-inspector',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, FormsModule, IconComponent, InputComponent, SelectComponent],
  templateUrl: './sequence-inspector.component.html',
  styleUrl: './sequence-inspector.component.scss',
})
export class SequenceInspectorComponent {
  protected readonly store = inject(ProjectStore);

  protected readonly lifeline = computed(() => this.store.selectedLifeline());
  protected readonly message = computed(() => this.store.selectedMessage());
  /** The diagram the current selection belongs to (box, or the selected part's). */
  protected readonly activeDiagram = computed(() => {
    const direct = this.store.selectedDiagram();
    if (direct) return direct;
    const diagramId = this.lifeline()?.diagramId ?? this.message()?.diagramId;
    return diagramId
      ? (this.store.sequenceDiagrams().find((d) => d.id === diagramId) ?? null)
      : null;
  });
  protected readonly config = computed(
    () =>
      this.activeDiagram() ?? { lifelineSpacing: 160, rowSpacing: 48, headerHeight: 42, originY: 0 },
  );
  /** The whole diagram box is selected (no single lifeline/message). */
  protected readonly diagram = computed(() => this.store.selectedDiagram());
  protected readonly participantCount = computed(
    () => this.store.lifelines().filter((l) => l.diagramId === this.activeDiagram()?.id).length,
  );
  protected readonly messageCount = computed(
    () =>
      this.store.sequenceMessages().filter((m) => m.diagramId === this.activeDiagram()?.id).length,
  );

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

  protected readonly lifelineOptions = computed<SelectOption[]>(() =>
    this.store
      .lifelines()
      .filter((l) => l.diagramId === this.activeDiagram()?.id)
      .map((l) => ({ value: l.id, label: l.label })),
  );

  // ---- Lifeline ----
  protected setLabel(label: string | number): void {
    const l = this.lifeline();
    if (l) void this.store.updateLifeline(l.id, { label: String(label) });
  }
  protected setColor(color: string): void {
    const l = this.lifeline();
    if (l) void this.store.updateLifeline(l.id, { color });
  }
  protected setWidth(value: string | number): void {
    const l = this.lifeline();
    const width = Number(value);
    if (l && Number.isFinite(width) && width > 0) void this.store.updateLifeline(l.id, { width });
  }
  protected deleteLifeline(): void {
    const l = this.lifeline();
    if (l) void this.store.deleteLifeline(l.id);
  }
  protected addParticipant(side: 'left' | 'right' = 'right'): void {
    const d = this.activeDiagram();
    if (d) void this.store.addLifeline(d.id, side);
  }

  // ---- Config ----
  protected setSpacing(key: 'lifelineSpacing' | 'rowSpacing' | 'headerHeight', value: string | number): void {
    const d = this.activeDiagram();
    const n = Number(value);
    if (d && Number.isFinite(n) && n > 0) void this.store.updateSequenceConfig(d.id, { [key]: n });
  }

  // ---- Message ----
  protected setFrom(id: string): void {
    const m = this.message();
    if (m) void this.store.updateMessage(m.id, { fromLifelineId: id });
  }
  protected setTo(id: string): void {
    const m = this.message();
    if (m) void this.store.updateMessage(m.id, { toLifelineId: id });
  }
  protected setMsgLabel(label: string | number): void {
    const m = this.message();
    if (m) void this.store.updateMessage(m.id, { label: String(label) });
  }
  protected setStyle(style: SequenceMessageModel['style']): void {
    const m = this.message();
    if (m) void this.store.updateMessage(m.id, { style });
  }
  protected flipDirection(): void {
    const m = this.message();
    if (m) {
      void this.store.updateMessage(m.id, {
        direction: m.direction === 'forward' ? 'reverse' : 'forward',
      });
    }
  }
  protected deleteMessage(): void {
    const m = this.message();
    if (m) void this.store.deleteMessage(m.id);
  }
}
