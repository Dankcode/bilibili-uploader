import fs from 'node:fs';
import path from 'node:path';
import { isIP } from 'node:net';
import { timingSafeEqual } from 'node:crypto';
import { getServerApiToken } from '../runtime/settings.js';

// Single-owner deployment: access is controlled by the listener and Tailscale.
// Optional legacy tokens are read only so their values can be redacted from logs.
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

export function bearer(request) { return (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, ''); }

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
