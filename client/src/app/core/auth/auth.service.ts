import { computed, Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { CurrentUserResponse, LoginDto, OAuthProviderId, OAuthProviderInfo, RegisterDto } from '@devdesigner/shared';
import { ApiClientService } from '../http/api-client.service';
import { runtimeConfig } from '../config/runtime-config';

/**
 * Client-side auth state and actions. The session lives in an httpOnly cookie the
 * browser sends automatically (see the withCredentials interceptor), so this
 * service never touches a token: it only tracks who is signed in. `currentUser`
 * is the single source of truth for auth-aware UI.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
   private readonly api = inject(ApiClientService);

   private readonly _currentUser = signal<CurrentUserResponse | null>(null);
   /** True once the initial /auth/me hydration has completed. */
   private readonly _ready = signal(false);

   private loading: Promise<void> | null = null;

   readonly currentUser$ = this._currentUser.asReadonly();
   readonly ready = this._ready.asReadonly();
   readonly isAuthenticated = computed(() => this._currentUser() !== null);
   readonly isAdmin$ = computed(() => this._currentUser()?.isAdmin === true);

   /** A friendly label for the signed-in user (display name, else email). */
   readonly displayLabel = computed(() => {
      const user = this._currentUser();
      if (!user) {
         return '';
      }
      return user.displayName?.trim() || user.email || 'Account';
   });

   /** Hydrate the session from the cookie on app start. Safe to call repeatedly. */
   loadMe(): Promise<void> {
      this.loading = this.fetchMe();
      return this.loading;
   }

   /** Resolves once the first /auth/me hydration has finished, starting it if nobody has. */
   whenReady(): Promise<void> {
      if (this._ready()) {
         return Promise.resolve();
      }
      return this.loading ?? this.loadMe();
   }

   /** Set when an OAuth round trip came back with an error (read once by the UI). */
   readonly oauthError$ = signal<string | null>(null);

   private async fetchMe(): Promise<void> {
      try {
         if (!runtimeConfig.desktop && (await this.finishOAuthRedirect())) {
            return;
         }
         // Desktop: always the one local account; the loopback server signs it in without credentials.
         const user = runtimeConfig.desktop
            ? await firstValueFrom(this.api.post<CurrentUserResponse>('/auth/desktop', {}))
            : await firstValueFrom(this.api.get<CurrentUserResponse | null>('/auth/me'));
         this._currentUser.set(user);
      } catch {
         this._currentUser.set(null);
      } finally {
         this._ready.set(true);
      }
   }

   /** Third-party sign-in providers this server is configured for (empty on errors and in desktop). */
   async oauthProviders(): Promise<OAuthProviderInfo[]> {
      if (runtimeConfig.desktop) return [];
      try {
         return await firstValueFrom(this.api.get<OAuthProviderInfo[]>('/auth/oauth/providers'));
      } catch {
         return [];
      }
   }

   /** Leave the app for the provider; it comes back to `/?oauth_code=` (see finishOAuthRedirect). */
   startOAuth(provider: OAuthProviderId): void {
      globalThis.location.assign(`${runtimeConfig.apiBaseUrl}/auth/oauth/${provider}`);
   }

   /**
    * The OAuth callback sends the browser to `/?oauth_code=…` (or `oauth_error=…`).
    * Trade the one-time code for the session cookie and strip the params from the URL.
    * Returns true when it signed the user in.
    */
   private async finishOAuthRedirect(): Promise<boolean> {
      const loc = globalThis.location;
      if (!loc) return false;
      const url = new URL(loc.href);
      const code = url.searchParams.get('oauth_code');
      const error = url.searchParams.get('oauth_error');
      if (!code && !error) return false;
      url.searchParams.delete('oauth_code');
      url.searchParams.delete('oauth_error');
      globalThis.history?.replaceState(globalThis.history.state, '', url.pathname + url.search + url.hash);
      if (error) {
         this.oauthError$.set(
            error === 'cancelled' ? 'Sign-in was cancelled.' : 'Sign-in failed. Please try again.'
         );
         return false;
      }
      try {
         const user = await firstValueFrom(
            this.api.post<CurrentUserResponse>('/auth/oauth/exchange', { code })
         );
         this._currentUser.set(user);
         return true;
      } catch {
         this.oauthError$.set('Sign-in link expired. Please try again.');
         return false;
      }
   }

   async login(dto: LoginDto): Promise<void> {
      const user = await firstValueFrom(this.api.post<CurrentUserResponse>('/auth/login', dto));
      this._currentUser.set(user);
   }

   async register(dto: RegisterDto): Promise<void> {
      const user = await firstValueFrom(this.api.post<CurrentUserResponse>('/auth/register', dto));
      this._currentUser.set(user);
   }

   async logout(): Promise<void> {
      try {
         await firstValueFrom(this.api.post<void>('/auth/logout', {}));
      } finally {
         this._currentUser.set(null);
      }
   }

   /** Sign out on every device (revokes all sessions server-side), including this one. */
   async logoutAll(): Promise<void> {
      await firstValueFrom(this.api.post<void>('/auth/logout-all', {}));
      this._currentUser.set(null);
   }

   /** Permanently delete the signed-in account. Throws (and stays signed in) on a wrong password. */
   async deleteAccount(password: string): Promise<void> {
      await firstValueFrom(this.api.delete<void>('/auth/me', { body: { password } }));
      this._currentUser.set(null);
   }
}
