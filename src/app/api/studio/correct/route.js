import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { parseTranscriptMarkdown, replaceTranscriptSegments } from '@/lib/studio/markdown';
import { maybeAutoPublishStudioProject } from '@/lib/studio/publish';
import {
  assertProjectFile, ensureProjectDirectory, getStudioProject, publicStudioProject, updateStudioProject, updateStudioStage,
} from '@/lib/studio/store';
import { correctSegments, getVisionStatus, VISION_SKIPPED_MESSAGE } from '@/lib/studio/vision';

export const runtime = 'nodejs';
export const maxDuration = 600;

export async function GET() {
  return NextResponse.json(getVisionStatus());
}

export async function POST(request) {
  let projectId = '';
  let handoffPath = '';
  let handoff = null;
  try {
    const body = await request.json();
    projectId = String(body.projectId || '');
    const project = getStudioProject(projectId);
    if (!project) return NextResponse.json({ error: 'Studio project not found.' }, { status: 404 });
    if (!project.frameManifest.length) return NextResponse.json({ error: 'Extract frames before running correction.' }, { status: 409 });
    const directory = ensureProjectDirectory(projectId);
    handoffPath = path.join(directory, 'vision-handoff.json');
    const vision = getVisionStatus();
    if (!vision.configured) {
      handoff = {
        projectId,
        provider: null,
        status: 'skipped',
        reason: VISION_SKIPPED_MESSAGE,
        frameCount: project.frameManifest.length,
        updatedAt: new Date().toISOString(),
      };
      await fs.writeFile(handoffPath, JSON.stringify(handoff, null, 2), 'utf8');
      const skipped = updateStudioStage(projectId, 'correct', 'skipped', VISION_SKIPPED_MESSAGE);
      const autoPublish = project.sourceLang === project.targetLang
        ? maybeAutoPublishStudioProject(projectId)
        : null;
      const finalProject = getStudioProject(projectId) || skipped;
      return NextResponse.json({
        project: publicStudioProject(finalProject),
        skipped: true,
        message: VISION_SKIPPED_MESSAGE,
        handoff: { provider: null, status: 'skipped', frameCount: project.frameManifest.length },
        autoPublish,
      });
    }
    const parsed = parseTranscriptMarkdown(project.transcriptMd);
    updateStudioStage(projectId, 'correct', 'running', `Sending ${project.frameManifest.length} saved frames to ${vision.backend}`);
    const textByIndex = new Map(parsed.segments.map((segment) => [Number(segment.index), segment.text]));
    const batch = await Promise.all(project.frameManifest.map(async (frame) => {
      const imagePath = assertProjectFile(projectId, path.join(directory, 'frames', frame.file));
      const image = await fs.readFile(imagePath);
      if (!image.length) throw new Error(`Saved vision frame is empty: ${frame.file}`);
      return {
        segIndex: Number(frame.segIndex),
        timeMs: Number(frame.timeMs),
        imagePath,
        mimeType: 'image/jpeg',
        byteSize: image.length,
        sha256: createHash('sha256').update(image).digest('hex'),
        text: textByIndex.get(Number(frame.segIndex)) || '',
      };
    }));
    handoff = {
      projectId,
      provider: vision.backend,
      model: vision.model,
      status: 'dispatching',
      sentAt: new Date().toISOString(),
      frameCount: batch.length,
      frames: batch.map(({ segIndex, timeMs, imagePath, mimeType, byteSize, sha256 }) => ({
        segIndex, timeMs, file: path.basename(imagePath), mimeType, byteSize, sha256,
      })),
    };
    await fs.writeFile(handoffPath, JSON.stringify(handoff, null, 2), 'utf8');
    const corrected = await correctSegments(batch);
    handoff = { ...handoff, status: 'completed', completedAt: new Date().toISOString(), correctedCount: corrected.length };
    await fs.writeFile(handoffPath, JSON.stringify(handoff, null, 2), 'utf8');
    const correctedByIndex = new Map(corrected.map((item) => [Number(item.segIndex), item.text.trim()]));
    const segments = parsed.segments.map((segment) => ({ ...segment, text: correctedByIndex.get(Number(segment.index)) || segment.text }));
    const transcriptMd = replaceTranscriptSegments(project.transcriptMd, segments, { corrected: true });
    await fs.writeFile(path.join(directory, 'transcript.corrected.md'), transcriptMd, 'utf8');
    updateStudioProject(projectId, { transcriptMd });
    const next = updateStudioStage(
      projectId,
      'correct',
      'done',
      `${batch.length} frames reviewed; ${correctedByIndex.size} segments corrected`,
    );
    const autoPublish = project.sourceLang === project.targetLang
      ? maybeAutoPublishStudioProject(projectId)
      : null;
    const finalProject = getStudioProject(projectId) || next;
    return NextResponse.json({
      project: publicStudioProject(finalProject),
      handoff: {
        provider: vision.backend,
        model: vision.model,
        status: 'completed',
        frameCount: batch.length,
        correctedCount: corrected.length,
      },
      autoPublish,
    });
  } catch (error) {
    if (handoffPath && handoff) {
      await fs.writeFile(handoffPath, JSON.stringify({
        ...handoff, status: 'failed', error: error.message, failedAt: new Date().toISOString(),
      }, null, 2), 'utf8').catch(() => {});
    }
    if (projectId && getStudioProject(projectId)) {
      updateStudioStage(projectId, 'correct', error.code === 'VISION_NOT_CONFIGURED' ? 'skipped' : 'failed', error.message);
    }
    const status = error.code === 'VISION_NOT_CONFIGURED' ? 501 : 500;
    return NextResponse.json({ error: error.message || 'Vision correction failed.', code: error.code || 'VISION_FAILED' }, { status });
  }
}
