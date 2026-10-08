/**
 * Used by the desktop build (`ng build --configuration electron`). The embedded
 * server serves this bundle from the same origin as the API, so URLs are relative.
 * That keeps the app working for a peer who opens the host's LAN address.
 */
export const environment = {
  production: true,
  apiBaseUrl: '/api',
  wsBaseUrl: '',
};
