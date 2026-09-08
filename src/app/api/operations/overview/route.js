import { NextResponse } from 'next/server';
import { listConnections } from '@/lib/pipeline/connections';
import { getOperationsOverview } from '@/lib/operations/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const connections = listConnections();
    const overview = getOperationsOverview();
    const proof = overview.faceSwapProof;
    const healthServices = [
      ['faceFusion', 'Face swap proof', proof?.status === 'passed' ? `Validated ${proof.outputProbe?.width || 0}x${proof.outputProbe?.height || 0} output` : 'Run a Face Fusion test before production jobs.'],
      ['sceneCut', 'Video renderer', 'FFmpeg edit and format pipeline'],
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
