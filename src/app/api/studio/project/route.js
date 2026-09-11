import { withOperator } from '../../../../lib/agent/auth.js';
import { NextResponse } from 'next/server';
import { listStudioProjects, studioProjectSummary } from '@/lib/studio/store';

export const dynamic = 'force-dynamic';

async function handleGET(request) {
  const limit = new URL(request.url).searchParams.get('limit') || 50;
  return NextResponse.json({ projects: listStudioProjects(limit).map(studioProjectSummary) });
}

export const GET = withOperator(handleGET);
