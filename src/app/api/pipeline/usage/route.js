import { NextResponse } from 'next/server';
import { getUsageSummary } from '@/lib/pipeline/usage';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const cap = new URL(request.url).searchParams.get('maxDailySeconds');
  return NextResponse.json({ usage: getUsageSummary(undefined, cap) });
}
