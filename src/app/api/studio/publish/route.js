import { NextResponse } from 'next/server';
import {
  getStudioAutoPublish, publishStudioProject, setStudioAutoPublish,
} from '@/lib/studio/publish';
import { getStudioProject, publicStudioProject } from '@/lib/studio/store';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({ autoPublish: getStudioAutoPublish() });
}

export async function POST(request) {
  try {
    const body = await request.json();
    const job = publishStudioProject(String(body.projectId || ''), body.options || {});
    return NextResponse.json({
      job,
      project: publicStudioProject(getStudioProject(String(body.projectId || ''))),
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Could not send Studio project to the pipeline.' }, { status: 400 });
  }
}

export async function PUT(request) {
  try {
    return NextResponse.json({ autoPublish: setStudioAutoPublish(await request.json()) });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Could not save automatic publishing.' }, { status: 400 });
  }
}
