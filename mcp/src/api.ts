/** Thin REST client for the DBDesigner backend. Every call acts as the token's owner. */

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

/** Read connection settings from the environment, failing with a helpful message. */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const token = env.DBDESIGNER_API_TOKEN?.trim();
  if (!token) {
    throw new Error(
      'DBDESIGNER_API_TOKEN is not set. Create an API token in DBDesigner (account settings) ' +
        'and pass it to the MCP server through this environment variable.',
    );
  }
  const baseUrl = (env.DBDESIGNER_API_URL ?? 'http://localhost:3000/api').replace(/\/+$/, '');
  return { baseUrl, token };
}

export class DbDesignerApi {
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
  delete(path: string): Promise<void> {
    return this.request<void>('DELETE', path);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          'X-Client-Id': 'mcp-server',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new ApiError(
        0,
        `Cannot reach the DBDesigner API at ${this.config.baseUrl} (${(err as Error).message}). ` +
          'Is the server running, and is DBDESIGNER_API_URL correct?',
      );
    }
    if (!response.ok) {
      throw new ApiError(response.status, await describeFailure(response));
    }
    if (response.status === 204) {
      return undefined as T;
    }
    const text = await response.text();
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
