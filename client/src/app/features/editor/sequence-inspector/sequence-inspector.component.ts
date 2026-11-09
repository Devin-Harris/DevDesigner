import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  type SequenceMessageModel,
} from '@devdesigner/shared';
import { ProjectStore } from '../../../stores/project.store';
import { IconComponent } from '../../../shared/ui/icon/icon.component';
import { ColorSwatchesComponent } from '../../../shared/ui/color-swatches/color-swatches.component';
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
  imports: [ColorSwatchesComponent, FormsModule, IconComponent, InputComponent, SelectComponent],
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
  /** The whole diagram box is selected (no single lifeline/message). */
  protected readonly diagram = computed(() => this.store.selectedDiagram());
  protected readonly participantCount = computed(
    () => this.store.lifelines().filter((l) => l.diagramId === this.activeDiagram()?.id).length,
  );
  protected readonly messageCount = computed(
    () =>
      this.store.sequenceMessages().filter((m) => m.diagramId === this.activeDiagram()?.id).length,
  );


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
  protected setBackground(backgroundColor: string): void {
    const d = this.activeDiagram();
    if (d) void this.store.updateSequenceConfig(d.id, { backgroundColor });
  }
  protected setBorder(borderColor: string): void {
    const d = this.activeDiagram();
    if (d) void this.store.updateSequenceConfig(d.id, { borderColor });
  }
  protected setStrokeColor(strokeColor: string): void {
    const l = this.lifeline();
    if (l) void this.store.updateLifeline(l.id, { strokeColor });
  }
  protected setTextColor(textColor: string): void {
    const l = this.lifeline();
    if (l) void this.store.updateLifeline(l.id, { textColor });
  }
  protected setLineColor(lineColor: string): void {
    const l = this.lifeline();
    if (l) void this.store.updateLifeline(l.id, { lineColor });
  }
  protected setWidth(width: string | number): void {
    const l = this.lifeline();
    const w = Math.round(Number(width));
    if (l && Number.isFinite(w)) {
      void this.store.updateLifeline(l.id, { width: Math.min(600, Math.max(60, w)) });
    }
  }
  protected nudgeWidth(delta: number): void {
    const l = this.lifeline();
    if (l) this.setWidth(l.width + delta);
  }
  protected deleteLifeline(): void {
    const l = this.lifeline();
    if (l) void this.store.deleteLifeline(l.id);
  }
  protected addParticipant(side: 'left' | 'right' = 'right'): void {
    const d = this.activeDiagram();
    if (d) void this.store.addLifeline(d.id, side === 'left' ? 0 : Infinity);
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
  protected setMsgColor(color: string): void {
    const m = this.message();
    if (m) void this.store.updateMessage(m.id, { color });
  }
  protected setStyle(style: SequenceMessageModel['style']): void {
    const m = this.message();
    if (m) void this.store.updateMessage(m.id, { style });
  }
  protected toggleWrap(): void {
    const m = this.message();
    if (m) void this.store.updateMessage(m.id, { wrap: m.wrap === false });
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

  /** Re-stack the selected diagram against drawing elements. */
  protected arrange(op: 'front' | 'back'): void {
    this.store.arrangeSelection(op);
  }
}
