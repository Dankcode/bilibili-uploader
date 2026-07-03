/**
 * /api/pipeline/diagnostics — troubleshooter feed.
 * GET → { checks: runDiagnostics() }. Read-only.
 * SECURITY: strip LAN hostnames/ports from client-visible `detail`.
 */
import { NextResponse } from 'next/server';
import { runDiagnostics } from '../../../../lib/pipeline/diagnostics';

export async function GET() {
  try {
    return NextResponse.json({ checks: await runDiagnostics() });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
