import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { ShareSessionService } from '../../auth/share-session.service';

/**
 * Attach the anonymous share token (when in shared mode), the guest id and this
 * tab's server-assigned realtime client id to every API call. The server
 * authorizes link-based access from X-Share-Token and leaves the socket named by
 * X-Client-Id out of the write's realtime broadcast (see BUILD_INSTRUCTIONS.md
 * section 6 and the realtime plan). Before the socket connects there is no id.
 */
export const shareTokenInterceptor: HttpInterceptorFn = (req, next) => {
   const session = inject(ShareSessionService);
   const headers: Record<string, string> = { 'X-Guest-Id': session.guestId };
   const clientId = session.clientId();
   if (clientId) {
      headers['X-Client-Id'] = clientId;
   }
   const token = session.token();
   if (token) {
      headers['X-Share-Token'] = token;
   }
   return next(req.clone({ setHeaders: headers }));
};
