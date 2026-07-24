import { NextResponse } from 'next/server';
import { listStudioProjects, studioProjectSummary } from '@/lib/studio/store';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const limit = new URL(request.url).searchParams.get('limit') || 50;
  return NextResponse.json({ projects: listStudioProjects(limit).map(studioProjectSummary) });
}
