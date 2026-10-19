import fs from 'node:fs';
import path from 'node:path';
import { isIP } from 'node:net';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getServerApiToken } from '../runtime/settings.js';

export function bridgeConfig() {
  const file = process.env.VIDEO_AGENT_CONFIG || path.join(process.cwd(), 'config/agent-bridge.json');
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* Legacy credentials are optional. */ }
  return {
    agentToken: process.env.VIDEO_AGENT_TOKEN || saved.agentToken || '',
    operatorToken: process.env.VIDEO_OPERATOR_TOKEN || saved.operatorToken || getServerApiToken() || '',
  };
}

export function equalSecret(a, b) {
  const left = Buffer.from(String(a || '')); const right = Buffer.from(String(b || ''));
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
}

// Retained for older integrations; the app no longer requires a sign-in.
export function authRequired() { return false; }
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

// No automatic pairing or operator cookie is needed.
export function localCookiePairingAllowed(request) {
  return false;
}

// Compatibility wrapper for existing route declarations.
export function operatorGuard(request) {
  // Single-owner deployment: access is controlled by the listener/Tailscale,
  // not app-level roles, cookies, tokens, Host or Origin checks.
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
  // A Tailscale-only listener does not accept loopback connections.
  const configured = String(process.env.VIDEO_BIND_HOST || '').trim();
  const host = isIP(configured) && !['0.0.0.0', '::'].includes(configured) ? configured : '127.0.0.1';
  return `http://${isIP(host) === 6 ? `[${host}]` : host}:${port}`;
}
