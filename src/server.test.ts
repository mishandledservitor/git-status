import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { connect } from 'node:net';
import { join } from 'node:path';
import { createApp } from './server.js';
import { git, makeTempDir, removeDir, makeRepo, makeBareRemote, commit, write } from './testkit.js';

let dir: string;
let configPath: string;
let server: Server;
let base: string;

const api = async (path: string, init?: RequestInit) => {
  const res = await fetch(base + path, init);
  const text = await res.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body, headers: res.headers };
};

const put = (path: string, data: unknown) =>
  api(path, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  });

const post = (path: string, data: unknown) =>
  api(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  });

beforeAll(async () => {
  dir = await makeTempDir('gsg-server-');
  configPath = join(dir, 'config.json');

  const remote = await makeBareRemote(dir, 'remotes/one.git');
  const scan = join(dir, 'scan');
  await makeRepo(scan, 'one', { remote });
  const two = await makeRepo(scan, 'nested/two', {});
  await write(two, 'scratch.txt', 'dirty');

  server = createApp({ configPath });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (typeof addr === 'string' || addr === null) throw new Error('no address');
  base = `http://127.0.0.1:${addr.port}`;

  await put('/api/config', { roots: [scan], hidden: [] });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await removeDir(dir);
});

describe('static files', () => {
  it('serves the app shell at /', async () => {
    const res = await fetch(base + '/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('<div id="app"');
  });

  it('serves the stylesheet and scripts with correct content types', async () => {
    const css = await fetch(base + '/style.css');
    expect(css.status).toBe(200);
    expect(css.headers.get('content-type')).toContain('text/css');

    const js = await fetch(base + '/app.js');
    expect(js.status).toBe(200);
    expect(js.headers.get('content-type')).toContain('javascript');
  });

  it('does not let the browser cache the app, so an updated build is never stale', async () => {
    for (const path of ['/', '/app.js', '/format.js', '/style.css']) {
      const res = await fetch(base + path);
      expect(res.headers.get('cache-control'), path).toBe('no-store');
    }
  });

  it('404s unknown paths', async () => {
    expect((await api('/nope')).status).toBe(404);
  });

  it('refuses path traversal out of the public directory', async () => {
    for (const path of ['/..%2Fpackage.json', '/%2e%2e/package.json', '/%2e%2e%2fpackage.json']) {
      const res = await fetch(base + path, { redirect: 'manual' });
      expect(res.status, path).toBeGreaterThanOrEqual(400);
    }
  });

  it('refuses a raw ../ request line that never passes through URL normalisation', async () => {
    // fetch() collapses `..` client-side, so the server-side guard has to be
    // driven over a bare socket to be exercised at all.
    const { port } = server.address() as AddressInfo;
    const raw = await new Promise<string>((resolvePromise, rejectPromise) => {
      const socket = connect(port, '127.0.0.1', () => {
        socket.write('GET /../package.json HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
      });
      let data = '';
      socket.on('data', (chunk) => (data += chunk));
      socket.on('end', () => resolvePromise(data));
      socket.on('error', rejectPromise);
    });

    expect(raw).toMatch(/^HTTP\/1\.1 (400|403|404)/);
    expect(raw).not.toContain('"name": "git-status-gui"');
  });
});

describe('GET/PUT /api/config', () => {
  it('returns the current config', async () => {
    const { status, body } = await api('/api/config');
    expect(status).toBe(200);
    expect(body.roots).toHaveLength(1);
    expect(body.hidden).toEqual([]);
  });

  it('persists an updated config', async () => {
    const scan = (await api('/api/config')).body.roots[0];
    const res = await put('/api/config', { roots: [scan], hidden: ['/some/repo'] });
    expect(res.status).toBe(200);
    expect((await api('/api/config')).body.hidden).toEqual(['/some/repo']);
    await put('/api/config', { roots: [scan], hidden: [] });
  });

  it('rejects a malformed body with 400 and leaves config untouched', async () => {
    const before = (await api('/api/config')).body;
    const res = await api('/api/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: '{ not json',
    });
    expect(res.status).toBe(400);
    expect((await api('/api/config')).body).toEqual(before);
  });

  it('rejects an oversized body', async () => {
    const res = await put('/api/config', { roots: ['x'.repeat(2_000_000)], hidden: [] });
    expect(res.status).toBe(413);
  });
});

describe('GET /api/repos', () => {
  it('returns a status for every discovered repo', async () => {
    const { status, body } = await api('/api/repos');
    expect(status).toBe(200);
    expect(body.repos.map((r: any) => r.name).sort()).toEqual(['one', 'two']);
    expect(body.scannedAt).toBeTypeOf('number');
  });

  it('includes branch, divergence and dirtiness for each repo', async () => {
    const { body } = await api('/api/repos');
    const one = body.repos.find((r: any) => r.name === 'one');
    expect(one.branch).toBe('main');
    expect(one.upstream).toEqual({ name: 'origin/main', ahead: 0, behind: 0, gone: false });

    const two = body.repos.find((r: any) => r.name === 'two');
    expect(two.dirty.untracked).toBe(1);
  });

  it('omits hidden repos from repos but still lists them for the settings panel', async () => {
    const cfg = (await api('/api/config')).body;
    const two = (await api('/api/repos')).body.repos.find((r: any) => r.name === 'two');

    await put('/api/config', { roots: cfg.roots, hidden: [two.path] });
    const { body } = await api('/api/repos');
    expect(body.repos.map((r: any) => r.name)).toEqual(['one']);
    expect(body.hidden.map((r: any) => r.name)).toEqual(['two']);

    await put('/api/config', cfg);
  });

  it('reports an unreadable root without failing the whole request', async () => {
    const cfg = (await api('/api/config')).body;
    await put('/api/config', { roots: [...cfg.roots, '/no/such/root'], hidden: [] });

    const { status, body } = await api('/api/repos');
    expect(status).toBe(200);
    expect(body.repos).toHaveLength(2);

    await put('/api/config', cfg);
  });

  it('is a read-only operation: it never mutates the repos it inspects', async () => {
    const scan = (await api('/api/config')).body.roots[0];
    const repo = join(scan, 'one');
    const before = await git(repo, 'rev-parse', 'HEAD');
    await api('/api/repos');
    expect(await git(repo, 'rev-parse', 'HEAD')).toBe(before);
  });
});

describe('POST /api/fetch', () => {
  it('fetches the requested repos and reports per-repo results', async () => {
    const scan = (await api('/api/config')).body.roots[0];
    const repo = join(scan, 'one');
    const { status, body } = await post('/api/fetch', { paths: [repo] });

    expect(status).toBe(200);
    expect(body.results).toEqual([{ path: repo, ok: true, error: null }]);
  });

  it('picks up commits pushed to the remote by someone else', async () => {
    const scan = (await api('/api/config')).body.roots[0];
    const repo = join(scan, 'one');
    const other = await makeRepo(dir, 'collaborator', {});
    await git(other, 'remote', 'add', 'origin', join(dir, 'remotes/one.git'));
    await git(other, 'fetch', 'origin');
    await git(other, 'reset', '--hard', 'origin/main');
    await commit(other, 'from-collaborator');
    await git(other, 'push', 'origin', 'main');

    await post('/api/fetch', { paths: [repo] });

    const one = (await api('/api/repos')).body.repos.find((r: any) => r.name === 'one');
    expect(one.upstream.behind).toBe(1);
    expect(one.lastFetch).toBeTypeOf('number');
  });

  it('fetches every visible repo when no paths are given', async () => {
    const { status, body } = await post('/api/fetch', {});
    expect(status).toBe(200);
    expect(body.results).toHaveLength(2);
  });

  it('refuses to fetch a path outside the configured roots', async () => {
    const { status } = await post('/api/fetch', { paths: ['/etc'] });
    expect(status).toBe(400);
  });

  it('refuses a path that is not a discovered repo', async () => {
    const scan = (await api('/api/config')).body.roots[0];
    const { status } = await post('/api/fetch', { paths: [join(scan, 'not-a-repo')] });
    expect(status).toBe(400);
  });
});

describe('method handling', () => {
  it('405s a wrong method on an API route', async () => {
    expect((await api('/api/repos', { method: 'DELETE' })).status).toBe(405);
  });
});
