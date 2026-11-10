import { computed, Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { CurrentUserResponse, LoginDto, RegisterDto } from '@devdesigner/shared';
import { ApiService } from './api.service';

/**
 * Client-side auth state and actions. The session lives in an httpOnly cookie the
 * browser sends automatically (see the withCredentials interceptor), so this
 * service never touches a token: it only tracks who is signed in. `currentUser`
 * is the single source of truth for auth-aware UI.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
   private readonly api = inject(ApiService);

   private readonly _currentUser = signal<CurrentUserResponse | null>(null);
   /** True once the initial /auth/me hydration has completed. */
   private readonly _ready = signal(false);

   readonly currentUser = this._currentUser.asReadonly();
   readonly ready = this._ready.asReadonly();
   readonly isAuthenticated = computed(() => this._currentUser() !== null);

   /** A friendly label for the signed-in user (display name, else email). */
   readonly displayLabel = computed(() => {
      const user = this._currentUser();
      if (!user) {
         return '';
      }
      return user.displayName?.trim() || user.email || 'Account';
   });

   /** Hydrate the session from the cookie on app start. Safe to call repeatedly. */
   async loadMe(): Promise<void> {
      try {
         const user = await firstValueFrom(this.api.get<CurrentUserResponse | null>('/auth/me'));
         this._currentUser.set(user);
      } catch {
         this._currentUser.set(null);
      } finally {
         this._ready.set(true);
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
}
