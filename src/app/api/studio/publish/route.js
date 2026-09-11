import { withOperator } from '../../../../lib/agent/auth.js';
import { NextResponse } from 'next/server';
import {
  getStudioAutoPublish, publishStudioProject, setStudioAutoPublish,
} from '@/lib/studio/publish';
import { getStudioProject, publicStudioProject } from '@/lib/studio/store';

export const runtime = 'nodejs';

async function handleGET() {
  return NextResponse.json({ autoPublish: getStudioAutoPublish() });
}

async function handlePOST(request) {
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

async function handlePUT(request) {
  try {
    return NextResponse.json({ autoPublish: setStudioAutoPublish(await request.json()) });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Could not save automatic publishing.' }, { status: 400 });
  }
}

export const GET = withOperator(handleGET);
export const POST = withOperator(handlePOST);
export const PUT = withOperator(handlePUT);
