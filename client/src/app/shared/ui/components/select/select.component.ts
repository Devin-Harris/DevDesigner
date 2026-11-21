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
import { PopoverTriggerDirective } from '../../directives/popover-trigger.directive';

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
   templateUrl: './select.component.html',
   styleUrl: './select.component.scss',
})
export class SelectComponent<T = string> implements ControlValueAccessor {
   private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
   readonly options$ = input.required<SelectOption<T>[]>({ alias: 'options' });
   readonly compact$ = input<boolean>(false, { alias: 'compact' });
   readonly placeholder = input<string>('Select');
   readonly disabled$ = signal(false);
   protected readonly value$ = signal<T | null>(null);
   /** A renamable option's new name, after the pencil is used. */
   readonly rename = output<{ value: T; label: string }>();
   /** Renamable options also get a delete button (emits `remove`). */
   readonly removable$ = input(false, { alias: 'removable' });
   readonly remove = output<T>();
   protected readonly editing$ = signal<T | null>(null);

   /** Renaming the selected option in the trigger's place (not in the menu). */
   protected readonly inline$ = signal(false);

   protected startInlineRename(): void {
      const sel = this.selectedOption$();
      if (!sel) return;
      this.inline$.set(true);
      this.editing$.set(sel.value);
      setTimeout(() => {
         const el = this.host.nativeElement.querySelector<HTMLInputElement>('input.rename.inline');
         el?.focus();
         el?.select();
      });
   }

   protected startRename(v: T, event: Event): void {
      event.stopPropagation();
      this.inline$.set(false);
      this.editing$.set(v);
      // Focus the field once it renders.
      setTimeout(() => {
         const el = document.querySelector<HTMLInputElement>('.dd-select-menu input.rename');
         el?.focus();
         el?.select();
      });
   }
   protected finishRename(opt: SelectOption<T>, label: string): void {
      if (this.editing$() !== opt.value) return;
      this.editing$.set(null);
      this.inline$.set(false);
      const trimmed = label.trim();
      if (trimmed && trimmed !== opt.label) this.rename.emit({ value: opt.value, label: trimmed });
   }

   protected readonly selectedLabel$ = computed(() => {
      const v = this.value$();
      return this.options$().find((o) => o.value === v)?.label ?? this.placeholder();
   });

   protected readonly selectedOption$ = computed(() => {
      const v = this.value$();
      return this.options$().find((o) => o.value === v) ?? null;
   });

   protected readonly selectedFont$ = computed(() => {
      const v = this.value$();
      return this.options$().find((o) => o.value === v)?.font ?? null;
   });

   protected onChange: (v: T) => void = () => {};
   protected onTouched: () => void = () => {};

   protected pick(v: T): void {
      this.value$.set(v);
      this.onChange(v);
      this.onTouched();
   }

   writeValue(v: T | null): void {
      this.value$.set(v);
   }
   registerOnChange(fn: (v: T) => void): void {
      this.onChange = fn;
   }
   registerOnTouched(fn: () => void): void {
      this.onTouched = fn;
   }
   setDisabledState(isDisabled: boolean): void {
      this.disabled$.set(isDisabled);
   }
}
