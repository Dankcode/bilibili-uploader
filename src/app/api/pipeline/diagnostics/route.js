/**
 * /api/pipeline/diagnostics — troubleshooter feed + run preflight.
 * GET  → { checks: runDiagnostics() }                    (global health, read-only)
 * POST { steps:{ sourceId, processorIds[], uploaderId } }
 *      → { ready, steps } run-specific preflight before full automation.
 * SECURITY: strip LAN hostnames/ports from client-visible `detail`.
 */
import { NextResponse } from 'next/server';
import { runDiagnostics, runPreflight } from '../../../../lib/pipeline/diagnostics';

export async function GET() {
  try {
    return NextResponse.json({ checks: await runDiagnostics() });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    return NextResponse.json(await runPreflight(body.steps || {}));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
