#!/usr/bin/env node
// DBDesigner MCP server. Two transports:
//
//   stdio (default): launched by the client. Configure with
//     DBDESIGNER_API_TOKEN  an API token created in DBDesigner (required)
//     DBDESIGNER_API_URL    backend base URL incl. /api (default http://localhost:3000/api)
//
//   HTTP (MCP_TRANSPORT=http, or --http): a remote `POST /mcp` endpoint. Each request
//   carries its own `Authorization: Bearer dbd_...`, so one deployment serves many
//   users. Configure with DBDESIGNER_API_URL (required) and PORT (default 3001).
//
// Logs go to stderr only: in stdio mode stdout belongs to the MCP protocol.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DbDesignerApi, configFromEnv } from './api';
import { startHttp } from './http';
import { createServer } from './server';

async function main(): Promise<void> {
  if (process.env.MCP_TRANSPORT === 'http' || process.argv.includes('--http')) {
    await startHttp({
      port: Number(process.env.PORT ?? 3001),
      apiUrl: (process.env.DBDESIGNER_API_URL ?? 'http://localhost:3000/api').replace(/\/+$/, ''),
    });
    return;
  }
  const server = createServer(new DbDesignerApi(configFromEnv()));
  await server.connect(new StdioServerTransport());
  console.error('DBDesigner MCP server ready (stdio).');
}

main().catch((err: unknown) => {
  console.error(`DBDesigner MCP server failed to start: ${(err as Error).message}`);
  process.exit(1);
});
