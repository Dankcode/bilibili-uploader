import { withOperator } from '../../../../lib/agent/auth.js';
import { NextResponse } from 'next/server';
import { listConnections } from '@/lib/pipeline/connections';
import { getOperationsOverview } from '@/lib/operations/store';

export const dynamic = 'force-dynamic';

async function handleGET() {
  try {
    const connections = listConnections();
    const overview = getOperationsOverview();
    const healthServices = [
      ['videoEditor', 'Video Editor MCP', 'Video creation and rendering in video-automation'],
      ['metadata', 'Marketing metadata', 'Transcript analysis and packaging'],
      ['youtube', 'Publishing', 'YouTube delivery connection'],
      ['gmail', 'Gmail tracking', 'Optional non-blocking tracking and inbox sync'],
    ];
    return NextResponse.json({
      overview,
      health: healthServices.map(([id, label, fallback]) => {
        const connection = connections.find((entry) => entry.serviceId === id);
        return {
          id,
          label,
          configured: Boolean(connection?.configured),
          status: connection?.status || 'untested',
          authState: connection?.authState || 'unknown',
          checkedAt: connection?.checkedAt || '',
          detail: connection?.lastError || fallback,
        };
      }),
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export const GET = withOperator(handleGET);
