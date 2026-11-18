import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { runtimeConfig } from '../config/runtime-config';

/**
 * Thin wrapper over HttpClient that prefixes the configured API base URL. Feature
 * data services build on this. The X-Share-Token header for anonymous shared-mode
 * access is attached by a dedicated interceptor (core/interceptors), not here.
 */
@Injectable({ providedIn: 'root' })
export class ApiClientService {
   private readonly http = inject(HttpClient);
   private readonly baseUrl = runtimeConfig.apiBaseUrl;

   get<T>(path: string) {
      return this.http.get<T>(`${this.baseUrl}${path}`);
   }

   post<T>(path: string, body: unknown) {
      return this.http.post<T>(`${this.baseUrl}${path}`, body);
   }

   patch<T>(path: string, body: unknown) {
      return this.http.patch<T>(`${this.baseUrl}${path}`, body);
   }

   put<T>(path: string, body: unknown) {
      return this.http.put<T>(`${this.baseUrl}${path}`, body);
   }

   delete<T>(path: string) {
      return this.http.delete<T>(`${this.baseUrl}${path}`);
   }
}
