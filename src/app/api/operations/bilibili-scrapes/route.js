import { withOperator } from '../../../../lib/agent/auth.js';
import { NextResponse } from 'next/server';
import { withVersion } from '../../../../lib/agent/concurrency.js';
import { listScrapedBilibiliVideos, updateScrapedBilibiliVideo } from '@/lib/video/scrapedCatalog';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function handleGET(request) {
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

async function handlePATCH(request) {
  try {
    const body = await request.json();
    const video = withVersion('bilibili_scraped_videos', 'creator_id = ? AND bvid = ?', [body.creatorId, body.bvid], request.headers.get('if-match'), () => updateScrapedBilibiliVideo(body));
    return NextResponse.json({ video });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Could not update scraped Bilibili video', code: error.code }, { status: error.status || 400 });
  }
}

export const GET = withOperator(handleGET);
export const PATCH = withOperator(handlePATCH);
