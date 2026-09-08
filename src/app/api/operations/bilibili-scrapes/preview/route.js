import { NextResponse } from 'next/server';
import { previewScrapedBilibiliMetadata } from '@/lib/video/scrapedCatalog';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/operations/bilibili-scrapes/preview
 *
 * Produces and persists a non-dispatching AI title/description/tags preview.
 * The same authenticated control route is available to Codex at
 * /api/control/operations/bilibili-scrapes/preview.
 */
export async function POST(request) {
  try {
    return NextResponse.json({ video: await previewScrapedBilibiliMetadata(await request.json()) });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Could not generate AI metadata preview' }, { status: 400 });
  }
}
