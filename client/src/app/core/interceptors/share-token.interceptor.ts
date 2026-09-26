import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { ShareSessionService } from '../services/share-session.service';

/**
 * Attach the anonymous share token (when in shared mode) and this tab's client id
 * to every API call. The server authorizes link-based access from X-Share-Token
 * and echoes X-Client-Id back on the realtime broadcast so this tab ignores its
 * own change (see BUILD_INSTRUCTIONS.md section 6 and the realtime plan).
 */
export const shareTokenInterceptor: HttpInterceptorFn = (req, next) => {
  const session = inject(ShareSessionService);
  const headers: Record<string, string> = { 'X-Client-Id': session.clientId };
  const token = session.token();
  if (token) {
    headers['X-Share-Token'] = token;
  }
  return next(req.clone({ setHeaders: headers }));
};
