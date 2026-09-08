import { NextResponse } from 'next/server';
import { listAutomationSettings, saveAutomationSettings } from '@/lib/operations/store';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const limit = new URL(request.url).searchParams.get('limit') || 20;
    return NextResponse.json({ settings: listAutomationSettings({ limit }) });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    return NextResponse.json({ setting: saveAutomationSettings(await request.json()) });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
