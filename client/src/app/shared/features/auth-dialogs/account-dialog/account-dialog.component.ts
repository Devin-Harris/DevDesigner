import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { formSignal } from 'ngx-form-signal';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { AuthService } from '../../../../core/auth/auth.service';
import { IconComponent } from '../../../ui/components/icon/icon.component';
import { InputComponent } from '../../../ui/components/input/input.component';

/** What the dialog did; the opener refreshes identity-dependent state when it isn't 'none'. */
export type AccountDialogResult = 'none' | 'signed-out' | 'deleted';

/**
 * Account → Account settings. Sign out on every device (POST /auth/logout-all) and
 * delete the account with a password check (DELETE /auth/me). Both end this
 * browser's session too.
 */
@Component({
   selector: 'dd-account-dialog',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [ReactiveFormsModule, MatDialogModule, IconComponent, InputComponent],
   templateUrl: './account-dialog.component.html',
   styleUrl: './account-dialog.component.scss',
})
export class AccountDialogComponent {
   protected readonly auth = inject(AuthService);
   private readonly ref = inject<MatDialogRef<AccountDialogComponent, AccountDialogResult>>(MatDialogRef);

   protected readonly busy$ = signal<'logout-all' | 'delete' | null>(null);
   protected readonly error$ = signal<string | null>(null);
   /** Delete is two-step: reveal the password field + confirm button first. */
   protected readonly confirmingDelete$ = signal(false);
   protected readonly password = new FormControl('', { nonNullable: true });
   private readonly password$ = formSignal(this.password);
   protected readonly canDelete$ = computed(
      () => (this.password$.value() ?? '').length > 0 && this.busy$() === null
   );

   protected async logoutAll(): Promise<void> {
      this.busy$.set('logout-all');
      this.error$.set(null);
      try {
         await this.auth.logoutAll();
         this.ref.close('signed-out');
      } catch (err) {
         this.error$.set(describe(err, 'Could not sign out of other devices.'));
      } finally {
         this.busy$.set(null);
      }
   }

   protected async deleteAccount(): Promise<void> {
      if (!this.canDelete$()) {
         return;
      }
      this.busy$.set('delete');
      this.error$.set(null);
      try {
         await this.auth.deleteAccount(this.password.value);
         this.ref.close('deleted');
      } catch (err) {
         this.error$.set(describe(err, 'Could not delete the account.'));
      } finally {
         this.busy$.set(null);
      }
   }
}

function describe(err: unknown, fallback: string): string {
   const message = (err as { error?: { message?: string | string[] } })?.error?.message;
   return Array.isArray(message) ? message.join(' ') : (message ?? fallback);
}
