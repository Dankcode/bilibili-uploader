import { NextResponse } from 'next/server';
import { withOperator } from '@/lib/agent/auth';
import { applyMetadataStyleToVideo, getMetadataStyle, saveMetadataStyle } from '@/lib/operations/metadataStyle';
import { getSavedCreatorVideo } from '@/lib/video/scrapedCatalog';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function handleGET() {
  try { return NextResponse.json({ style: getMetadataStyle() }); }
  catch (error) { return NextResponse.json({ error: error.message }, { status: 500 }); }
}

// { prompt } saves the style. { action: 'apply', creatorId, bvid, prompt? } rewrites
// one saved video's metadata in it (the menu calls this once per listed video).
async function handlePOST(request) {
  try {
    const body = await request.json();
    if (body.action === 'apply') {
      const result = await applyMetadataStyleToVideo({ creatorId: body.creatorId, bvid: body.bvid, prompt: body.prompt, provider: body.provider || 'codex' });
      let video = null;
      try { video = getSavedCreatorVideo(result.creatorId, result.bvid); } catch { video = null; }
      return NextResponse.json({ result, video });
    }
    return NextResponse.json({ style: saveMetadataStyle(body.prompt) });
  } catch (error) { return NextResponse.json({ error: error.message }, { status: error.status || 500 }); }
}

export const GET = withOperator(handleGET);
export const POST = withOperator(handlePOST);
