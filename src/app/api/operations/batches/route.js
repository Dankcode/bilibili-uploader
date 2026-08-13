import { NextResponse } from 'next/server';
import { createJobBatch } from '@/lib/pipeline/pipeline';
import { listAutomationBatches } from '@/lib/operations/store';

export async function GET(request) {
  try {
    const limit = new URL(request.url).searchParams.get('limit') || 20;
    return NextResponse.json({ batches: listAutomationBatches({ limit }) });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    return NextResponse.json({ batch: createJobBatch(await request.json()) });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
