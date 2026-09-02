import { NextResponse } from 'next/server';
import { getVideoProcessStepLog } from '@/lib/operations/store';

export const dynamic = 'force-dynamic';

export async function GET(_request, { params }) {
  const log = getVideoProcessStepLog(params.id, params.stepId);
  if (!log) return NextResponse.json({ error: 'Process step not found' }, { status: 404 });
  return NextResponse.json(log, { headers: { 'Cache-Control': 'no-store' } });
}
