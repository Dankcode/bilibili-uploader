import { withOperator } from '../../../../lib/agent/auth.js';
import { NextResponse } from 'next/server';
import { listAutomationSettings, saveAutomationSettings } from '@/lib/operations/store';

export const dynamic = 'force-dynamic';

async function handleGET(request) {
  try {
    const limit = new URL(request.url).searchParams.get('limit') || 20;
    return NextResponse.json({ settings: listAutomationSettings({ limit }) });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

async function handlePOST(request) {
  try {
    return NextResponse.json({ setting: saveAutomationSettings(await request.json()) });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export const GET = withOperator(handleGET);
export const POST = withOperator(handlePOST);
