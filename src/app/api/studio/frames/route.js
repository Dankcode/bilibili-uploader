import path from 'path';
import { NextResponse } from 'next/server';
import { extractSynchronizedFrames } from '@/lib/studio/frames';
import { parseTranscriptMarkdown } from '@/lib/studio/markdown';
import {
  ensureProjectDirectory, getStudioProject, publicStudioProject, updateStudioProject, updateStudioStage,
} from '@/lib/studio/store';

export const runtime = 'nodejs';
export const maxDuration = 600;

export async function POST(request) {
  let projectId = '';
  try {
    const body = await request.json();
    projectId = String(body.projectId || '');
    const project = getStudioProject(projectId);
    if (!project) return NextResponse.json({ error: 'Studio project not found.' }, { status: 404 });
    const { segments } = parseTranscriptMarkdown(project.transcriptMd);
    if (!segments.length) return NextResponse.json({ error: 'Transcribe the video before extracting frames.' }, { status: 409 });
    updateStudioStage(projectId, 'frames', 'running', 'Extracting synchronized frames');
    const frameDir = path.join(ensureProjectDirectory(projectId), 'frames');
    const manifest = await extractSynchronizedFrames(project.videoPath, segments, frameDir, {
      maxFrames: Math.max(1, Math.min(120, Number(body.maxFrames) || 60)),
    });
    updateStudioProject(projectId, { frameManifest: manifest });
    const next = updateStudioStage(projectId, 'frames', 'done', `${manifest.length} frames`);
    return NextResponse.json({
      project: publicStudioProject(next),
      manifest: manifest.map((item) => ({ ...item, url: `/api/studio/media/${projectId}?frame=${encodeURIComponent(item.file)}` })),
    });
  } catch (error) {
    if (projectId && getStudioProject(projectId)) updateStudioStage(projectId, 'frames', 'failed', error.message);
    return NextResponse.json({ error: error.message || 'Frame extraction failed.' }, { status: 500 });
  }
}
