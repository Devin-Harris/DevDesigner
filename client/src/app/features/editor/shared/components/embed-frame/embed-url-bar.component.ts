import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { normalizeEmbedUrl } from '@devdesigner/shared';

/**
 * The address bar above a selected live frame: edit the URL (Enter saves, Esc
 * reverts), reload the page, or open it in a new tab.
 */
@Component({
   selector: 'dd-embed-url-bar',
   changeDetection: ChangeDetectionStrategy.OnPush,
   host: { '(pointerdown)': '$event.stopPropagation()', '(dblclick)': '$event.stopPropagation()' },
   template: `
      <form class="bar" [class.bad]="invalid()" (submit)="save($event, field)">
         <input
            #field
            type="text"
            spellcheck="false"
            autocomplete="off"
            aria-label="Live frame URL"
            [value]="url()"
            [readOnly]="!editable()"
            (keydown)="onKey($event, field)"
            (input)="invalid.set(false)"
            (blur)="save(null, field)"
         />
         @if (editable()) {
            <!-- Opt in to a snapshot of this frame for thumbnails, transitions and PDF export. -->
            <label class="snap" title="Use a snapshot of this page in thumbnails, slide transitions and PDF exports (asks to share this tab for a moment)">
               <input type="checkbox" [checked]="snapshot()" (change)="snapshotToggle.emit($any($event.target).checked)" />
               Snapshot
            </label>
            @if (snapshot()) {
               <button type="button" title="Retake the snapshot" aria-label="Retake snapshot" (click)="retake.emit()">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" /><circle cx="12" cy="13" r="3.2" /></svg>
               </button>
            }
         }
         <button type="button" title="Reload" aria-label="Reload page" (click)="reload.emit()">⟳</button>
         <a title="Open in a new tab" aria-label="Open in a new tab" target="_blank" rel="noopener noreferrer" [href]="url()">↗</a>
      </form>
   `,
   styles: `
      :host {
         display: block;
         pointer-events: auto;
         width: 100%;
         height: 100%;
      }
      .bar {
         box-sizing: border-box;
         height: 100%;
         display: flex;
         align-items: center;
         gap: 4px;
         padding: 3px;
         border: 1px solid var(--dd-border, #ccc);
         border-radius: 8px;
         background: var(--dd-surface, #fff);
         box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12);
         font: 12px/1 var(--dd-font, system-ui, sans-serif);
         color: var(--dd-text, #111);
      }
      .bar.bad {
         border-color: var(--dd-danger, #dc2626);
      }
      input {
         flex: 1;
         min-width: 0;
         height: 100%;
         padding: 0 8px;
         border: 0;
         border-radius: 5px;
         background: transparent;
         color: inherit;
         font: inherit;
         outline: none;
      }
      input:focus {
         background: var(--dd-chip-bg);
      }
      .snap {
         flex: none;
         display: flex;
         align-items: center;
         gap: 4px;
         padding: 0 6px;
         color: var(--dd-text-muted, #555);
         font-size: 11.5px;
         white-space: nowrap;
         cursor: pointer;
      }
      .snap input {
         margin: 0;
         accent-color: var(--dd-primary);
      }
      button,
      a {
         flex: none;
         padding: 0;
         display: grid;
         place-items: center;
         width: 24px;
         height: 100%;
         border: 0;
         border-radius: 5px;
         background: transparent;
         color: var(--dd-text-muted, #555);
         font-size: 14px;
         text-decoration: none;
         cursor: pointer;
      }
      button svg {
         display: block;
         width: 15px;
         height: 15px;
         fill: none;
         stroke: currentColor;
         stroke-width: 1.7;
         stroke-linejoin: round;
      }
      button:hover,
      a:hover {
         background: var(--dd-chip-bg);
         color: inherit;
      }
   `,
})
export class EmbedUrlBarComponent {
   readonly url = input.required<string>();
   readonly editable = input(true);
   readonly urlCommit = output<string>();
   readonly reload = output<void>();
   /** This frame has a snapshot (it shows in thumbnails and exports). */
   readonly snapshot = input(false);
   readonly snapshotToggle = output<boolean>();
   readonly retake = output<void>();
   protected readonly invalid = signal(false);

   protected onKey(event: KeyboardEvent, field: HTMLInputElement): void {
      event.stopPropagation();
      if (event.key === 'Escape') {
         field.value = this.url();
         this.invalid.set(false);
         field.blur();
      }
   }

   protected save(event: Event | null, field: HTMLInputElement): void {
      event?.preventDefault();
      if (!this.editable()) return;
      const raw = field.value.trim();
      if (raw === this.url()) {
         if (event) field.blur();
         return;
      }
      const next = normalizeEmbedUrl(raw);
      if (!next) {
         this.invalid.set(true);
         return;
      }
      this.invalid.set(false);
      field.value = next;
      this.urlCommit.emit(next);
      if (event) field.blur();
   }
}
