import { HttpErrorResponse, HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { defer, of, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { SandboxBackendService, SandboxError } from './sandbox-backend.service';

/**
 * Serves API requests for the canvas guide's sandbox projects from the browser
 * (SandboxBackendService) so sandbox edits never reach the server. Everything
 * else passes through untouched.
 */
export const sandboxInterceptor: HttpInterceptorFn = (req, next) => {
   const base = environment.apiBaseUrl;
   if (!req.url.startsWith(base)) return next(req);
   const path = req.url.slice(base.length);
   const backend = inject(SandboxBackendService);

   // Media for sandbox elements.
   const img = /^\/images\/([^/?]+)/.exec(path);
   if (img && req.method === 'GET') {
      const blob = backend.image(img[1]);
      return blob ? of(new HttpResponse({ status: 200, body: blob, url: req.url })) : next(req);
   }

   let result: { body: unknown } | undefined;
   try {
      result = backend.handle(req.method, path, req.body);
   } catch (err) {
      const status = err instanceof SandboxError ? err.status : 500;
      const message = err instanceof Error ? err.message : 'Sandbox error';
      return throwError(() => new HttpErrorResponse({ status, error: { message }, url: req.url }));
   }
   if (!result) return next(req);
   const body = result.body;
   // Async like a real request, so callers never see a synchronous emission.
   return defer(() => Promise.resolve(new HttpResponse({ status: 200, body, url: req.url })));
};
