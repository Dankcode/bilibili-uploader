import { withOperator } from '../../../../lib/agent/auth.js';
import { NextResponse } from 'next/server';
import { getUsageSummary } from '@/lib/pipeline/usage';

export const dynamic = 'force-dynamic';

async function handleGET(request) {
  const cap = new URL(request.url).searchParams.get('maxDailySeconds');
  return NextResponse.json({ usage: getUsageSummary(undefined, cap) });
}

export const GET = withOperator(handleGET);
