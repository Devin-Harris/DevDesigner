/** Thin REST client for the DevDesigner backend. Every call acts as the token's owner. */

import { AsyncLocalStorage } from 'node:async_hooks';

/** Reported in the User-Agent and the MCP server info. */
export const MCP_VERSION = '0.1.0';
export const MCP_USER_AGENT = `devdesigner-mcp/${MCP_VERSION}`;

/**
 * The MCP tool whose handler is running, per async call chain (tools of one
 * session can run concurrently). Sent as X-MCP-Tool so the API can attribute
 * requests to tools (analytics only; never trusted for authorization).
 */
const currentTool = new AsyncLocalStorage<string>();

/** Run `fn` with every API request it makes tagged with `tool`. */
export function runWithTool<T>(tool: string, fn: () => T): T {
  return currentTool.run(tool, fn);
}

/** Headers every request carries: auth, the realtime origin tag, user agent and tool name. */
export function baseHeaders(token: string): Record<string, string> {
  const tool = currentTool.getStore();
  return {
    Authorization: `Bearer ${token}`,
    'X-Client-Id': 'mcp-server',
    'User-Agent': MCP_USER_AGENT,
    ...(tool ? { 'X-MCP-Tool': tool } : {}),
  };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface ApiConfig {
  /** Base URL including the /api prefix, e.g. http://localhost:3000/api. */
  baseUrl: string;
  token: string;
}

/**
 * Normalise the configured API URL: trailing slashes dropped, and `/api` appended when
 * the URL is just a host (the backend serves everything under /api, so a bare host
 * would 404 with "Cannot GET /projects").
 */
export function normalizeApiUrl(raw: string): string {
  const url = raw.trim().replace(/\/+$/, '');
  try {
    return new URL(url).pathname.replace(/\/+$/, '') === '' ? `${url}/api` : url;
  } catch {
    return url;
  }
}

/** Read connection settings from the environment, failing with a helpful message. */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const token = env.DEVDESIGNER_API_TOKEN?.trim();
  if (!token) {
    throw new Error(
      'DEVDESIGNER_API_TOKEN is not set. Create an API token in DevDesigner (account settings) ' +
        'and pass it to the MCP server through this environment variable.',
    );
  }
  const baseUrl = normalizeApiUrl(env.DEVDESIGNER_API_URL ?? 'http://localhost:3000/api');
  return { baseUrl, token };
}

/** Image files are immutable (new bytes get a new id), so this cache never goes stale. */
const IMAGE_CACHE_BYTES = 64 * 1024 * 1024;

export class DevDesignerApi {
  /** Last body + ETag per GET path: unchanged reads come back as a cheap 304. */
  private readonly etags = new Map<string, { tag: string; text: string }>();
  private readonly images = new Map<string, { mimeType: string; data: Buffer }>();
  private imageBytes = 0;

  constructor(private readonly config: ApiConfig) {}

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }
  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body ?? {});
  }
  patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }
  put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PUT', path, body);
  }
  delete(path: string): Promise<void> {
    return this.request<void>('DELETE', path);
  }

  /** Raw bytes of a binary resource (e.g. an uploaded image) plus its content type. */
  async getBytes(path: string): Promise<{ mimeType: string; data: Buffer }> {
    const cached = this.images.get(path);
    if (cached) {
      // Re-insert to keep the map in least-recently-used order.
      this.images.delete(path);
      this.images.set(path, cached);
      return cached;
    }
    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}${path}`, {
        headers: baseHeaders(this.config.token),
      });
    } catch (err) {
      throw new ApiError(0, `Cannot reach the DevDesigner API at ${this.config.baseUrl} (${(err as Error).message}).`);
    }
    if (!response.ok) throw new ApiError(response.status, await describeFailure(response));
    const out = {
      mimeType: (response.headers.get('content-type') ?? 'application/octet-stream').split(';')[0].trim(),
      data: Buffer.from(await response.arrayBuffer()),
    };
    if (path.startsWith('/images/') && out.data.length <= IMAGE_CACHE_BYTES / 4) {
      this.images.set(path, out);
      this.imageBytes += out.data.length;
      for (const [k, v] of this.images) {
        if (this.imageBytes <= IMAGE_CACHE_BYTES) break;
        this.images.delete(k);
        this.imageBytes -= v.data.length;
      }
    }
    return out;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}${path}`, {
        method,
        headers: {
          ...baseHeaders(this.config.token),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(method === 'GET' && this.etags.has(path) ? { 'If-None-Match': this.etags.get(path)!.tag } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new ApiError(
        0,
        `Cannot reach the DevDesigner API at ${this.config.baseUrl} (${(err as Error).message}). ` +
          'Is the server running, and is DEVDESIGNER_API_URL correct?',
      );
    }
    if (method === 'GET' && response.status === 304) {
      const hit = this.etags.get(path);
      // Parse afresh: callers may mutate what they get back.
      if (hit) return JSON.parse(hit.text) as T;
    }
    if (!response.ok) {
      throw new ApiError(response.status, await describeFailure(response));
    }
    if (response.status === 204) {
      return undefined as T;
    }
    const text = await response.text();
    const tag = response.headers.get('etag');
    if (method === 'GET' && tag && text) {
      this.etags.delete(path);
      this.etags.set(path, { tag, text });
      if (this.etags.size > 20) this.etags.delete(this.etags.keys().next().value as string);
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }
}

async function describeFailure(response: Response): Promise<string> {
  let detail = response.statusText;
  try {
    const json = (await response.json()) as { message?: string | string[] };
    if (Array.isArray(json.message)) detail = json.message.join('; ');
    else if (json.message) detail = json.message;
  } catch {
    // keep statusText
  }
  switch (response.status) {
    case 401:
      return `Unauthorized: ${detail}. The API token may be invalid or revoked.`;
    case 403:
      return `Forbidden: ${detail}`;
    case 404:
      return `Not found: ${detail}`;
    case 429:
      return `Rate limited: ${detail}`;
    default:
      return `${response.status} ${detail}`;
  }
}
