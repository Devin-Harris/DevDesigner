/** Template for environment.ts. Copy to environment.ts and adjust as needed. */
export const environment = {
   production: false,
   apiBaseUrl: 'http://localhost:3000/api',
   // Origin of the realtime socket.io server (the API host, without the /api path).
   wsBaseUrl: 'http://localhost:3000',
   // Public URL of the hosted MCP endpoint (e.g. https://devdesignermcp-production.up.railway.app/mcp).
   // Set it in deployed builds so the API-token dialog shows a remote config; empty = local stdio config.
   mcpUrl: '',
   // Sentry browser DSN (public). Empty = error reporting off.
   sentryDsn: '',
   // First-party usage beacon (POST /api/telemetry: route templates and allow-listed client.* events,
   // no cookies or storage). Off by default; set true (or TELEMETRY=true at build time) to send it.
   telemetry: false,
};
