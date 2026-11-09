#!/usr/bin/env node
// DevDesigner MCP server. Two transports:
//
//   stdio (default): launched by the client. Configure with
//     DEVDESIGNER_API_TOKEN  an API token created in DevDesigner (required)
//     DEVDESIGNER_API_URL    backend base URL incl. /api (default http://localhost:3000/api)
//
//   HTTP (MCP_TRANSPORT=http, or --http): a remote `POST /mcp` endpoint. Each request
//   carries its own `Authorization: Bearer dd_...`, so one deployment serves many
//   users. Configure with DEVDESIGNER_API_URL (required) and PORT (default 3001).
//
// Logs go to stderr only: in stdio mode stdout belongs to the MCP protocol.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DevDesignerApi, configFromEnv, normalizeApiUrl } from './api';
import { startHttp } from './http';
import { createServer } from './server';

async function main(): Promise<void> {
  if (process.env.MCP_TRANSPORT === 'http' || process.argv.includes('--http')) {
    await startHttp({
      port: Number(process.env.PORT ?? 3001),
      apiUrl: normalizeApiUrl(process.env.DEVDESIGNER_API_URL ?? 'http://localhost:3000/api'),
    });
    return;
  }
  const server = createServer(new DevDesignerApi(configFromEnv()));
  await server.connect(new StdioServerTransport());
  console.error('DevDesigner MCP server ready (stdio).');
}

main().catch((err: unknown) => {
  console.error(`DevDesigner MCP server failed to start: ${(err as Error).message}`);
  process.exit(1);
});
