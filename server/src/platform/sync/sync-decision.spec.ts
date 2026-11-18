import { decideReconnect } from './sync-decision';
import { normalizeRemoteUrl, RemoteClient, remoteOrigin } from './remote-client';

describe('decideReconnect', () => {
  it.each([
    ['live', false, false, 'none'],
    ['live', false, true, 'pull'],
    ['offline', false, true, 'pull'],
    ['offline', true, false, 'push'],
    ['offline', true, true, 'conflict'],
    ['conflict', true, true, 'wait'],
    ['conflict', false, false, 'wait'],
  ] as const)('%s, local %s, remote %s -> %s', (status, localChanged, remoteChanged, step) => {
    expect(decideReconnect({ status, localChanged, remoteChanged })).toBe(step);
  });
});

describe('normalizeRemoteUrl', () => {
  it.each([
    ['https://dd.example.com', 'https://dd.example.com/api'],
    ['https://dd.example.com/', 'https://dd.example.com/api'],
    ['https://dd.example.com/api/', 'https://dd.example.com/api'],
    ['http://192.168.1.20:3000?x=1', 'http://192.168.1.20:3000/api'],
  ])('%s -> %s', (input, out) => {
    expect(normalizeRemoteUrl(input)).toBe(out);
  });

  it('rejects other protocols', () => {
    expect(() => normalizeRemoteUrl('ftp://x')).toThrow();
  });
});

describe('remoteOrigin', () => {
  it('finds the realtime origin and socket path of an API base', () => {
    expect(remoteOrigin('https://dd.example.com/api')).toEqual({
      origin: 'https://dd.example.com',
      path: '/socket.io',
    });
    expect(remoteOrigin('http://host:3000/dd/api')).toEqual({
      origin: 'http://host:3000',
      path: '/dd/socket.io',
    });
  });
});

describe('RemoteClient.mirrorContent', () => {
  const respond = (status: number, body: unknown) =>
    (async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })) as unknown as typeof fetch;
  const file = {} as never;

  it('explains a server that predates desktop sync', async () => {
    const client = new RemoteClient(
      'https://old/api',
      't',
      respond(404, { message: 'Cannot POST /api/projects/x/mirror-content' }),
    );
    await expect(client.mirrorContent('x', file)).rejects.toThrow(/older DevDesigner/);
  });

  it('passes other 404s through (missing project)', async () => {
    const client = new RemoteClient(
      'https://new/api',
      't',
      respond(404, { message: 'Project x not found.' }),
    );
    await expect(client.mirrorContent('x', file)).rejects.toThrow('Project x not found.');
  });
});
