import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { formSignal } from 'ngx-form-signal';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../../../core/auth/auth.service';
import { InputComponent } from '../../../ui/components/input/input.component';

type Mode = 'login' | 'register';

/**
 * Sign-in / create-account dialog. One dialog toggles between login and register
 * so the flow stays lightweight. On success it closes with `true`; the opener
 * refreshes the project list for the new identity. Anonymous use continues to
 * work, so this is never forced.
 */
@Component({
   selector: 'dd-auth-dialog',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [ReactiveFormsModule, MatDialogModule, MatProgressSpinnerModule, InputComponent],
   templateUrl: './auth-dialog.component.html',
   styleUrl: './auth-dialog.component.scss',
})
export class AuthDialogComponent {
   private readonly auth = inject(AuthService);
   private readonly dialogRef = inject(MatDialogRef<AuthDialogComponent, boolean>);

   protected readonly mode = signal<Mode>('login');
   protected readonly form = new FormGroup({
      displayName: new FormControl('', { nonNullable: true }),
      email: new FormControl('', { nonNullable: true }),
      password: new FormControl('', { nonNullable: true }),
   });
   private readonly form$ = formSignal(this.form);
   protected readonly busy = signal(false);
   protected readonly error = signal<string | null>(null);

   protected readonly isRegister = computed(() => this.mode() === 'register');
   protected readonly title = computed(() => (this.isRegister() ? 'Create account' : 'Sign in'));
   protected readonly submitLabel = computed(() => (this.isRegister() ? 'Create account' : 'Sign in'));
   protected readonly canSubmit = computed(() => {
      const email = this.form$.value()?.email ?? '';
      const password = this.form$.value()?.password ?? '';
      const emailOk = email.trim().length > 3 && email.includes('@');
      const passOk = this.isRegister() ? password.length >= 8 : password.length > 0;
      return emailOk && passOk && !this.busy();
   });

   protected toggleMode(): void {
      this.mode.update((m) => (m === 'login' ? 'register' : 'login'));
      this.error.set(null);
   }

   protected async submit(): Promise<void> {
      if (!this.canSubmit()) {
         return;
      }
      this.busy.set(true);
      this.error.set(null);
      const { email, password, displayName } = this.form.getRawValue();
      try {
         if (this.isRegister()) {
            await this.auth.register({
               email: email.trim(),
               password,
               displayName: displayName.trim() || undefined,
            });
         } else {
            await this.auth.login({ email: email.trim(), password });
         }
         this.dialogRef.close(true);
      } catch (err) {
         this.error.set(messageOf(err));
      } finally {
         this.busy.set(false);
      }
   }
}

/** Pull a readable message out of an HttpErrorResponse (string or string[]). */
function messageOf(err: unknown): string {
   const body = (err as { error?: { message?: unknown } })?.error;
   const message = body?.message;
   if (Array.isArray(message)) {
      return message.join(' ');
   }
   if (typeof message === 'string') {
      return message;
   }
   return 'Something went wrong. Please try again.';
}
