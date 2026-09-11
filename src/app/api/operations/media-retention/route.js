import { withOperator } from '../../../../lib/agent/auth.js';
import { NextResponse } from 'next/server';
import {
  deleteLocalMediaRetentionCandidates,
  getLocalMediaRetentionSettings,
  updateLocalMediaRetentionSettings,
} from '@/lib/operations/mediaRetention';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function handleGET() {
  return NextResponse.json(getLocalMediaRetentionSettings());
}

async function handlePOST(request) {
  try {
    const body = await request.json();
    if (body.action === 'settings') return NextResponse.json(updateLocalMediaRetentionSettings(body));
    if (body.action === 'cleanup') return NextResponse.json(deleteLocalMediaRetentionCandidates(body.assetIds));
    throw new Error('Unknown action. Valid actions: settings|cleanup');
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Could not manage local media retention' }, { status: 400 });
  }
}

export const GET = withOperator(handleGET);
export const POST = withOperator(handlePOST);
