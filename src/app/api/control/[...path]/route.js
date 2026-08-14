import { proxyBackendRequest } from '../../../../lib/runtime/backendProxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BLOCKED_PATHS = new Set(['control', 'runtime/settings', 'server']);

function forwardedHeaders(request) {
  const headers = new Headers();
  for (const [key, value] of request.headers.entries()) {
    if (!['connection', 'content-length', 'cookie', 'host', 'transfer-encoding'].includes(key.toLowerCase())) {
      headers.set(key, value);
    }
  }
  headers.set('x-video-ops-local', '1');
  return headers;
}

async function handle(request, context) {
  const routePath = (context.params.path || []).join('/').replace(/^\/+|\/+$/g, '');
  if (!routePath || [...BLOCKED_PATHS].some((blocked) => routePath === blocked || routePath.startsWith(`${blocked}/`))) {
    return Response.json({ error: 'This control route is not available' }, { status: 403 });
  }

  const proxied = await proxyBackendRequest(request, routePath);
  if (proxied) return proxied;

  const incomingUrl = new URL(request.url);
  const target = new URL(`/api/${routePath}${incomingUrl.search}`, incomingUrl.origin);
  const method = request.method.toUpperCase();
  const options = { method, headers: forwardedHeaders(request), cache: 'no-store' };
  if (!['GET', 'HEAD'].includes(method) && request.body) {
    options.body = request.body;
    options.duplex = 'half';
  }
  const response = await fetch(target, options);
  const headers = new Headers();
  for (const key of ['accept-ranges', 'cache-control', 'content-disposition', 'content-length', 'content-range', 'content-type', 'etag', 'last-modified']) {
    const value = response.headers.get(key);
    if (value) headers.set(key, value);
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
