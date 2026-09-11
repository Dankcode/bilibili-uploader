import fs from 'node:fs';
import path from 'node:path';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getServerApiToken } from '../runtime/settings.js';

export function bridgeConfig() {
  const file = process.env.VIDEO_AGENT_CONFIG || path.join(process.cwd(), 'config/agent-bridge.json');
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return {
    agentToken: process.env.VIDEO_AGENT_TOKEN || saved.agentToken || '',
    operatorToken: process.env.VIDEO_OPERATOR_TOKEN || saved.operatorToken || getServerApiToken() || '',
  };
}

export function equalSecret(a, b) {
  const left = Buffer.from(String(a || '')); const right = Buffer.from(String(b || ''));
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
}

export function authRequired() { const config = bridgeConfig(); return Boolean(config.agentToken || config.operatorToken); }
export function bearer(request) { return (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, ''); }
export function isAgent(request) { return equalSecret(bearer(request), bridgeConfig().agentToken); }
export function operatorSession(token, expires = Date.now() + 12 * 60 * 60 * 1000) {
  return `${expires}.${createHmac('sha256', token).update(String(expires)).digest('hex')}`;
}
export function isOperator(request) {
  const { operatorToken, agentToken } = bridgeConfig();
  if (!operatorToken || equalSecret(operatorToken, agentToken) || isAgent(request)) return false;
  if (equalSecret(bearer(request), operatorToken) || equalSecret(bearer(request), getServerApiToken())) return true;
  const cookie = (request.headers.get('cookie') || '').split(';').map((part) => part.trim()).find((part) => part.startsWith('videops_operator='))?.slice(17);
  const expires = Number(cookie?.split('.')[0]);
  return expires > Date.now() && equalSecret(cookie, operatorSession(operatorToken, expires));
}
export function sameOrigin(request) {
  try {
    const origin = new URL(request.headers.get('origin'));
    const target = new URL(request.url);
    // Next reconstructs request.url with localhost on some local deployments.
    // Host is browser-controlled by the destination; do not trust forwarded-host.
    const host = request.headers.get('host') || target.host;
    return origin.protocol === target.protocol && origin.host === host;
  } catch { return false; }
}

// Every legacy API and server action is operator-only once the bridge is enabled.
// Headers such as x-video-ops-local are routing hints, never authentication.
export function operatorGuard(request) {
  if (!authRequired()) return null;
  if (!isOperator(request)) return Response.json({ error: 'Operator authentication required' }, { status: 401 });
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !bearer(request) && !sameOrigin(request)) {
    return Response.json({ error: 'Same-origin request required' }, { status: 403 });
  }
  return null;
}
export function withOperator(handler) {
  return async (request, context) => {
    request.headers.get('authorization'); // Prevent static caching, even before bridge setup.
    return operatorGuard(request) || handler(request, context);
  };
}
export function internalApiBase() {
  const port = String(process.env.PORT || '4455');
  if (!/^\d{1,5}$/.test(port) || Number(port) > 65535) throw new Error('Invalid application port');
  return `http://127.0.0.1:${port}`;
}
