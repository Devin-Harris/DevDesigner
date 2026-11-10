// Admin API response shapes (`/api/admin/*`), shared by the server and the admin feature.

/** GET /api/admin/ping: proves the caller passed the admin wall. */
export interface AdminPingResponse {
  ok: true;
  serverTime: string;
}
