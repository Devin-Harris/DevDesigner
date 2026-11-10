import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { SlideTheme, UserThemeResponse } from '@devdesigner/shared';
import { ApiClientService } from './api-client.service';

/**
 * The caller's personal theme library ("My themes"): themes kept across projects.
 * Loaded on first use; `themes` is empty (with `error` set) when it cannot be reached.
 */
@Injectable({ providedIn: 'root' })
export class UserThemesService {
   private readonly api = inject(ApiClientService);
   readonly themes = signal<readonly UserThemeResponse[]>([]);
   readonly error = signal<string | null>(null);
   private loaded = false;

   async load(force = false): Promise<void> {
      if (this.loaded && !force) return;
      this.loaded = true;
      try {
         this.themes.set(await firstValueFrom(this.api.get<UserThemeResponse[]>('/me/themes')));
         this.error.set(null);
      } catch {
         this.error.set('Your themes could not be loaded.');
      }
   }

   /** Save (or update, by theme id) a theme in the library. */
   async save(theme: SlideTheme): Promise<void> {
      const saved = await firstValueFrom(this.api.post<UserThemeResponse>('/me/themes', { theme }));
      const rest = this.themes().filter((t) => t.id !== saved.id);
      this.themes.set([...rest, saved]);
   }

   async remove(id: string): Promise<void> {
      await firstValueFrom(this.api.delete<void>(`/me/themes/${id}`));
      this.themes.set(this.themes().filter((t) => t.id !== id));
   }
}
