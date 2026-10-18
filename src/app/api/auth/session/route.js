import { authRequired, bridgeConfig, equalSecret, isOperator, localCookiePairingAllowed, operatorSession, sameOrigin } from '../../../../lib/agent/auth.js';
export const dynamic = 'force-dynamic';
export async function GET(request) { return Response.json({ required: authRequired(), authenticated: isOperator(request), localPairing: localCookiePairingAllowed(request) }, { headers: { 'Cache-Control': 'no-store' } }); }
export async function POST(request) {
  if (!sameOrigin(request)) return Response.json({ error: 'Same-origin request required' }, { status: 403 });
  const { token, action } = await request.json();
  const { operatorToken, agentToken } = bridgeConfig();
  const localPairing = action === 'pair-local' && localCookiePairingAllowed(request);
  if (action === 'pair-local' && !localPairing) return Response.json({ error: 'Automatic pairing is available only on a loopback-bound local server.' }, { status: 403 });
  if (!operatorToken || equalSecret(operatorToken, agentToken) || (!localPairing && !equalSecret(token, operatorToken))) return Response.json({ error: 'Invalid operator token' }, { status: 401 });
  // Lax preserves the authenticated top-level return from Google OAuth. Cookie
  // mutations still require an exact same-origin Origin in operatorGuard.
  const maxAge = 30 * 24 * 60 * 60;
  return Response.json({ authenticated: true }, { headers: { 'Cache-Control': 'no-store', 'set-cookie': `videops_operator=${operatorSession(operatorToken, Date.now() + maxAge * 1000)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}` } });
}
