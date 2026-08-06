import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultConfigPath, loadConfig, normalizeConfig, saveConfig } from './config.js';
import { discoverRepos, expandHome } from './discover.js';
import { fetchRepo, mapLimit, readRepoStatus } from './git.js';

const PUBLIC_DIR = resolve(fileURLToPath(new URL('../public', import.meta.url)));
const MAX_BODY_BYTES = 1024 * 1024;
const HARD_BODY_LIMIT = 16 * MAX_BODY_BYTES;
const STATUS_CONCURRENCY = 8;
const FETCH_CONCURRENCY = 6;

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const tooLarge = () => rejectPromise(new HttpError(413, 'Request body too large'));
    const chunks: Buffer[] = [];
    let size = 0;
    let overflow = false;

    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        // Keep draining so the 413 reaches a client that is still uploading;
        // only hang up on a body large enough to look deliberate.
        overflow = true;
        chunks.length = 0;
        if (size > HARD_BODY_LIMIT) {
          tooLarge();
          req.destroy();
        }
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () =>
      overflow ? tooLarge() : resolvePromise(Buffer.concat(chunks).toString('utf8')),
    );
    req.on('error', rejectPromise);
  });
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const raw = await readBody(req);
  try {
    return JSON.parse(raw || '{}');
  } catch {
    throw new HttpError(400, 'Body is not valid JSON');
  }
}

async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new HttpError(400, 'Malformed URL');
  }

  const target = resolve(join(PUBLIC_DIR, decoded === '/' ? 'index.html' : decoded));
  // Everything served must sit inside public/ — no escaping via ../ or encoded variants.
  if (target !== PUBLIC_DIR && !target.startsWith(PUBLIC_DIR + sep)) {
    throw new HttpError(403, 'Forbidden');
  }

  let body: Buffer;
  try {
    body = await readFile(target);
  } catch {
    throw new HttpError(404, 'Not found');
  }

  res.writeHead(200, {
    'content-type': CONTENT_TYPES[extname(target)] ?? 'application/octet-stream',
    'content-length': body.length,
    // The app is served straight off disk on localhost; caching only ever
    // means running a stale module after an edit.
    'cache-control': 'no-store',
  });
  res.end(body);
}

export interface AppOptions {
  configPath?: string;
}

export function createApp(options: AppOptions = {}): Server {
  const configPath = options.configPath ?? defaultConfigPath();

  const scan = async () => {
    const config = await loadConfig(configPath);
    const discovered = await discoverRepos(config.roots);
    const hiddenSet = new Set(config.hidden);
    return { config, discovered, hiddenSet };
  };

  const handlers: Record<string, Record<string, (req: IncomingMessage) => Promise<unknown>>> = {
    '/api/config': {
      GET: async () => loadConfig(configPath),
      PUT: async (req) => saveConfig(configPath, normalizeConfig(await readJson(req))),
    },

    '/api/repos': {
      GET: async () => {
        const { config, discovered, hiddenSet } = await scan();
        const visible = discovered.filter((r) => !hiddenSet.has(r.path));
        return {
          roots: config.roots.map((r) => ({ configured: r, resolved: expandHome(r) })),
          repos: await mapLimit(visible, STATUS_CONCURRENCY, (r) => readRepoStatus(r.path)),
          hidden: discovered.filter((r) => hiddenSet.has(r.path)),
          scannedAt: Date.now(),
        };
      },
    },

    '/api/fetch': {
      POST: async (req) => {
        const body = (await readJson(req)) as { paths?: unknown };
        const { discovered, hiddenSet } = await scan();
        const known = new Map(discovered.map((r) => [r.path, r]));

        let targets: string[];
        if (body.paths === undefined) {
          targets = discovered.filter((r) => !hiddenSet.has(r.path)).map((r) => r.path);
        } else {
          if (!Array.isArray(body.paths)) throw new HttpError(400, '"paths" must be an array');
          targets = body.paths;
          // Only ever run git in a directory this scan actually found.
          const unknown = targets.find((p) => typeof p !== 'string' || !known.has(p));
          if (unknown !== undefined) {
            throw new HttpError(400, `Not a known repository: ${String(unknown)}`);
          }
        }

        return { results: await mapLimit(targets, FETCH_CONCURRENCY, (p) => fetchRepo(p)) };
      },
    },
  };

  return createServer((req, res) => {
    void (async () => {
      try {
        const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
        const route = handlers[pathname];

        if (!route) {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            throw new HttpError(405, 'Method not allowed');
          }
          await serveStatic(pathname, res);
          return;
        }

        const handler = route[req.method ?? ''];
        if (!handler) throw new HttpError(405, 'Method not allowed');
        sendJson(res, 200, await handler(req));
      } catch (error) {
        const status = error instanceof HttpError ? error.status : 500;
        const message = error instanceof Error ? error.message : 'Unknown error';
        if (status === 500) console.error('[git-status-gui]', error);
        if (!res.headersSent) sendJson(res, status, { error: message });
        else res.end();
      }
    })();
  });
}
