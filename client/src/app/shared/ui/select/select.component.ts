import {
   ChangeDetectionStrategy,
   Component,
   ElementRef,
   computed,
   forwardRef,
   inject,
   input,
   output,
   signal,
} from '@angular/core';
import { NG_VALUE_ACCESSOR, type ControlValueAccessor } from '@angular/forms';
import { IconComponent } from '../icon/icon.component';
import { PopoverTriggerDirective } from '../popover/popover-trigger.directive';

export interface SelectOption<T = string> {
   value: T;
   label: string;
   /** A heading the option is listed under (consecutive options share it). */
   group?: string;
   /** Show a pencil to rename the option in place (emits `rename`). */
   renamable?: boolean;
   /** A CSS font-family to draw the label in (font pickers preview their face). */
   font?: string;
}

/**
 * Bespoke dropdown select (replaces MatSelect), built on the popover primitive.
 * CVA-compatible. Options via `[options]`; supports a compact variant for inline
 * use (e.g. column type in a table row).
 */
@Component({
   selector: 'dd-select',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [IconComponent, PopoverTriggerDirective],
   providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => SelectComponent), multi: true }],
   template: `
      @if (selectedOption(); as sel) {
         @if (editing() === sel.value && inline()) {
            <input
               #inl
               class="rename inline"
               [value]="sel.label"
               aria-label="Name"
               (keydown.enter)="finishRename(sel, inl.value)"
               (keydown.escape)="editing.set(null)"
               (blur)="finishRename(sel, inl.value)"
            />
         }
      }
      @if (!(inline() && editing() !== null)) {
         <div class="wrap">
            <button
               type="button"
               class="dd-select-trigger"
               [class.compact]="compact()"
               [ddPopoverTrigger]="menu"
               placement="below-start"
               [disabled]="disabled()"
            >
               <span class="val" [style.font-family]="selectedFont()">{{ selectedLabel() }}</span>
               <dd-icon name="arrow_drop_down" class="chev" />
            </button>
            @if (selectedOption()?.renamable && !disabled()) {
               <button type="button" class="pen outer" aria-label="Rename" title="Rename" (click)="startInlineRename()">
                  <dd-icon name="edit" />
               </button>
            }
         </div>
      }
      <ng-template #menu let-close>
         <div class="dd-menu dd-select-menu">
            @for (opt of options(); track opt.value; let i = $index) {
               @if (opt.group && opt.group !== options()[i - 1]?.group) {
                  <div class="group">{{ opt.group }}</div>
               }
               @if (editing() === opt.value) {
                  <input
                     #name
                     class="rename"
                     [value]="opt.label"
                     aria-label="Name"
                     (keydown.enter)="finishRename(opt, name.value)"
                     (keydown.escape)="editing.set(null); $event.stopPropagation()"
                     (blur)="finishRename(opt, name.value)"
                     (click)="$event.stopPropagation()"
                  />
               } @else {
                  <div class="row">
                     <button
                        type="button"
                        class="dd-menu-item"
                        [class.on]="opt.value === value()"
                        [style.font-family]="opt.font"
                        (click)="pick(opt.value); close()"
                     >
                        {{ opt.label }}
                     </button>
                     @if (opt.renamable) {
                        <button
                           type="button"
                           class="pen"
                           aria-label="Rename"
                           title="Rename"
                           (click)="startRename(opt.value, $event)"
                        >
                           <dd-icon name="edit" />
                        </button>
                        @if (removable()) {
                           <button
                              type="button"
                              class="pen del"
                              aria-label="Delete"
                              title="Delete"
                              (click)="$event.stopPropagation(); remove.emit(opt.value)"
                           >
                              <dd-icon name="delete" />
                           </button>
                        }
                     }
                  </div>
               }
            }
         </div>
      </ng-template>
   `,
   styles: [
      `
         :host {
            display: block;
         }
         .dd-select-trigger {
            display: inline-flex;
            align-items: center;
            justify-content: space-between;
            gap: 4px;
            width: 100%;
            box-sizing: border-box;
            height: 34px;
            padding: 0 6px 0 10px;
            font: inherit;
            font-family: var(--dd-font);
            font-size: 13px;
            color: var(--dd-text);
            background: var(--dd-surface-2);
            border: 1px solid var(--dd-border);
            border-radius: var(--dd-radius-sm);
            cursor: pointer;
            transition: border-color 0.12s ease;
         }
         .dd-select-trigger.compact {
            height: 24px;
            font-family: var(--dd-mono);
            font-size: 11px;
            padding: 0 3px 0 7px;
            color: var(--dd-text-muted);
         }
         .dd-select-trigger:hover:not(:disabled) {
            border-color: var(--dd-border-strong);
         }
         .dd-select-trigger:disabled {
            opacity: 0.55;
            cursor: default;
         }
         .val {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
         }
         .group {
            padding: 6px 8px 3px;
            font-size: 10.5px;
            font-weight: 600;
            letter-spacing: 0.04em;
            text-transform: uppercase;
            color: var(--dd-text-muted);
         }
         .group:not(:first-child) {
            margin-top: 4px;
            border-top: 1px solid var(--dd-border);
            padding-top: 8px;
         }
         .row {
            display: flex;
            align-items: center;
         }
         .row .dd-menu-item {
            flex: 1 1 auto;
            min-width: 0;
         }
         .pen {
            flex: none;
            display: inline-flex;
            border: none;
            background: transparent;
            color: var(--dd-text-muted);
            padding: 4px;
            border-radius: 6px;
            cursor: pointer;
            --dd-icon-size: 14px;
         }
         .pen.del:hover {
            color: #ef6b6b;
         }
         .pen:hover {
            background: var(--dd-surface-2);
            color: var(--dd-text);
         }
         .rename {
            box-sizing: border-box;
            width: 100%;
            height: 30px;
            margin: 1px 0;
            padding: 0 8px;
            font: inherit;
            font-size: 13px;
            color: var(--dd-text);
            background: var(--dd-surface-2);
            border: 1px solid var(--dd-primary);
            border-radius: var(--dd-radius-sm);
            outline: none;
         }
         .wrap {
            display: flex;
            align-items: center;
            gap: 2px;
         }
         .wrap .dd-select-trigger {
            flex: 1 1 auto;
            min-width: 0;
         }
         .pen.outer {
            padding: 6px;
         }
         .rename.inline {
            height: 34px;
            margin: 0;
         }
         .chev {
            --dd-icon-size: 16px;
            color: var(--dd-text-muted);
         }
      `,
   ],
})
export class SelectComponent<T = string> implements ControlValueAccessor {
   private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
   readonly options = input.required<SelectOption<T>[]>();
   readonly compact = input<boolean>(false);
   readonly placeholder = input<string>('Select');
   readonly disabled = signal(false);
   protected readonly value = signal<T | null>(null);
   /** A renamable option's new name, after the pencil is used. */
   readonly rename = output<{ value: T; label: string }>();
   /** Renamable options also get a delete button (emits `remove`). */
   readonly removable = input(false);
   readonly remove = output<T>();
   protected readonly editing = signal<T | null>(null);

