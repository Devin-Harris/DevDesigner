import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { type SequenceMessageModel } from '@devdesigner/shared';
import { SequenceEdits } from '../../services/sequence-edits.service';
import { IconComponent } from '../../../../../../shared/ui/components/icon/icon.component';
import { ColorSwatchesComponent } from '../../../../../../shared/ui/components/color-swatches/color-swatches.component';
import { InputComponent } from '../../../../../../shared/ui/components/input/input.component';
import { SelectComponent, type SelectOption } from '../../../../../../shared/ui/components/select/select.component';

/**
 * Side panel for the selected sequence lifeline or message. Lifeline: label,
 * color, width + the diagram's layout/spacing config. Message: endpoints
 * (from/to), style (sync/return), direction, arrowhead, label. Everything is
 * also editable on the canvas; this panel gathers the levers in one place.
 */
@Component({
   selector: 'dd-sequence-inspector',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [ColorSwatchesComponent, FormsModule, IconComponent, InputComponent, SelectComponent],
   templateUrl: './sequence-inspector.component.html',
   styleUrl: './sequence-inspector.component.scss',
})
export class SequenceInspectorComponent {
   protected readonly edits = inject(SequenceEdits);

   protected readonly lifeline$ = computed(() => this.edits.selectedLifeline());
   protected readonly message$ = computed(() => this.edits.selectedMessage());
   /** The diagram the current selection belongs to (box, or the selected part's). */
   protected readonly activeDiagram = computed(() => {
      const direct = this.edits.selectedDiagram();
      if (direct) return direct;
      const diagramId = this.lifeline$()?.diagramId ?? this.message$()?.diagramId;
      return diagramId ? (this.edits.sequenceDiagrams().find((d) => d.id === diagramId) ?? null) : null;
   });
   /** The whole diagram box is selected (no single lifeline/message). */
   protected readonly diagram$ = computed(() => this.edits.selectedDiagram());
   protected readonly participantCount$ = computed(
      () => this.edits.lifelines().filter((l) => l.diagramId === this.activeDiagram()?.id).length
   );
   protected readonly messageCount$ = computed(
      () => this.edits.sequenceMessages().filter((m) => m.diagramId === this.activeDiagram()?.id).length
   );

   protected readonly lifelineOptions$ = computed<SelectOption[]>(() =>
      this.edits
         .lifelines()
         .filter((l) => l.diagramId === this.activeDiagram()?.id)
         .map((l) => ({ value: l.id, label: l.label }))
   );

   // ---- Lifeline ----
   protected setLabel(label: string | number): void {
      const l = this.lifeline$();
      if (l) void this.edits.updateLifeline(l.id, { label: String(label) });
   }
   protected setColor(color: string): void {
      const l = this.lifeline$();
      if (l) void this.edits.updateLifeline(l.id, { color });
   }
   protected setBackground(backgroundColor: string): void {
      const d = this.activeDiagram();
      if (d) void this.edits.updateSequenceConfig(d.id, { backgroundColor });
   }
   protected setBorder(borderColor: string): void {
      const d = this.activeDiagram();
      if (d) void this.edits.updateSequenceConfig(d.id, { borderColor });
   }
   protected setStrokeColor(strokeColor: string): void {
      const l = this.lifeline$();
      if (l) void this.edits.updateLifeline(l.id, { strokeColor });
   }
   protected setTextColor(textColor: string): void {
      const l = this.lifeline$();
      if (l) void this.edits.updateLifeline(l.id, { textColor });
   }
   protected setLineColor(lineColor: string): void {
      const l = this.lifeline$();
      if (l) void this.edits.updateLifeline(l.id, { lineColor });
   }
   protected setWidth(width: string | number): void {
      const l = this.lifeline$();
      const w = Math.round(Number(width));
      if (l && Number.isFinite(w)) {
         void this.edits.updateLifeline(l.id, { width: Math.min(600, Math.max(60, w)) });
      }
   }
   protected nudgeWidth(delta: number): void {
      const l = this.lifeline$();
      if (l) this.setWidth(l.width + delta);
   }
   protected deleteLifeline(): void {
      const l = this.lifeline$();
      if (l) void this.edits.deleteLifeline(l.id);
   }
   protected addParticipant(side: 'left' | 'right' = 'right'): void {
      const d = this.activeDiagram();
      if (d) void this.edits.addLifeline(d.id, side === 'left' ? 0 : Infinity);
   }

   // ---- Message ----
   protected setFrom(id: string): void {
      const m = this.message$();
      if (m) void this.edits.updateMessage(m.id, { fromLifelineId: id });
   }
   protected setTo(id: string): void {
      const m = this.message$();
      if (m) void this.edits.updateMessage(m.id, { toLifelineId: id });
   }
   protected setMsgLabel(label: string | number): void {
      const m = this.message$();
      if (m) void this.edits.updateMessage(m.id, { label: String(label) });
   }
   protected setMsgColor(color: string): void {
      const m = this.message$();
      if (m) void this.edits.updateMessage(m.id, { color });
   }
   protected setStyle(style: SequenceMessageModel['style']): void {
      const m = this.message$();
      if (m) void this.edits.updateMessage(m.id, { style });
   }
   protected toggleWrap(): void {
      const m = this.message$();
      if (m) void this.edits.updateMessage(m.id, { wrap: m.wrap === false });
   }
   protected flipDirection(): void {
      const m = this.message$();
      if (m) {
         void this.edits.updateMessage(m.id, {
            direction: m.direction === 'forward' ? 'reverse' : 'forward',
         });
      }
   }
   protected deleteMessage(): void {
      const m = this.message$();
      if (m) void this.edits.deleteMessage(m.id);
   }

   /** Re-stack the selected diagram against drawing elements. */
   protected arrange(op: 'front' | 'back'): void {
      this.edits.arrangeSelection(op);
   }
}
