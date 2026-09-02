import { NextResponse } from 'next/server';
import { completeWebYouTubeAuthorization } from '@/lib/youtube/oauth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request) {
  try {
    const body = await request.json();
    const youtubeAuthorization = await completeWebYouTubeAuthorization({
      state: body.state,
      code: body.code,
      error: body.error,
    });
    return NextResponse.json({ youtubeAuthorization });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Could not complete Google sign-in' }, { status: 400 });
  }
}
