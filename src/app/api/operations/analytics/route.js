import { withOperator } from '../../../../lib/agent/auth.js';
import { NextResponse } from 'next/server';
import { getVideoAnalytics, recordMetricSnapshot } from '@/lib/operations/store';

async function handleGET() {
  try {
    return NextResponse.json(getVideoAnalytics());
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

async function handlePOST(request) {
  try {
    const body = await request.json();
    if (!body.publicationId) throw new Error('publicationId is required');
    const snapshotId = recordMetricSnapshot(body.publicationId, body.metrics || {}, body.capturedAt);
    return NextResponse.json({ snapshotId, analytics: getVideoAnalytics() });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export const GET = withOperator(handleGET);
export const POST = withOperator(handlePOST);
