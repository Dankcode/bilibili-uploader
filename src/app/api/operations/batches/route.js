import { withOperator } from '../../../../lib/agent/auth.js';
import { NextResponse } from 'next/server';
import { createJobBatch } from '@/lib/pipeline/pipeline';
import { listAutomationBatches } from '@/lib/operations/store';

async function handleGET(request) {
  try {
    const limit = new URL(request.url).searchParams.get('limit') || 20;
    return NextResponse.json({ batches: listAutomationBatches({ limit }) });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

async function handlePOST(request) {
  try {
    return NextResponse.json({ batch: createJobBatch(await request.json()) });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export const GET = withOperator(handleGET);
export const POST = withOperator(handlePOST);