   /** Renaming the selected option in the trigger's place (not in the menu). */
   protected readonly inline = signal(false);

   protected startInlineRename(): void {
      const sel = this.selectedOption();
      if (!sel) return;
      this.inline.set(true);
      this.editing.set(sel.value);
      setTimeout(() => {
         const el = this.host.nativeElement.querySelector<HTMLInputElement>('input.rename.inline');
         el?.focus();
         el?.select();
      });
   }

   protected startRename(v: T, event: Event): void {
      event.stopPropagation();
      this.inline.set(false);
      this.editing.set(v);
      // Focus the field once it renders.
      setTimeout(() => {
         const el = document.querySelector<HTMLInputElement>('.dd-select-menu input.rename');
         el?.focus();
         el?.select();
      });
   }
   protected finishRename(opt: SelectOption<T>, label: string): void {
      if (this.editing() !== opt.value) return;
      this.editing.set(null);
      this.inline.set(false);
      const trimmed = label.trim();
      if (trimmed && trimmed !== opt.label) this.rename.emit({ value: opt.value, label: trimmed });
   }

   protected readonly selectedLabel = computed(() => {
      const v = this.value();
      return this.options().find((o) => o.value === v)?.label ?? this.placeholder();
   });

   protected readonly selectedOption = computed(() => {
      const v = this.value();
      return this.options().find((o) => o.value === v) ?? null;
   });

   protected readonly selectedFont = computed(() => {
      const v = this.value();
      return this.options().find((o) => o.value === v)?.font ?? null;
   });

   protected onChange: (v: T) => void = () => {};
   protected onTouched: () => void = () => {};

   protected pick(v: T): void {
      this.value.set(v);
      this.onChange(v);
      this.onTouched();
   }

   writeValue(v: T | null): void {
      this.value.set(v);
   }
   registerOnChange(fn: (v: T) => void): void {
      this.onChange = fn;
   }
   registerOnTouched(fn: () => void): void {
      this.onTouched = fn;
   }
   setDisabledState(isDisabled: boolean): void {
      this.disabled.set(isDisabled);
   }
}
