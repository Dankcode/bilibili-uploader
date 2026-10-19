export function isLoopbackHost(value) {
  return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(String(value || '').toLowerCase());
}

// Shared access means trusted operators sharing one workspace, not tenants.
export function resolveAccessPolicy(env = process.env) {
  const mode = String(env.VIDEO_ACCESS_MODE || 'local');
  if (!['local', 'shared', 'tailscale'].includes(mode)) throw new Error('VIDEO_ACCESS_MODE must be local, shared or tailscale.');
  const host = String(env.VIDEO_BIND_HOST || (mode === 'shared' ? '0.0.0.0' : '127.0.0.1'));
  if (mode === 'local' && !isLoopbackHost(host)) {
    throw new Error('Network binding requires explicit VIDEO_ACCESS_MODE=shared.');
  }
  return { mode, host, localPairing: false };
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
