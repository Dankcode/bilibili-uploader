import { CONNECTION_MODES, readRuntimeSettings } from './settings';

const REQUEST_HEADER_BLOCKLIST = new Set([
  'authorization',
  'connection',
  'content-length',
  'cookie',
  'host',
  'transfer-encoding',
]);

const RESPONSE_HEADERS = [
  'accept-ranges',
  'cache-control',
  'content-disposition',
  'content-length',
  'content-range',
  'content-type',
  'etag',
  'last-modified',
];

function requestHeaders(request, token) {
  const headers = new Headers();
  for (const [key, value] of request.headers.entries()) {
    if (!REQUEST_HEADER_BLOCKLIST.has(key.toLowerCase())) headers.set(key, value);
  }
  headers.set('authorization', `Bearer ${token}`);
  headers.set('x-video-ops-proxy', '1');
  return headers;
}

function responseHeaders(response) {
  const headers = new Headers();
  for (const key of RESPONSE_HEADERS) {
    const value = response.headers.get(key);
    if (value) headers.set(key, value);
  }
  return headers;
}

export function isRemoteBackend() {
  return readRuntimeSettings().connectionMode === CONNECTION_MODES.REMOTE;
}

export async function proxyBackendRequest(request, routePath) {
  if (request.headers.get('x-video-ops-local') === '1') return null;
  const settings = readRuntimeSettings();
  if (settings.connectionMode !== CONNECTION_MODES.REMOTE) return null;
  if (!settings.remoteUrl || !settings.remoteAuthToken) {
    return Response.json({ error: 'Remote backend settings are incomplete' }, { status: 503 });
  }

  const incomingUrl = new URL(request.url);
  const cleanPath = String(routePath || '').replace(/^\/+|\/+$/g, '');
  const target = `${settings.remoteUrl}/api/server/${cleanPath}${incomingUrl.search}`;
  const method = request.method.toUpperCase();
  const options = {
    method,
    headers: requestHeaders(request, settings.remoteAuthToken),
    cache: 'no-store',
  };
  if (!['GET', 'HEAD'].includes(method) && request.body) {
    options.body = request.body;
    options.duplex = 'half';
  }

  try {
    const response = await fetch(target, options);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders(response),
    });
  } catch (error) {
    return Response.json({
      error: `Remote backend unavailable: ${error.message}`,
      backendUrl: settings.remoteUrl,
    }, { status: 502 });
  }
}

export async function testRemoteBackend(settings, { timeoutMs = 8000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${settings.remoteUrl}/api/server/runtime/ping`, {
      headers: { authorization: `Bearer ${settings.remoteAuthToken}` },
      cache: 'no-store',
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Backend returned ${response.status}`);
    return payload;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Backend connection timed out');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
