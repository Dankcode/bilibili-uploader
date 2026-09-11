import { withOperator } from '../../../../lib/agent/auth.js';
import { timingSafeEqual } from 'crypto';
import { bridgeConfig, internalApiBase } from '../../../../lib/agent/auth.js';
import { getServerApiToken, readRuntimeSettings } from '../../../../lib/runtime/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BLOCKED_PATHS = new Set(['runtime/settings', 'server', 'control', 'agent', 'auth']);
const FORWARDED_RESPONSE_HEADERS = [
  'accept-ranges',
  'cache-control',
  'content-disposition',
  'content-length',
  'content-range',
  'content-type',
  'etag',
  'last-modified',
];

function authorized(request) {
  const expected = getServerApiToken();
  const supplied = String(request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!expected || !supplied) return false;
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer);
}

function safeHeaders(request) {
  const headers = new Headers();
  for (const [key, value] of request.headers.entries()) {
    if (!['authorization', 'connection', 'content-length', 'cookie', 'host', 'transfer-encoding'].includes(key.toLowerCase())) {
      headers.set(key, value);
    }
  }
  headers.set('x-video-ops-local', '1');
  if (bridgeConfig().operatorToken) headers.set('authorization', `Bearer ${bridgeConfig().operatorToken}`);
  return headers;
}

async function ping() {
  const { getDatabaseStatus } = await import('../../../../lib/db/sqlite');
  const database = getDatabaseStatus();
  const activeWorker = database.workers.find((worker) => worker.online) || null;
  return Response.json({
    ok: true,
    service: 'video-automation-backend',
    now: new Date().toISOString(),
    database,
    worker: activeWorker,
    runtime: {
      connectionMode: readRuntimeSettings().connectionMode,
      processRole: process.env.VIDEO_PROCESS_ROLE || 'frontend',
    },
  });
}

async function handle(request, context) {
  if (!authorized(request)) {
    return Response.json({
      error: getServerApiToken()
        ? 'Invalid backend access token'
        : 'Backend access token is not configured on this server',
    }, { status: getServerApiToken() ? 401 : 503 });
  }

  const routePath = (context.params.path || []).join('/').replace(/^\/+|\/+$/g, '');
  if (!routePath || [...BLOCKED_PATHS].some((blocked) => routePath === blocked || routePath.startsWith(`${blocked}/`))) {
    return Response.json({ error: 'This backend route is not exposed' }, { status: 403 });
  }
  if (routePath === 'runtime/ping') return ping();

  const incomingUrl = new URL(request.url);
  const target = new URL(`/api/${routePath}${incomingUrl.search}`, internalApiBase());
  const method = request.method.toUpperCase();
  const options = {
    method,
    headers: safeHeaders(request),
    cache: 'no-store',
  };
  if (!['GET', 'HEAD'].includes(method) && request.body) {
    options.body = request.body;
    options.duplex = 'half';
  }
  const response = await fetch(target, options);
  const headers = new Headers();
  for (const key of FORWARDED_RESPONSE_HEADERS) {
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
