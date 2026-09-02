import { NextResponse } from 'next/server';
import { listConnections } from '@/lib/pipeline/connections';
import { getOperationsOverview } from '@/lib/operations/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const connections = listConnections();
    const overview = getOperationsOverview();
    const byId = new Map(connections.map((connection) => [connection.serviceId, connection]));
    const proof = overview.faceSwapProof;
    return NextResponse.json({
      overview,
      health: [
        {
          id: 'faceFusion',
          label: 'Face swap proof',
          status: proof?.status === 'passed' ? 'ok' : proof?.status === 'failed' ? 'failed' : 'untested',
          detail: proof?.status === 'passed' ? `Validated ${proof.outputProbe?.width || 0}x${proof.outputProbe?.height || 0} output` : (proof?.error || 'Proof run required'),
        },
        {
          id: 'sceneCut',
          label: 'Video renderer',
          status: byId.get('sceneCut')?.status || 'untested',
          detail: byId.get('sceneCut')?.lastError || 'FFmpeg edit and format pipeline',
        },
        {
          id: 'metadata',
          label: 'Marketing metadata',
          status: byId.get('metadata')?.status || 'untested',
          detail: byId.get('metadata')?.lastError || 'Transcript analysis and packaging',
        },
        {
          id: 'youtube',
          label: 'Publishing',
          status: byId.get('youtube')?.status || 'untested',
          detail: byId.get('youtube')?.lastError || 'YouTube delivery connection',
        },
        {
          id: 'gmail',
          label: 'Gmail tracking',
          status: byId.get('gmail')?.status || 'untested',
          detail: byId.get('gmail')?.lastError || 'Optional non-blocking tracking and inbox sync',
        },
      ],
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
