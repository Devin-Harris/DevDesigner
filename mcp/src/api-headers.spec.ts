import { DevDesignerApi, MCP_USER_AGENT, runWithTool } from './api';

describe('DevDesignerApi headers', () => {
  const realFetch = global.fetch;
  let seen: Array<Record<string, string>>;

  beforeEach(() => {
    seen = [];
    global.fetch = jest.fn(async (_url: unknown, init?: { headers?: Record<string, string> }) => {
      seen.push(init?.headers ?? {});
      return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('sends the user agent always and X-MCP-Tool only inside a tool call', async () => {
    const api = new DevDesignerApi({ baseUrl: 'http://api.test/api', token: 'dd_x' });
    await api.get('/projects');
    await runWithTool('add_table', () => api.post('/projects/p1/tables', {}));
    expect(seen[0]['User-Agent']).toBe(MCP_USER_AGENT);
    expect(seen[0]['X-MCP-Tool']).toBeUndefined();
    expect(seen[1]).toMatchObject({ 'X-MCP-Tool': 'add_table', 'X-Client-Id': 'mcp-server', Authorization: 'Bearer dd_x' });
  });

  it('keeps concurrent tool calls apart', async () => {
    const api = new DevDesignerApi({ baseUrl: 'http://api.test/api', token: 'dd_x' });
    await Promise.all([
      runWithTool('list_projects', async () => {
        await new Promise((r) => setTimeout(r, 5));
        await api.get('/a');
      }),
      runWithTool('add_text', () => api.post('/b', {})),
    ]);
    expect(seen.map((h) => h['X-MCP-Tool']).sort()).toEqual(['add_text', 'list_projects']);
  });
});
