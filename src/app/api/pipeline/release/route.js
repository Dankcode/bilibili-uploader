import { withOperator } from '../../../../lib/agent/auth.js';
/**
 * /api/pipeline/release — the release layer's Publish view.
 * GET                                   → { budgets, queue, receipts, needsAttention }
 * POST { action: 'resolveReceipt', receiptId, resolution: 'confirm'|'abandon', url? }
 */
import { NextResponse } from 'next/server.js';
import { getReleaseOverview, resolveReceipt } from '../../../../lib/release/service';

export const dynamic = 'force-dynamic';

async function handleGET() {
  return NextResponse.json(getReleaseOverview());
}

async function handlePOST(request) {
  try {
    const body = await request.json();
    if (body.action === 'resolveReceipt') {
      return NextResponse.json({ receipt: resolveReceipt(body.receiptId, { action: body.resolution, url: body.url }) });
    }
    return NextResponse.json({ error: 'Unknown action. Valid actions: resolveReceipt' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: error.status || 400 });
  }
}

export const GET = withOperator(handleGET);
export const POST = withOperator(handlePOST);
