import { withOperator } from '../../../../../../lib/agent/auth.js';
import { NextResponse } from 'next/server';
import { getVideoProcessGraph } from '@/lib/operations/store';

export const dynamic = 'force-dynamic';

async function handleGET(_request, { params: paramsPromise }) { const params = await paramsPromise;
  try {
    const payload = getVideoProcessGraph(params.id);
    if (!payload) return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export const GET = withOperator(handleGET);
