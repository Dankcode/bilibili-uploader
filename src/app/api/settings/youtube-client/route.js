import { withOperator } from '../../../../lib/agent/auth.js';
import { NextResponse } from 'next/server';
import { getYouTubeClientStatus, saveYouTubeClientSecret } from '@/lib/youtube/oauth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function handleGET() {
  return NextResponse.json({ client: getYouTubeClientStatus() });
}

async function handlePOST(request) {
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

export const GET = withOperator(handleGET);
export const POST = withOperator(handlePOST);
