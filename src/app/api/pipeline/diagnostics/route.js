import { withOperator } from '../../../../lib/agent/auth.js';
/**
 * /api/pipeline/diagnostics — troubleshooter feed + run preflight.
 * GET  → { checks: runDiagnostics() }                    (stored health + system checks)
 * POST { action:'refresh', serviceIds? }                 → refresh connection health
 * POST { steps:{ sourceId, processorIds[], uploaderId } }
 *      → { ready, steps } run-specific preflight before full automation.
 * SECURITY: strip LAN hostnames/ports from client-visible `detail`.
 */
import { NextResponse } from 'next/server';
import { refreshDiagnostics, runDiagnostics, runPreflight } from '../../../../lib/pipeline/diagnostics';

async function handleGET() {
  try {
    return NextResponse.json({ checks: await runDiagnostics() });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

async function handlePOST(request) {
  try {
    const body = await request.json();
    if (body.action === 'refresh') {
      return NextResponse.json({ checks: await refreshDiagnostics(body.serviceIds) });
    }
    return NextResponse.json(await runPreflight(body.steps || {}));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export const GET = withOperator(handleGET);
export const POST = withOperator(handlePOST);
