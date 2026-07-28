import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { buildContextMarkdown } from '@/lib/studio/context';
import { parseTranscriptMarkdown } from '@/lib/studio/markdown';
import {
  assertProjectFile, ensureProjectDirectory, getStudioProject, publicStudioProject, updateStudioProject, updateStudioStage,
} from '@/lib/studio/store';
import {
  analyzeFrames, getVisionStatus, VISION_SKIPPED_MESSAGE,
} from '@/lib/studio/vision';

export const runtime = 'nodejs';
export const maxDuration = 1800;
export const dynamic = 'force-dynamic';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function frameRevision(project) {
  return sha256(JSON.stringify({
    frames: project.frameManifest,
    intervalSeconds: Number(project.contextSettings?.intervalSeconds) || 15,
    maxFrames: Number(project.contextSettings?.maxFrames) || 120,
  }));
}

function overlappingSegments(segments, frame) {
  const start = Number(frame.windowStartMs) / 1000;
  const end = Number(frame.windowEndMs) / 1000;
  return segments.filter((segment) => segment.start < end && segment.end > start);
}

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
    if (!project.frameManifest.length) {
      return NextResponse.json({ error: 'Capture timed screenshots before building context.' }, { status: 409 });
    }
    const parsed = parseTranscriptMarkdown(project.transcriptMd);
    if (!parsed.segments.length) {
      return NextResponse.json({ error: 'Transcribe the video before building screenshot context.' }, { status: 409 });
    }
    const vision = getVisionStatus();
    if (!vision.configured) {
      const error = new Error(VISION_SKIPPED_MESSAGE);
      error.code = 'VISION_NOT_CONFIGURED';
      throw error;
    }

    const transcriptSha256 = sha256(project.transcriptMd);
    const sourceFrameRevision = frameRevision(project);
    const directory = ensureProjectDirectory(projectId);
    handoffPath = path.join(directory, 'context-handoff.json');
    updateStudioStage(
      projectId,
      'context',
      'running',
      `Sending ${project.frameManifest.length} timed screenshots to ${vision.backend}`,
    );

    const batch = await Promise.all(project.frameManifest.map(async (frame) => {
      const imagePath = assertProjectFile(projectId, path.join(directory, 'frames', frame.file));
      const image = await fs.readFile(imagePath);
      if (!image.length) throw new Error(`Saved screenshot is empty: ${frame.file}`);
      const matches = overlappingSegments(parsed.segments, frame);
      return {
        frameId: String(frame.frameId || frame.file),
        segIndex: Number(frame.segIndex),
        segmentIds: matches.map((segment) => Number(segment.index)),
        timeMs: Number(frame.timeMs),
        windowStartMs: Number(frame.windowStartMs),
        windowEndMs: Number(frame.windowEndMs),
        imagePath,
        mimeType: 'image/jpeg',
        byteSize: image.length,
        sha256: sha256(image),
        draftText: matches.map((segment) => `#${segment.index} ${segment.text}`).join(' | '),
      };
    }));

    handoff = {
      projectId,
      provider: vision.backend,
      model: vision.model,
      status: 'dispatching',
      sentAt: new Date().toISOString(),
      transcriptSha256,
      frameRevision: sourceFrameRevision,
      frameCount: batch.length,
      frames: batch.map((frame) => ({
        frameId: frame.frameId,
        segmentIds: frame.segmentIds,
        timeMs: frame.timeMs,
        windowStartMs: frame.windowStartMs,
        windowEndMs: frame.windowEndMs,
        file: path.basename(frame.imagePath),
        mimeType: frame.mimeType,
        byteSize: frame.byteSize,
        sha256: frame.sha256,
      })),
    };
    await fs.writeFile(handoffPath, JSON.stringify(handoff, null, 2), 'utf8');

    const result = await analyzeFrames(batch);
    const latest = getStudioProject(projectId);
    if (!latest
      || sha256(latest.transcriptMd) !== transcriptSha256
      || frameRevision(latest) !== sourceFrameRevision) {
      const error = new Error('The transcript or timed screenshots changed while Kimi was building context. Run screenshot context again.');
      error.code = 'STALE_CONTEXT_SOURCE';
      throw error;
    }

    const analyzedById = new Map(result.contexts.map((item) => [String(item.frameId), item]));
    const contexts = batch.map((frame) => ({
      ...analyzedById.get(frame.frameId),
      id: frame.frameId,
      file: path.basename(frame.imagePath),
      sha256: frame.sha256,
      segmentIds: frame.segmentIds,
      captureTime: frame.timeMs / 1000,
      windowStart: frame.windowStartMs / 1000,
      windowEnd: frame.windowEndMs / 1000,
    }));
    const generated = new Date().toISOString();
    const contextMd = buildContextMarkdown({
      name: project.name,
      generated,
      revision: generated,
      provider: result.provider,
      model: result.model,
      promptVersion: result.promptVersion,
      transcriptSha256,
      intervalSeconds: project.contextSettings?.intervalSeconds || body.intervalSeconds || 15,
      duration: parsed.duration,
      frames: contexts,
    });

    await Promise.all([
      fs.writeFile(path.join(directory, 'context.md'), contextMd, 'utf8'),
      fs.writeFile(path.join(directory, 'context.json'), JSON.stringify(contexts, null, 2), 'utf8'),
    ]);
    handoff = {
      ...handoff,
      status: 'completed',
      completedAt: generated,
      promptVersion: result.promptVersion,
    };
    await fs.writeFile(handoffPath, JSON.stringify(handoff, null, 2), 'utf8');

    updateStudioProject(projectId, {
      contextMd,
      contextManifest: contexts,
      contextSettings: {
        ...project.contextSettings,
        transcriptSha256,
        frameRevision: sourceFrameRevision,
        revision: generated,
        provider: result.provider,
        model: result.model,
        promptVersion: result.promptVersion,
      },
      stageStatus: {
        ...latest.stageStatus,
        correct: { status: 'pending', detail: 'Ready for context-assisted Whisper', updatedAt: generated },
      },
    });
    const next = updateStudioStage(
      projectId,
      'context',
      'done',
      `${contexts.length} timestamped contexts - ${result.provider}/${result.model}`,
    );
    return NextResponse.json({
      project: publicStudioProject(next),
      contextMd,
      contextCount: contexts.length,
    });
  } catch (error) {
    if (handoffPath && handoff) {
      await fs.writeFile(handoffPath, JSON.stringify({
        ...handoff,
        status: 'failed',
        error: error.message,
        failedAt: new Date().toISOString(),
      }, null, 2), 'utf8').catch(() => {});
    }
    if (projectId && getStudioProject(projectId)) {
      updateStudioStage(
        projectId,
        'context',
        error.code === 'VISION_NOT_CONFIGURED' ? 'skipped' : 'failed',
        error.message,
      );
    }
    const status = error.code === 'VISION_NOT_CONFIGURED'
      ? 501
      : (error.code === 'STALE_CONTEXT_SOURCE' ? 409 : 500);
    return NextResponse.json({
      error: error.message || 'Screenshot context failed.',
      code: error.code || 'CONTEXT_FAILED',
    }, { status });
  }
}
