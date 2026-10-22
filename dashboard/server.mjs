import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const defaultDist = resolve(dirname(fileURLToPath(import.meta.url)), 'dist');
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function cors(request, response) {
  const origin = request.headers.origin;
  response.setHeader('vary', 'Origin');
  if (!origin || !/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(origin)) return;
  try { new URL(origin); } catch { return; }
  response.setHeader('access-control-allow-origin', origin);
  if (request.method === 'OPTIONS') {
    response.setHeader('access-control-allow-methods', 'GET, POST, PUT, OPTIONS');
    response.setHeader('access-control-allow-headers', 'Authorization, Content-Type');
  }
}

function json(response, status, error) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify({ ok: false, error }));
}

// Configuration is read only by Node. Nothing from this object is served to the browser.
export function createDashboardServer({
  token = process.env.CONNECTOR_API_TOKEN ?? '',
  connectorUrl = process.env.CONNECTOR_URL ?? 'http://127.0.0.1:3210',
  distDir = defaultDist,
} = {}) {
  const server = createServer(async (request, response) => {
    cors(request, response);
    let url;
    try { url = new URL(request.url, 'http://localhost'); }
    catch { json(response, 400, 'INVALID_URL'); return; }
    if (url.pathname.startsWith('/api/')) {
      if (!token) { json(response, 503, 'CONNECTOR_NOT_CONFIGURED'); return; }
      if (!['GET', 'POST', 'PUT', 'OPTIONS'].includes(request.method)) {
        response.setHeader('allow', 'GET, POST, PUT, OPTIONS');
        json(response, 405, 'METHOD_NOT_ALLOWED');
        return;
      }
      try {
        const headers = { authorization: `Bearer ${token}` };
        if (request.headers['content-type']) headers['content-type'] = request.headers['content-type'];
        let body;
        if (request.method === 'POST' || request.method === 'PUT') {
          const chunks = [];
          let size = 0;
          for await (const chunk of request.iterator({ destroyOnReturn: false })) {
            size += chunk.length;
            if (size > 64 * 1024) {
              json(response, 413, 'BODY_TOO_LARGE');
              request.resume();
              return;
            }
            chunks.push(chunk);
          }
          body = Buffer.concat(chunks);
        }
        const upstream = await fetch(`${connectorUrl.replace(/\/+$/, '')}/${url.pathname.slice(5)}${url.search}`, {
          method: request.method, headers, body, redirect: 'error',
          signal: AbortSignal.timeout(120_000),
        });
        const bytes = Buffer.from(await upstream.arrayBuffer());
        response.writeHead(upstream.status, {
          'content-type': upstream.headers.get('content-type') ?? 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        });
        response.end(bytes);
      } catch {
        json(response, 502, 'CONNECTOR_UNAVAILABLE');
      }
      return;
    }
    if (!['GET', 'HEAD'].includes(request.method)) {
      json(response, 405, 'METHOD_NOT_ALLOWED');
      return;
    }
    try {
      const root = await realpath(distDir);
      const candidate = resolve(root, `.${decodeURIComponent(url.pathname)}`);
      if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
        json(response, 403, 'FORBIDDEN');
        return;
      }
      let file;
      let bytes;
      try {
        file = await realpath(candidate);
        if (file !== root && !file.startsWith(`${root}${sep}`)) {
          json(response, 403, 'FORBIDDEN');
          return;
        }
        bytes = await readFile(file);
      } catch {
        file = resolve(root, 'index.html');
        bytes = await readFile(file);
      }
      response.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream' });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch {
      json(response, 404, 'DASHBOARD_NOT_BUILT');
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createDashboardServer();
  const port = Number(process.env.PORT ?? 5210);
  server.on('error', error => {
    console.error(`Dashboard could not listen: ${error.code ?? 'UNKNOWN'}`);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => {
    console.info(`Hina Dashboard listening on http://127.0.0.1:${server.address().port}`);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => { server.close(); server.closeIdleConnections(); });
  }
}
