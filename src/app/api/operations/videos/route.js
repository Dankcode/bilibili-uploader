import { NextResponse } from 'next/server';
import { listVideoOperations, updateVideoRecord } from '@/lib/operations/store';

export async function GET(request) {
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

export async function PATCH(request) {
  try {
    const body = await request.json();
    if (!body.videoId) throw new Error('videoId is required');
    return NextResponse.json({ video: updateVideoRecord(body.videoId, body.patch || {}) });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
