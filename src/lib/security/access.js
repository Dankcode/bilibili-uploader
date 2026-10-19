export function isLoopbackHost(value) {
  return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(String(value || '').toLowerCase());
}

// Shared access means trusted operators sharing one workspace, not tenants.
export function resolveAccessPolicy(env = process.env, credentials = {}) {
  const mode = String(env.VIDEO_ACCESS_MODE || 'local');
  if (!['local', 'shared'].includes(mode)) throw new Error('VIDEO_ACCESS_MODE must be local or shared.');
  const host = String(env.VIDEO_BIND_HOST || (mode === 'shared' ? '0.0.0.0' : '127.0.0.1'));
  if (mode === 'local' && !isLoopbackHost(host)) {
    throw new Error('Network binding requires explicit VIDEO_ACCESS_MODE=shared.');
  }
  if (mode === 'shared') {
    const token = String(credentials.operatorToken || '');
    if (token.length < 32 || token === credentials.agentToken) {
      throw new Error('Shared access requires an operator token of at least 32 characters, distinct from the agent token. Run npm run mcp:setup or configure VIDEO_OPERATOR_TOKEN.');
    }
  }
  return { mode, host, localPairing: mode === 'local' && env.VIDEO_LOCAL_COOKIE_AUTH !== '0' };
}

export function loopbackRequestAllowed(request) {
  try {
    const target = new URL(request.url);
    const host = new URL(`${target.protocol}//${request.headers.get('host') || target.host}`);
    if (!isLoopbackHost(target.hostname) || !isLoopbackHost(host.hostname)) return false;
    if (request.headers.has('forwarded')) return false;
    const forwardedHost = request.headers.get('x-forwarded-host');
    if (forwardedHost && forwardedHost !== host.host) return false;
    const forwardedFor = request.headers.get('x-forwarded-for');
    return !forwardedFor || forwardedFor.split(',').every((ip) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip.trim()));
  } catch { return false; }
}
