import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal, effect } from '@angular/core';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { isEmbedUrl, normalizeEmbedUrl } from '@devdesigner/shared';

/**
 * A live frame's page: a sandboxed iframe of a http(s) URL. Click-through unless
 * `interacting`, so the box stays grabbable on the canvas. With no URL yet and
 * `editable`, it shows a small address form instead. When nothing is loaded the
 * SVG placeholder card drawn underneath shows through.
 */
@Component({
   selector: 'dd-embed-frame',
   changeDetection: ChangeDetectionStrategy.OnPush,
   host: { class: 'embed-frame', '[class.interacting]': 'interacting()' },
   template: `
      @if (src(); as s) {
         <!-- allow-same-origin keeps the page on its real origin: without it the origin is
              'null' and module scripts (Vite dev servers, most SPAs) fail CORS. -->
         @if (!loaded()) {
            <div class="loading" aria-hidden="true"><span></span><span></span><span></span></div>
         }
         @for (k of [nonce()]; track k) {
            <iframe
               [class.ready]="loaded()"
               (load)="loaded.set(true)"
               title="Live frame"
               referrerpolicy="no-referrer"
               allow="clipboard-read; clipboard-write; fullscreen; autoplay"
               sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-same-origin"
               [src]="s"
            ></iframe>
         }
      } @else if (editable() && !url()) {
         <!-- Only the field and button take the pointer: the rest drags the frame. -->
         <form class="ask" (submit)="submit($event, field.value)">
            <div class="panel">
               <div class="badge" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.6 2.4 3.8 5.2 3.8 8.5s-1.2 6.1-3.8 8.5c-2.6-2.4-3.8-5.2-3.8-8.5S9.4 5.9 12 3.5z" /></svg>
               </div>
               <label class="title" [attr.for]="fieldId">Embed a live page</label>
               <p class="sub">A running site or your local dev server</p>
               <div class="field" [class.bad]="invalid()">
                  <input
                     #field
                     type="text"
                     autocomplete="off"
                     spellcheck="false"
                     placeholder="localhost:4200"
                     [id]="fieldId"
                     (pointerdown)="$event.stopPropagation()"
                     (keydown)="$event.stopPropagation()"
                     (input)="invalid.set(false)"
                  />
                  <button type="submit" (pointerdown)="$event.stopPropagation()">Embed</button>
               </div>
               @if (invalid()) {
                  <p class="hint err">Use an http:// or https:// address.</p>
               }
            </div>
         </form>
      }
   `,
   styles: `
      :host {
         display: block;
         width: 100%;
         height: 100%;
         pointer-events: none;
         overflow: hidden;
         border-radius: inherit;
         /* iframes ignore a parent's rounded overflow; clip-path rounds them reliably. */
         clip-path: inset(0 round var(--embed-radius, 0px));
      }
      :host {
         position: relative;
      }
      .loading {
         position: absolute;
         inset: 0;
         display: flex;
         align-items: center;
         justify-content: center;
         gap: 6px;
      }
      .loading span {
         width: 7px;
         height: 7px;
         border-radius: 50%;
         background: var(--dd-text-muted, #888);
         animation: dot 1s ease-in-out infinite;
      }
      .loading span:nth-child(2) {
         animation-delay: 0.15s;
      }
      .loading span:nth-child(3) {
         animation-delay: 0.3s;
      }
      @keyframes dot {
         0%, 100% { opacity: 0.25; transform: scale(0.8); }
         50% { opacity: 1; transform: scale(1); }
      }
      iframe {
         position: relative;
         opacity: 0;
         transition: opacity 280ms ease;
      }
      iframe.ready {
         opacity: 1;
      }
      iframe {
         display: block;
         width: 100%;
         height: 100%;
         border: 0;
         border-radius: var(--embed-radius, 0px);
         background: #fff;
         pointer-events: none;
      }
      :host(.interacting) iframe {
         pointer-events: auto;
      }
      .ask {
         box-sizing: border-box;
         height: 100%;
         display: grid;
         place-items: center;
         padding: 16px;
         background: var(--dd-surface, #fff);
         font: 13px/1.4 var(--dd-font-ui, system-ui, sans-serif);
         color: var(--dd-text, #111);
         cursor: move;
      }
      .panel {
         width: min(100%, 380px);
         display: flex;
         flex-direction: column;
         align-items: center;
         text-align: center;
      }
      .badge {
         display: grid;
         place-items: center;
         width: 40px;
         height: 40px;
         margin-bottom: 10px;
         border-radius: 12px;
         background: color-mix(in srgb, var(--dd-accent, #2563eb) 14%, transparent);
         color: var(--dd-accent, #2563eb);
      }
      .badge svg {
         width: 22px;
         height: 22px;
         fill: none;
         stroke: currentColor;
         stroke-width: 1.6;
      }
      .title {
         font-size: 15px;
         font-weight: 650;
      }
      .sub {
         margin: 2px 0 14px;
         color: var(--dd-text-muted, #666);
      }
      .field {
         pointer-events: auto;
         cursor: auto;
         display: flex;
         width: 100%;
         padding: 3px;
         border: 1px solid var(--dd-border-strong, #bbb);
         border-radius: 10px;
         background: var(--dd-bg, #fff);
         transition: border-color 120ms, box-shadow 120ms;
      }
      .field:focus-within {
         border-color: var(--dd-accent, #2563eb);
         box-shadow: 0 0 0 3px color-mix(in srgb, var(--dd-accent, #2563eb) 22%, transparent);
      }
      .field.bad {
         border-color: var(--dd-danger, #dc2626);
         box-shadow: 0 0 0 3px color-mix(in srgb, var(--dd-danger, #dc2626) 18%, transparent);
      }
      input {
         flex: 1;
         min-width: 0;
         padding: 7px 9px;
         border: 0;
         background: transparent;
         color: inherit;
         font: inherit;
         font-family: var(--dd-font-mono, ui-monospace, monospace);
         font-size: 12.5px;
         outline: none;
      }
      button {
         flex: none;
         padding: 0 14px;
         border: 0;
         border-radius: 7px;
         background: var(--dd-accent, #2563eb);
         color: var(--dd-on-accent, #fff);
         font: inherit;
         font-weight: 600;
         cursor: pointer;
         transition: filter 120ms;
      }
      button:hover {
         filter: brightness(1.08);
      }
      .hint {
         margin: 8px 0 0;
         color: var(--dd-text-muted, #666);
         font-size: 11.5px;
      }
      .hint.err {
         color: var(--dd-danger, #dc2626);
      }
   `,
})
export class EmbedFrameComponent {
   private readonly sanitizer = inject(DomSanitizer);
   private static seq = 0;

   readonly url = input<string | null | undefined>(null);
   /** Load the page (false = leave the placeholder underneath showing). */
   readonly live = input(true);
   readonly interacting = input(false);
   readonly editable = input(false);
   /** Change to reload the page. */
   readonly nonce = input(0);
   readonly urlCommit = output<string>();

   protected readonly fieldId = `embed-url-${(EmbedFrameComponent.seq += 1)}`;
   protected readonly invalid = signal(false);
   /** The page finished loading (fades in over the loading dots). */
   protected readonly loaded = signal(false);

   constructor() {
      // A new address or a reload starts hidden again until the page loads.
      effect(() => {
         this.url();
         this.nonce();
         this.loaded.set(false);
      });
   }

   protected readonly src = computed<SafeResourceUrl | null>(() => {
      const url = this.url()?.trim();
      if (!this.live() || !url || !isEmbedUrl(url)) return null;
      return this.sanitizer.bypassSecurityTrustResourceUrl(url);
   });

   /** A framed copy of this app never shares its origin (it could act as the viewer). */

   protected submit(event: Event, value: string): void {
      event.preventDefault();
      const url = normalizeEmbedUrl(value);
      this.invalid.set(!url);
      if (url) this.urlCommit.emit(url);
   }
}
