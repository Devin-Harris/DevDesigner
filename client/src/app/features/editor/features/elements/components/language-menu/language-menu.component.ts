import {
   ChangeDetectionStrategy,
   Component,
   type ElementRef,
   afterNextRender,
   computed,
   input,
   output,
   signal,
   viewChild,
} from '@angular/core';
import { CODE_LANGUAGES, type CodeLanguage } from '@devdesigner/shared';
import { CODE_LANGUAGE_EXTENSIONS, CODE_LANGUAGE_LABELS } from '../../../../helpers/code-highlight.helper';

interface LanguageOption {
   id: CodeLanguage;
   label: string;
   /** Lower-cased words matched by the search: id, label and file extension. */
   keys: string;
}

const OPTIONS: readonly LanguageOption[] = CODE_LANGUAGES.map((id) => ({
   id,
   label: CODE_LANGUAGE_LABELS[id],
   keys: `${id} ${CODE_LANGUAGE_LABELS[id]} ${CODE_LANGUAGE_EXTENSIONS[id]}`.toLowerCase(),
})).sort((a, b) => (a.id === 'plaintext' ? -1 : b.id === 'plaintext' ? 1 : a.label.localeCompare(b.label)));

/**
 * Searchable list of code-block languages for a popover: focus lands in the search box,
 * so typing filters straight away; arrows move, Enter picks, Escape closes (popover).
 */
@Component({
   selector: 'dd-language-menu',
   changeDetection: ChangeDetectionStrategy.OnPush,
   template: `
      <div class="dd-menu lang-menu">
         <input
            #search
            class="lang-search"
            type="text"
            placeholder="Search languages"
            aria-label="Search languages"
            autocomplete="off"
            spellcheck="false"
            [value]="query$()"
            (input)="setQuery($any($event.target).value)"
            (keydown)="onKey($event)"
         />
         <div class="lang-list" role="listbox">
            @for (l of filtered$(); track l.id; let i = $index) {
               <button
                  class="dd-menu-item"
                  type="button"
                  role="option"
                  [attr.aria-selected]="l.id === value$()"
                  [class.on]="l.id === value$()"
                  [class.hot]="i === active$()"
                  (mouseenter)="active$.set(i)"
                  (click)="choose(l.id)"
               >
                  {{ l.label }}
               </button>
            } @empty {
               <div class="lang-empty">No matching language</div>
            }
         </div>
      </div>
   `,
   styles: `
      .lang-menu {
         width: 200px;
         overflow: hidden;
      }
      .lang-search {
         flex: none;
         margin: 0 0 4px;
         padding: 6px 9px;
         border: 1px solid var(--dd-border);
         border-radius: var(--dd-radius-sm);
         background: var(--dd-surface-2);
         color: var(--dd-text);
         font-size: 13px;
         outline: none;
         &:focus {
            border-color: var(--dd-primary);
         }
      }
      .lang-list {
         display: flex;
         flex-direction: column;
         gap: 1px;
         overflow: auto;
         max-height: 300px;
      }
      .dd-menu-item.hot:not(.on) {
         background: var(--dd-surface-2);
      }
      .lang-empty {
         padding: 7px 10px;
         font-size: 13px;
         color: var(--dd-text-muted);
      }
   `,
})
export class LanguageMenuComponent {
   readonly value$ = input<CodeLanguage>('typescript', { alias: 'value' });
   readonly picked = output<CodeLanguage>();

   protected readonly query$ = signal('');
   protected readonly active$ = signal(0);
   private readonly search = viewChild.required<ElementRef<HTMLInputElement>>('search');

   protected readonly filtered$ = computed(() => {
      const q = this.query$().trim().toLowerCase();
      if (!q) return OPTIONS;
      // Names that start with the query first, then any other match.
      const hits = OPTIONS.filter((o) => o.keys.includes(q));
      const starts = (o: LanguageOption) => o.label.toLowerCase().startsWith(q) || o.id.startsWith(q);
      return [...hits.filter(starts), ...hits.filter((o) => !starts(o))];
   });

   constructor() {
      afterNextRender(() => {
         this.search().nativeElement.focus();
         const at = OPTIONS.findIndex((o) => o.id === this.value$());
         this.active$.set(Math.max(0, at));
         this.scrollActive();
      });
   }

   protected setQuery(q: string): void {
      this.query$.set(q);
      this.active$.set(0);
   }

   protected choose(id: CodeLanguage): void {
      this.picked.emit(id);
   }

   protected onKey(event: KeyboardEvent): void {
      const n = this.filtered$().length;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
         event.preventDefault();
         if (!n) return;
         const step = event.key === 'ArrowDown' ? 1 : -1;
         this.active$.set((this.active$() + step + n) % n);
         this.scrollActive();
      } else if (event.key === 'Enter') {
         event.preventDefault();
         const hit = this.filtered$()[this.active$()];
         if (hit) this.choose(hit.id);
      }
      // Keep canvas shortcuts from firing while typing a search.
      if (event.key !== 'Escape') event.stopPropagation();
   }

   private scrollActive(): void {
      queueMicrotask(() => {
         const list = this.search().nativeElement.nextElementSibling;
         list?.children[this.active$()]?.scrollIntoView({ block: 'nearest' });
      });
   }
}
