import { withOperator } from '../../../../../../../../../lib/agent/auth.js';
import { NextResponse } from 'next/server';
import { getVideoProcessStepLog } from '@/lib/operations/store';

export const dynamic = 'force-dynamic';

async function handleGET(_request, { params: paramsPromise }) { const params = await paramsPromise;
  const log = getVideoProcessStepLog(params.id, params.stepId);
  if (!log) return NextResponse.json({ error: 'Process step not found' }, { status: 404 });
  return NextResponse.json(log, { headers: { 'Cache-Control': 'no-store' } });
}

export const GET = withOperator(handleGET);
