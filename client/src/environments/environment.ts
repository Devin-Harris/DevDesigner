/**
 * Runtime configuration for the client. Copy environment.example.ts over this
 * file (or use Angular fileReplacements) to point at a different API. Kept out of
 * source control secrets; this file holds only non-sensitive endpoints.
 */
export const environment = {
  production: false,
  apiBaseUrl: 'http://localhost:3000/api',
  // Origin of the realtime socket.io server (the API host, without the /api path).
  wsBaseUrl: 'http://localhost:3000',
};
