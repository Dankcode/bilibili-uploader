import { authRequired, bridgeConfig, equalSecret, isOperator, operatorSession, sameOrigin } from '../../../../lib/agent/auth.js';
export const dynamic = 'force-dynamic';
export async function GET(request) { return Response.json({ required: authRequired(), authenticated: isOperator(request) }); }
export async function POST(request) {
  if (!sameOrigin(request)) return Response.json({ error: 'Same-origin request required' }, { status: 403 });
  const { token } = await request.json();
  const { operatorToken, agentToken } = bridgeConfig();
  if (!equalSecret(token, operatorToken) || equalSecret(token, agentToken)) return Response.json({ error: 'Invalid operator token' }, { status: 401 });
  // Lax preserves the authenticated top-level return from Google OAuth. Cookie
  // mutations still require an exact same-origin Origin in operatorGuard.
  return Response.json({ authenticated: true }, { headers: { 'set-cookie': `videops_operator=${operatorSession(operatorToken)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}` } });
}
