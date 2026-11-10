/**
 * Smoke test: ngx-form-signal (the owner's package, v2.18.0) works on Angular 22 zoneless
 * (cleanliness pass 0.9). formSignal needs an injection context.
 */
import { computed } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { formSignal } from 'ngx-form-signal';

function createForm() {
   const form = new FormGroup({
      name: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
      scope: new FormControl<'read' | 'write'>('read', { nonNullable: true }),
   });
   const form$ = TestBed.runInInjectionContext(() => formSignal(form));
   return { form, form$ };
}

describe('ngx-form-signal on Angular 22', () => {
   it('exposes the initial value, validity and pristine state', () => {
      const { form$ } = createForm();
      expect(form$.value()).toEqual({ name: '', scope: 'read' });
      expect(form$.valid()).toBe(false);
      expect(form$.dirty()).toBe(false);
   });

   it('updates value() and valid() when the form changes', () => {
      const { form, form$ } = createForm();
      form.controls.name.setValue('token');
      TestBed.tick();
      expect(form$.value()).toEqual({ name: 'token', scope: 'read' });
      expect(form$.valid()).toBe(true);
   });

   it('reports dirty() after markAsDirty', () => {
      const { form, form$ } = createForm();
      form.controls.name.markAsDirty();
      TestBed.tick();
      expect(form$.dirty()).toBe(true);
   });

   it('drives a computed (canSubmit pattern from the audit)', () => {
      const { form, form$ } = createForm();
      const canSubmit$ = computed(() => form$.valid() && form$.dirty());
      expect(canSubmit$()).toBe(false);
      form.controls.name.setValue('x');
      form.controls.name.markAsDirty();
      TestBed.tick();
      expect(canSubmit$()).toBe(true);
   });
});
