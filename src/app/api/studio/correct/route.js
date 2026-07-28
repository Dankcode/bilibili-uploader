import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { parseContextMarkdown } from '@/lib/studio/context';
import { retranscribeWithContext } from '@/lib/studio/localWhisper';
import { buildTranscriptMarkdown, parseTranscriptMarkdown } from '@/lib/studio/markdown';
import { maybeAutoPublishStudioProject } from '@/lib/studio/publish';
import {
  ensureProjectDirectory, getStudioProject, publicStudioProject, updateStudioProject, updateStudioStage,
} from '@/lib/studio/store';

export const runtime = 'nodejs';
export const maxDuration = 1800;
export const dynamic = 'force-dynamic';

function sha256(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

export async function POST(request) {
  let projectId = '';
  try {
    const body = await request.json();
    projectId = String(body.projectId || '');
    const project = getStudioProject(projectId);
    if (!project) return NextResponse.json({ error: 'Studio project not found.' }, { status: 404 });
    if (!project.contextMd || !project.contextManifest.length) {
      return NextResponse.json({ error: 'Build Kimi screenshot context before rerunning Whisper.' }, { status: 409 });
    }
    const parsed = parseTranscriptMarkdown(project.transcriptMd);
    const context = parseContextMarkdown(project.contextMd);
    if (!parsed.segments.length || !context.frames.length) {
      return NextResponse.json({ error: 'Timestamped transcript and screenshot context are required.' }, { status: 409 });
    }
    const transcriptHash = sha256(project.transcriptMd);
    const contextHash = sha256(project.contextMd);
    const contextManifestHash = sha256(JSON.stringify(project.contextManifest));
    const expectedHashes = new Set([
      project.contextSettings?.transcriptSha256,
      project.contextSettings?.appliedTranscriptSha256,
    ].filter(Boolean));
    if (expectedHashes.size && !expectedHashes.has(transcriptHash)) {
      const error = new Error('The transcript changed after screenshot context was built. Rebuild Kimi context before rerunning Whisper.');
      error.code = 'STALE_TRANSCRIPT';
      throw error;
    }

    const directory = ensureProjectDirectory(projectId);
    updateStudioStage(projectId, 'correct', 'running', 'Rerunning Whisper with timestamp-matched screenshot vocabulary');
    const result = await retranscribeWithContext(
      project.videoPath,
      parsed.segments,
      project.contextManifest,
      {
        quality: body.quality || project.quality,
        language: body.from || project.sourceLang,
        workDir: directory,
        onProgress: (progress, detail) => updateStudioStage(
          projectId,
          'correct',
          'running',
          `${progress}% - ${detail}`,
        ),
      },
    );

    const latest = getStudioProject(projectId);
    if (!latest
      || sha256(latest.transcriptMd) !== transcriptHash
      || sha256(latest.contextMd) !== contextHash
      || sha256(JSON.stringify(latest.contextManifest)) !== contextManifestHash) {
      const error = new Error('The transcript or screenshot context changed during the context-assisted Whisper pass. No revisions were applied.');
      error.code = 'STALE_CONTEXT_SOURCE';
      throw error;
    }
    const transcriptMd = buildTranscriptMarkdown({
      ...parsed,
      generated: new Date().toISOString(),
      engine: result.engine,
      corrected: result.revisedCount > 0,
      contextAssisted: true,
      segments: result.segments,
    });
    const nextTranscriptHash = sha256(transcriptMd);
    const originalPath = path.join(directory, 'transcript.before-context.md');
    await fs.access(originalPath).catch(() => fs.writeFile(originalPath, project.transcriptMd, 'utf8'));
    await Promise.all([
      fs.writeFile(path.join(directory, 'transcript.md'), transcriptMd, 'utf8'),
      fs.writeFile(path.join(directory, 'transcript.context.md'), transcriptMd, 'utf8'),
      fs.writeFile(path.join(directory, 'transcript.corrected.md'), transcriptMd, 'utf8'),
      fs.writeFile(path.join(directory, 'context-retranscription.json'), JSON.stringify({
        generatedAt: new Date().toISOString(),
        baselineTranscriptSha256: transcriptHash,
        contextSha256: contextHash,
        contextManifestSha256: contextManifestHash,
        contextRevision: context.revision,
        attemptedCount: result.attemptedCount,
        failedCount: result.failedCount,
        failedCueIds: result.failedCueIds,
        revisedCount: result.revisedCount,
        revisions: result.revisions,
        suggestions: result.suggestions,
      }, null, 2), 'utf8'),
      fs.rm(path.join(directory, 'subtitles.ass'), { force: true }),
      fs.rm(path.join(directory, 'subtitles.srt'), { force: true }),
    ]);

    const now = new Date().toISOString();
    updateStudioProject(projectId, {
      transcriptMd,
      subtitleText: '',
      contextSettings: {
        ...project.contextSettings,
        appliedAt: now,
        appliedTranscriptSha256: nextTranscriptHash,
      },
      stageStatus: {
        ...latest.stageStatus,
        translate: { status: 'pending', detail: 'Waiting for context-refined transcript', updatedAt: now },
      },
    });
    const next = updateStudioStage(
      projectId,
      'correct',
      result.failedCount ? 'partial' : 'done',
      `${result.revisedCount}/${result.attemptedCount} cues revised with visible evidence`
        + (result.failedCount ? `; ${result.failedCount} kept after model errors` : ''),
    );
    const autoPublish = !result.failedCount && project.sourceLang === project.targetLang
      ? maybeAutoPublishStudioProject(projectId)
      : null;
    const finalProject = getStudioProject(projectId) || next;
    return NextResponse.json({
      project: publicStudioProject(finalProject),
      attemptedCount: result.attemptedCount,
      failedCount: result.failedCount,
      failedCueIds: result.failedCueIds,
      revisedCount: result.revisedCount,
      revisions: result.revisions,
      suggestions: result.suggestions,
      autoPublish,
    });
  } catch (error) {
    if (projectId && getStudioProject(projectId)) {
      updateStudioStage(projectId, 'correct', 'failed', error.message);
    }
    const status = ['STALE_TRANSCRIPT', 'STALE_CONTEXT_SOURCE'].includes(error.code) ? 409 : 500;
    return NextResponse.json({
      error: error.message || 'Context-assisted transcription failed.',
      code: error.code || 'CONTEXT_RETRANSCRIPTION_FAILED',
    }, { status });
  }
}
