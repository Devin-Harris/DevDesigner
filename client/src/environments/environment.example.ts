/** Template for environment.ts. Copy to environment.ts and adjust as needed. */
export const environment = {
  production: false,
  apiBaseUrl: 'http://localhost:3000/api',
  // Origin of the realtime socket.io server (the API host, without the /api path).
  wsBaseUrl: 'http://localhost:3000',
  // Public URL of the hosted MCP endpoint (e.g. https://devdesignermcp-production.up.railway.app/mcp).
  // Set it in deployed builds so the API-token dialog shows a remote config; empty = local stdio config.
  mcpUrl: '',
};
