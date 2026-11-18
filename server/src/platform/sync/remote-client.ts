import type { CurrentUserResponse, ProjectExportFile, ProjectSummary } from '@devdesigner/shared';

/** The remote could not be reached at all (offline, DNS, refused): not an error state. */
export class RemoteUnreachableError extends Error {}

/** The remote answered with a failure. */
export class RemoteHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Accepts an origin or an API base and returns the API base (…/api, no trailing slash). */
export function normalizeRemoteUrl(input: string): string {
  const url = new URL(input.trim());
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('The remote URL must be http(s).');
  }
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = path.endsWith('/api') ? path : `${path}/api`;
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/+$/, '');
}

/** The server origin (for the realtime socket) from an API base. */
export function remoteOrigin(apiBase: string): { origin: string; path: string } {
  const url = new URL(apiBase);
  const prefix = url.pathname.replace(/\/api$/, '');
  return { origin: url.origin, path: `${prefix}/socket.io` };
}

/** A raw HTTP answer from the remote, passed through to the desktop page. */
export interface ForwardedResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

/** Response headers worth passing back to the page. */
const PASS_HEADERS = [
  'content-type',
  'etag',
  'cache-control',
  'content-disposition',
  'retry-after',
];

/** Minimal client for a remote DevDesigner API, authenticated with an API token. */
export class RemoteClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  me(): Promise<CurrentUserResponse | null> {
    return this.request('GET', '/auth/me');
  }

  /** Every project the token's account owns (archived ones too). */
  async listProjects(): Promise<ProjectSummary[]> {
    const [active, archived] = await Promise.all([
      this.request<ProjectSummary[]>('GET', '/projects?archived=false'),
      this.request<ProjectSummary[]>('GET', '/projects?archived=true'),
    ]);
    return [...active, ...archived];
  }

  exportProject(projectId: string): Promise<ProjectExportFile> {
    return this.request('GET', `/projects/${encodeURIComponent(projectId)}/export-file`);
  }

  importProject(file: ProjectExportFile): Promise<ProjectSummary> {
    return this.request('POST', '/projects/import', file);
  }

  /** Make the remote project an exact, id-preserving copy of `file`. */
  async mirrorContent(projectId: string, file: ProjectExportFile): Promise<{ revision: number }> {
    try {
      return await this.request(
        'POST',
        `/projects/${encodeURIComponent(projectId)}/mirror-content`,
        file,
      );
    } catch (err) {
      throw explainMissingRoute(err);
    }
  }

  /**
   * Pass a page request through to the remote unchanged (method, path, query, body),
   * as the token's account. `clientId` is the relay socket's id, so the remote does
   * not echo the change back to this computer.
   */
  async forward(req: {
    method: string;
    path: string;
    body?: Buffer | string;
    contentType?: string;
    ifNoneMatch?: string;
    clientId?: string | null;
  }): Promise<ForwardedResponse> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${req.path}`, {
        method: req.method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/json',
          ...(req.contentType ? { 'Content-Type': req.contentType } : {}),
          ...(req.ifNoneMatch ? { 'If-None-Match': req.ifNoneMatch } : {}),
          ...(req.clientId ? { 'X-Client-Id': req.clientId } : {}),
        },
        body: req.body,
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      throw new RemoteUnreachableError(err instanceof Error ? err.message : String(err));
    }
    const headers: Record<string, string> = {};
    for (const name of PASS_HEADERS) {
      const value = res.headers.get(name);
      if (value) headers[name] = value;
    }
    return { status: res.status, headers, body: Buffer.from(await res.arrayBuffer()) };
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(120_000),
      });
    } catch (err) {
      throw new RemoteUnreachableError(err instanceof Error ? err.message : String(err));
    }
    if (!res.ok) {
      let message = `${res.status} ${res.statusText}`;
      try {
        const data = (await res.json()) as { message?: unknown };
        if (typeof data.message === 'string') message = data.message;
      } catch {
        // Non-JSON error body.
      }
      throw new RemoteHttpError(res.status, message);
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }
}

/**
 * Express's "Cannot POST …" 404 means the route itself is missing (an older server),
 * as opposed to a Nest 404 for a missing project.
 */
function explainMissingRoute(err: unknown): unknown {
  if (
    err instanceof RemoteHttpError &&
    err.status === 404 &&
    err.message.startsWith('Cannot POST')
  ) {
    return new RemoteHttpError(
      404,
      'This server runs an older DevDesigner that cannot sync with the desktop app yet. Update the server; ' +
        'your local changes are kept and are sent once it can receive them.',
    );
  }
  return err;
}
