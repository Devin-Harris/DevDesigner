import { inject, Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';

/**
 * Opens the account dialogs (sign-in, API tokens). The components are imported on
 * first use, so they stay out of the initial bundle (perf P4.2).
 */
@Injectable({ providedIn: 'root' })
export class AccountDialogsService {
   private readonly dialog = inject(MatDialog);

   /** Sign in / create an account. Resolves true when the user signed in. */
   async openAuth(): Promise<boolean> {
      const { AuthDialogComponent } = await import('./auth-dialog/auth-dialog.component');
      const ref = this.dialog.open<unknown, unknown, boolean>(AuthDialogComponent, {
         width: '420px',
         maxWidth: '92vw',
      });
      return (await firstValueFrom(ref.afterClosed())) === true;
   }

   async openApiTokens(): Promise<void> {
      const { ApiTokensDialogComponent } = await import('./api-tokens-dialog/api-tokens-dialog.component');
      this.dialog.open(ApiTokensDialogComponent, { width: '560px', maxWidth: '94vw' });
   }
}
