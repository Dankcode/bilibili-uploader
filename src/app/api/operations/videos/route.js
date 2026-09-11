import { withOperator } from '../../../../lib/agent/auth.js';
import { NextResponse } from 'next/server';
import { withVersion } from '../../../../lib/agent/concurrency.js';
import { listVideoOperations, updateVideoRecord } from '@/lib/operations/store';

async function handleGET(request) {
  try {
    const params = new URL(request.url).searchParams;
    return NextResponse.json(listVideoOperations({
      status: params.get('status') || '',
      query: params.get('query') || '',
      limit: params.get('limit') || 50,
      offset: params.get('offset') || 0,
    }));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

async function handlePATCH(request) {
  try {
    const body = await request.json();
    if (!body.videoId) throw new Error('videoId is required');
    return NextResponse.json({ video: withVersion('video_records', 'id = ?', [body.videoId], request.headers.get('if-match'), () => updateVideoRecord(body.videoId, body.patch || {})) });
  } catch (error) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status || 400 });
  }
}

export const GET = withOperator(handleGET);
export const PATCH = withOperator(handlePATCH);
