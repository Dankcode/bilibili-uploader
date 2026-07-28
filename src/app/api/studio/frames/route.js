import path from 'path';
import { promises as fs } from 'fs';
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
    const { segments, duration } = parseTranscriptMarkdown(project.transcriptMd);
    if (!segments.length) return NextResponse.json({ error: 'Transcribe the video before extracting frames.' }, { status: 409 });
    const intervalSeconds = Math.max(2, Math.min(300, Number(body.intervalSeconds) || 15));
    const maxFrames = Math.max(1, Math.min(240, Number(body.maxFrames) || 120));
    updateStudioStage(projectId, 'frames', 'running', `Capturing one screenshot every ${intervalSeconds}s`);
    const frameDir = path.join(ensureProjectDirectory(projectId), 'frames');
    const manifest = await extractSynchronizedFrames(project.videoPath, segments, frameDir, {
      duration,
      intervalSeconds,
      maxFrames,
    });
    const invalidatedAt = new Date().toISOString();
    updateStudioProject(projectId, {
      frameManifest: manifest,
      contextMd: '',
      contextManifest: [],
      contextSettings: { intervalSeconds, maxFrames },
      stageStatus: {
        ...project.stageStatus,
        context: { status: 'pending', detail: 'Rebuild after screenshot changes', updatedAt: invalidatedAt },
        correct: { status: 'pending', detail: 'Waiting for Kimi context', updatedAt: invalidatedAt },
      },
    });
    const directory = ensureProjectDirectory(projectId);
    await Promise.all([
      fs.rm(path.join(directory, 'context.md'), { force: true }),
      fs.rm(path.join(directory, 'context.json'), { force: true }),
      fs.rm(path.join(directory, 'context-handoff.json'), { force: true }),
      fs.rm(path.join(directory, 'context-retranscription.json'), { force: true }),
    ]);
    const next = updateStudioStage(projectId, 'frames', 'done', `${manifest.length} timed screenshots`);
    return NextResponse.json({
      project: publicStudioProject(next),
      manifest: manifest.map((item) => ({ ...item, url: `/api/studio/media/${projectId}?frame=${encodeURIComponent(item.file)}` })),
    });
  } catch (error) {
    if (projectId && getStudioProject(projectId)) updateStudioStage(projectId, 'frames', 'failed', error.message);
    const status = error.code === 'CONTEXT_FRAME_LIMIT' ? 400 : 500;
    return NextResponse.json({ error: error.message || 'Frame extraction failed.', code: error.code }, { status });
  }
}
