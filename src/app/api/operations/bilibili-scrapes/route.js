import { NextResponse } from 'next/server';
import { listScrapedBilibiliVideos, updateScrapedBilibiliVideo } from '@/lib/video/scrapedCatalog';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request) {
  try {
    const params = new URL(request.url).searchParams;
    return NextResponse.json(listScrapedBilibiliVideos({
      creatorId: params.get('creatorId') || '', query: params.get('query') || '', limit: params.get('limit') || 100,
      includeUploaded: ['1', 'true'].includes(String(params.get('includeUploaded') || '').toLowerCase()),
    }));
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Could not load scraped Bilibili videos' }, { status: 400 });
  }
}

export async function PATCH(request) {
  try {
    return NextResponse.json({ video: updateScrapedBilibiliVideo(await request.json()) });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Could not update scraped Bilibili video' }, { status: 400 });
  }
}
