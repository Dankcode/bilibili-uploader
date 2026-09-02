import { NextResponse } from 'next/server';
import { getYouTubeClientStatus, saveYouTubeClientSecret } from '@/lib/youtube/oauth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({ client: getYouTubeClientStatus() });
}

export async function POST(request) {
  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!file || typeof file.arrayBuffer !== 'function') {
      throw new Error('Choose a Google OAuth Desktop client JSON file first');
    }
    const result = saveYouTubeClientSecret(Buffer.from(await file.arrayBuffer()));
    return NextResponse.json({ client: result }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Could not save Google OAuth client configuration' }, { status: 400 });
  }
}
