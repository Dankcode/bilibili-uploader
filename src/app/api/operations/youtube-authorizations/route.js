import { withOperator } from '../../../../lib/agent/auth.js';
import { NextResponse } from 'next/server';
import {
  listYouTubeAuthorizations,
  registerYouTubeAuthorization,
  updateYouTubeAuthorization,
} from '@/lib/youtube/authorizations';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function handleGET() {
  return NextResponse.json({ authorizations: listYouTubeAuthorizations() });
}

async function handlePOST(request) {
  try {
    const authorization = registerYouTubeAuthorization(await request.json());
    return NextResponse.json({ authorization }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Could not register YouTube authorization' }, { status: 400 });
  }
}

async function handlePATCH(request) {
  try {
    const body = await request.json();
    if (!body.id) throw new Error('Authorization id is required');
    const authorization = updateYouTubeAuthorization(body.id, body);
    return NextResponse.json({ authorization });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Could not update YouTube authorization' }, { status: 400 });
  }
}

export const GET = withOperator(handleGET);
export const POST = withOperator(handlePOST);
export const PATCH = withOperator(handlePATCH);
