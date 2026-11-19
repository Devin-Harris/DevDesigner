import { inject, Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';
import { ProjectsApiService } from '../../services/projects-api.service';
import {
   ConfirmDialogComponent,
   type ConfirmDialogData,
} from '../../ui/components/confirm-dialog/confirm-dialog.component';

/**
 * Opens the account dialogs (sign-in, API tokens, account settings). The components are imported on
 * first use, so they stay out of the initial bundle (perf P4.2).
 */
@Injectable({ providedIn: 'root' })
export class AccountDialogsService {
   private readonly dialog = inject(MatDialog);
   private readonly snackBar = inject(MatSnackBar);
   private readonly projectsApi = inject(ProjectsApiService);

   /**
    * Sign in / create an account. Resolves true when the user signed in (after offering to
    * move this browser's guest projects into the account, so every sign-in path asks).
    */
   async openAuth(): Promise<boolean> {
      const { AuthDialogComponent } = await import('./auth-dialog/auth-dialog.component');
      const ref = this.dialog.open<unknown, unknown, boolean>(AuthDialogComponent, {
         width: '420px',
         maxWidth: '92vw',
      });
      const signedIn = (await firstValueFrom(ref.afterClosed())) === true;
      if (signedIn) await this.offerGuestProjectClaim();
      return signedIn;
   }

   /** After sign-in, offer to move this browser's guest projects into the account. */
   private async offerGuestProjectClaim(): Promise<void> {
      try {
         const { count } = await firstValueFrom(this.projectsApi.guestCount());
         if (count === 0) {
            return;
         }
         const plural = count === 1 ? 'project' : 'projects';
         const data: ConfirmDialogData = {
            title: 'Move guest projects?',
            message:
               `You have ${count} ${plural} made in this browser without an account. ` +
               `Move ${count === 1 ? 'it' : 'them'} into your account? If you don't, ` +
               `${count === 1 ? 'it stays' : 'they stay'} available here only while signed out.`,
            confirmLabel: `Move ${plural}`,
         };
         const confirmed = await firstValueFrom(
            this.dialog.open(ConfirmDialogComponent, { data, width: '420px' }).afterClosed()
         );
         if (!confirmed) {
            return;
         }
         const moved = await firstValueFrom(this.projectsApi.claimGuest());
         this.snackBar.open(
            `Moved ${moved.count} ${moved.count === 1 ? 'project' : 'projects'} to your account`,
            undefined,
            { duration: 3000 }
         );
      } catch (err) {
         console.error('Could not move guest projects', err);
         this.snackBar.open('Could not move guest projects', 'Dismiss', { duration: 5000 });
      }
   }


   async openApiTokens(): Promise<void> {
      const { ApiTokensDialogComponent } = await import('./api-tokens-dialog/api-tokens-dialog.component');
      this.dialog.open(ApiTokensDialogComponent, { width: '560px', maxWidth: '94vw' });
   }

   /** Sign out everywhere / delete account. Resolves true when this browser's session ended. */
   async openAccount(): Promise<boolean> {
      const { AccountDialogComponent } = await import('./account-dialog/account-dialog.component');
      const ref = this.dialog.open(AccountDialogComponent, { width: '480px', maxWidth: '94vw' });
      const result = await firstValueFrom(ref.afterClosed());
      return result === 'signed-out' || result === 'deleted';
   }
}
