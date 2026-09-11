import { withOperator, bridgeConfig } from '../../../../lib/agent/auth.js';
import { listAgentActions } from '../../../../lib/agent/service.js';
export const dynamic = 'force-dynamic';
export const GET = withOperator(async (request) => {
  const cursor = new URL(request.url).searchParams.get('cursor') || '0';
  if (!/^\d{1,10}$/.test(cursor)) return Response.json({ error: 'Invalid cursor' }, { status: 400 });
  return Response.json({ ...listAgentActions(cursor), enabled: Boolean(bridgeConfig().agentToken) });
});
