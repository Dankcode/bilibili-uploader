import { withOperator } from '../../../../lib/agent/auth.js';
import { randomUUID } from 'crypto';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { pipeline as streamPipeline } from 'stream/promises';
import { NextResponse } from 'next/server';
import { buildTranscriptMarkdown } from '@/lib/studio/markdown';
import { getLocalWhisperStatus, transcribeLocal } from '@/lib/studio/localWhisper';
import {
  createStudioProject, ensureProjectDirectory, getStudioProject, publicStudioProject, updateStudioProject, updateStudioStage,
} from '@/lib/studio/store';

export const runtime = 'nodejs';
export const maxDuration = 1800;
export const dynamic = 'force-dynamic';

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;

function safeName(value) {
  return path.basename(String(value || 'input.mp4')).replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(-160) || 'input.mp4';
}

async function copyReadable(readable, destination) {
  await streamPipeline(readable, fs.createWriteStream(destination, { flags: 'wx' }));
}

async function handleGET(request) {
  const quality = new URL(request.url).searchParams.get('quality') || 'fast';
  return NextResponse.json(getLocalWhisperStatus(quality));
}

async function handlePOST(request) {
  let id = randomUUID();
  let directory = '';
  let hasProject = false;
  try {
    const contentType = request.headers.get('content-type') || '';
    let sourceLang = 'zh';
    let targetLang = 'en';
    let quality = 'fast';
    let name = 'input.mp4';
    let videoPath;

    if (contentType.includes('multipart/form-data')) {
      directory = ensureProjectDirectory(id);
      const form = await request.formData();
      const file = form.get('file');
      if (!file || typeof file === 'string') return NextResponse.json({ error: 'Choose a video file to transcribe.' }, { status: 400 });
      if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: 'Video exceeds the 2 GB upload limit.' }, { status: 413 });
      sourceLang = String(form.get('sourceLang') || 'zh');
      targetLang = String(form.get('targetLang') || 'en');
      quality = String(form.get('quality') || 'fast');
      name = safeName(file.name);
      videoPath = path.join(directory, name);
      await copyReadable(Readable.fromWeb(file.stream()), videoPath);
    } else {
      const body = await request.json().catch(() => ({}));
      if (body.projectId) {
        const existing = getStudioProject(body.projectId);
        if (!existing) return NextResponse.json({ error: 'Studio project not found.' }, { status: 404 });
        id = existing.id;
        directory = ensureProjectDirectory(id);
        videoPath = existing.videoPath;
        await fsPromises.access(videoPath);
        sourceLang = String(body.sourceLang || existing.sourceLang || 'zh');
        targetLang = String(body.targetLang || existing.targetLang || 'en');
        quality = String(body.quality || existing.quality || 'fast');
        name = existing.name;
        updateStudioProject(id, { sourceLang, targetLang, quality });
        hasProject = true;
      } else {
        if (!body.path || !path.isAbsolute(body.path)) return NextResponse.json({ error: 'Provide an absolute local video path.' }, { status: 400 });
        await fsPromises.access(body.path);
        directory = ensureProjectDirectory(id);
        sourceLang = String(body.sourceLang || 'zh');
        targetLang = String(body.targetLang || 'en');
        quality = String(body.quality || 'fast');
        name = safeName(body.name || path.basename(body.path));
        videoPath = path.join(directory, name);
        await copyReadable(fs.createReadStream(body.path), videoPath);
      }
    }

    if (!hasProject) {
      createStudioProject({ id, name, videoPath, sourceLang, targetLang, quality });
      hasProject = true;
    }
    updateStudioStage(id, 'transcribe', 'running', 'Preparing local Whisper');
    const transcript = await transcribeLocal(videoPath, {
      quality,
      language: sourceLang,
      workDir: directory,
      onProgress: (progress, detail) => updateStudioStage(id, 'transcribe', 'running', `${progress}% - ${detail}`),
    });
    const transcriptMd = buildTranscriptMarkdown({
      name,
      source: sourceLang,
      target: targetLang,
      duration: transcript.duration,
      engine: transcript.engine,
      segments: transcript.segments,
    });
    await fsPromises.writeFile(path.join(directory, 'transcript.md'), transcriptMd, 'utf8');
    const current = getStudioProject(id);
    const invalidatedAt = new Date().toISOString();
    updateStudioProject(id, {
      transcriptMd,
      subtitleText: '',
      frameManifest: [],
      contextMd: '',
      contextManifest: [],
      contextSettings: {
        intervalSeconds: Number(current?.contextSettings?.intervalSeconds) || 15,
        maxFrames: Number(current?.contextSettings?.maxFrames) || 120,
      },
      analysis: {},
      chatHistory: [],
      stageStatus: {
        ...current?.stageStatus,
        frames: { status: 'pending', detail: 'Ready to capture timed screenshots', updatedAt: invalidatedAt },
        context: { status: 'pending', detail: 'Waiting for timed screenshots', updatedAt: invalidatedAt },
        correct: { status: 'pending', detail: 'Waiting for Kimi context', updatedAt: invalidatedAt },
        translate: { status: 'pending', detail: 'Waiting for refined transcript', updatedAt: invalidatedAt },
      },
    });
    await Promise.all([
      fsPromises.rm(path.join(directory, 'subtitles.ass'), { force: true }),
      fsPromises.rm(path.join(directory, 'subtitles.srt'), { force: true }),
      fsPromises.rm(path.join(directory, 'context.md'), { force: true }),
      fsPromises.rm(path.join(directory, 'context.json'), { force: true }),
      fsPromises.rm(path.join(directory, 'context-handoff.json'), { force: true }),
      fsPromises.rm(path.join(directory, 'context-retranscription.json'), { force: true }),
      fsPromises.rm(path.join(directory, 'transcript.before-context.md'), { force: true }),
      fsPromises.rm(path.join(directory, 'transcript.context.md'), { force: true }),
      fsPromises.rm(path.join(directory, 'transcript.corrected.md'), { force: true }),
      fsPromises.rm(path.join(directory, 'frames'), { recursive: true, force: true }),
    ]).catch(() => {});
    const project = updateStudioStage(id, 'transcribe', 'done', `${transcript.segments.length} segments`);
    return NextResponse.json({ project: publicStudioProject(project), segments: transcript.segments }, { status: 201 });
  } catch (error) {
    if (hasProject) updateStudioStage(id, 'transcribe', 'failed', error.message);
    else if (directory) await fsPromises.rm(directory, { recursive: true, force: true }).catch(() => {});
    return NextResponse.json({ error: error.message || 'Transcription failed.', projectId: hasProject ? id : null }, { status: 500 });
  }
}

export const GET = withOperator(handleGET);
export const POST = withOperator(handlePOST);
