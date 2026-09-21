import { withOperator } from '../../../../lib/agent/auth.js';
import { proxyBackendRequest } from '../../../../lib/runtime/backendProxy';
import { bridgeConfig, internalApiBase } from '../../../../lib/agent/auth.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BLOCKED_PATHS = new Set(['control', 'runtime/settings', 'server', 'agent', 'auth']);

function forwardedHeaders(request) {
  const headers = new Headers();
  for (const [key, value] of request.headers.entries()) {
    if (!['connection', 'content-length', 'cookie', 'host', 'transfer-encoding'].includes(key.toLowerCase())) {
      headers.set(key, value);
    }
  }
  headers.set('x-video-ops-local', '1');
  if (bridgeConfig().operatorToken) headers.set('authorization', `Bearer ${bridgeConfig().operatorToken}`);
  return headers;
}

async function handle(request, context) {
  const routePath = ((await context.params).path || []).join('/').replace(/^\/+|\/+$/g, '');
  if (!routePath || [...BLOCKED_PATHS].some((blocked) => routePath === blocked || routePath.startsWith(`${blocked}/`))) {
    return Response.json({ error: 'This control route is not available' }, { status: 403 });
  }

  const proxied = await proxyBackendRequest(request, routePath);
  if (proxied) return proxied;

  const incomingUrl = new URL(request.url);
  const target = new URL(`/api/${routePath}${incomingUrl.search}`, internalApiBase());
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

const handleGET = handle;
const handlePOST = handle;
const handlePUT = handle;
const handlePATCH = handle;
const handleDELETE = handle;
const handleOPTIONS = handle;

export const GET = withOperator(handleGET);
export const POST = withOperator(handlePOST);
export const PUT = withOperator(handlePUT);
export const PATCH = withOperator(handlePATCH);
export const DELETE = withOperator(handleDELETE);
export const OPTIONS = withOperator(handleOPTIONS);
