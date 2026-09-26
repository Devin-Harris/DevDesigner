import { HttpInterceptorFn } from '@angular/common/http';

/**
 * Send the httpOnly session cookie with every API call. The auth cookie is set
 * cross-origin (client on :4200, API on :3000), so requests must opt in to
 * credentials; the server's CORS config allows this specific origin.
 */
export const withCredentialsInterceptor: HttpInterceptorFn = (req, next) =>
  next(req.clone({ withCredentials: true }));
