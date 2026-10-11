// Remote MCP over Streamable HTTP (stateless). `POST /mcp` with a JSON-RPC message and
// `Authorization: Bearer dbd_...`; the token is passed straight to the backend API, so
// permissions are exactly the token owner's. A fresh server is built per request, so
// nothing is shared between callers.

import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { DbDesignerApi } from './api';
import { createServer } from './server';

const MAX_BODY_BYTES = 30 * 1024 * 1024; // room for a base64 image (5 MB file) and JSON overhead

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

function rpcError(res: ServerResponse, status: number, code: number, message: string, headers = {}): void {
  send(res, status, { jsonrpc: '2.0', error: { code, message }, id: null }, headers);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error('Request body too large.');
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** The bearer token of a request (`Authorization: Bearer x`, or `X-Api-Token: x`). */
export function tokenOf(req: IncomingMessage): string | null {
  const auth = req.headers.authorization;
  const m = auth ? /^Bearer\s+(\S+)$/i.exec(auth.trim()) : null;
  const header = req.headers['x-api-token'];
  return m?.[1] ?? (typeof header === 'string' && header.trim() ? header.trim() : null);
}

export async function startHttp(options: { port: number; apiUrl: string }): Promise<void> {
  // Remote callers must not be able to read this machine's files or reach its network.
  process.env.DBDESIGNER_MCP_REMOTE = '1';

  const httpServer = createHttpServer(async (req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    try {
      if (path === '/health' || path === '/') {
        send(res, 200, { ok: true, name: 'dbdesigner-mcp', endpoint: '/mcp' });
        return;
      }
      if (path !== '/mcp') {
        send(res, 404, { error: 'Not found. The MCP endpoint is POST /mcp.' });
        return;
      }
      if (req.method !== 'POST') {
        rpcError(res, 405, -32000, 'Method not allowed. Send MCP messages with POST /mcp.', {
          Allow: 'POST',
        });
        return;
      }
      const token = tokenOf(req);
      if (!token) {
        rpcError(
          res,
          401,
          -32001,
          'Missing API token. Send "Authorization: Bearer dbd_..." (create one in DBDesigner: Account > API tokens).',
          { 'WWW-Authenticate': 'Bearer' },
        );
        return;
      }
      let body: unknown;
      try {
        body = await readJson(req);
      } catch (err) {
        rpcError(res, 400, -32700, `Invalid JSON body: ${(err as Error).message}`);
        return;
      }
      const server = createServer(new DbDesignerApi({ baseUrl: options.apiUrl, token }));
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      console.error('MCP request failed:', err);
      if (!res.headersSent) rpcError(res, 500, -32603, 'Internal server error.');
    }
  });

  // No host: Node binds the dual-stack wildcard (IPv6 + IPv4), which hosts such as Railway
  // need when their proxy reaches the service over an IPv6 private network.
  await new Promise<void>((resolve) => httpServer.listen(options.port, resolve));
  console.error(
    `DBDesigner MCP server ready (HTTP) on port ${options.port} (PORT=${process.env.PORT ?? "unset"}), POST /mcp, API ${options.apiUrl}`,
  );
}
