import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  type WritableSignal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../core/services/auth.service';
import { InputComponent } from '../../shared/ui/input/input.component';

type Mode = 'login' | 'register';

/**
 * Sign-in / create-account dialog. One dialog toggles between login and register
 * so the flow stays lightweight. On success it closes with `true`; the opener
 * refreshes the project list for the new identity. Anonymous use continues to
 * work, so this is never forced.
 */
@Component({
  selector: 'app-auth-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatDialogModule, MatProgressSpinnerModule, InputComponent],
  templateUrl: './auth-dialog.component.html',
  styleUrl: './auth-dialog.component.scss',
})
export class AuthDialogComponent {
  private readonly auth = inject(AuthService);
  private readonly dialogRef = inject(MatDialogRef<AuthDialogComponent, boolean>);

  protected readonly mode = signal<Mode>('login');
  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly displayName = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly isRegister = computed(() => this.mode() === 'register');
  protected readonly title = computed(() =>
    this.isRegister() ? 'Create account' : 'Sign in',
  );
  protected readonly submitLabel = computed(() =>
    this.isRegister() ? 'Create account' : 'Sign in',
  );
  protected readonly canSubmit = computed(() => {
    const emailOk = this.email().trim().length > 3 && this.email().includes('@');
    const passOk = this.isRegister()
      ? this.password().length >= 8
      : this.password().length > 0;
    return emailOk && passOk && !this.busy();
  });

  protected set(signalRef: WritableSignal<string>, value: string | number): void {
    signalRef.set(String(value));
  }

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
    try {
      if (this.isRegister()) {
        await this.auth.register({
          email: this.email().trim(),
          password: this.password(),
          displayName: this.displayName().trim() || undefined,
        });
      } else {
        await this.auth.login({ email: this.email().trim(), password: this.password() });
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
