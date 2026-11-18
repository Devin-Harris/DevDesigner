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
      button,
      a {
         flex: none;
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
