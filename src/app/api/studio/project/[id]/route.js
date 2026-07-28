import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { NextResponse } from 'next/server';
import { parseContextMarkdown } from '@/lib/studio/context';
import { parseTranscriptMarkdown } from '@/lib/studio/markdown';
import { buildSrt, parseSubtitle } from '@/lib/studio/subtitles';
import {
  deleteStudioProject, ensureProjectDirectory, getStudioProject, publicStudioProject, updateStudioProject,
} from '@/lib/studio/store';

function downloadResponse(body, filename, contentType = 'text/plain; charset=utf-8') {
  return new Response(body, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}"`,
    },
  });
}

export async function GET(request, { params }) {
  const project = getStudioProject(params.id);
  if (!project) return NextResponse.json({ error: 'Studio project not found.' }, { status: 404 });
  const download = new URL(request.url).searchParams.get('download');
  if (!download) return NextResponse.json({ project: publicStudioProject(project) });
  if (download === 'md') return downloadResponse(project.transcriptMd, `${project.name}.transcript.md`, 'text/markdown; charset=utf-8');
  if (download === 'context') return downloadResponse(project.contextMd, `${project.name}.context.md`, 'text/markdown; charset=utf-8');
  if (download === 'ass') return downloadResponse(project.subtitleText, `${project.name}.ass`);
  if (download === 'srt') {
    const segments = parseSubtitle(project.subtitleText, project.format);
    return downloadResponse(buildSrt(segments, { dual: true }), `${project.name}.srt`, 'application/x-subrip; charset=utf-8');
  }
  if (download === 'video') {
    if (!fs.existsSync(project.videoPath)) return NextResponse.json({ error: 'Project video is missing.' }, { status: 404 });
    return downloadResponse(Readable.toWeb(fs.createReadStream(project.videoPath)), path.basename(project.videoPath), 'application/octet-stream');
  }
  return NextResponse.json({ error: 'Unsupported download format.' }, { status: 400 });
}

export async function PUT(request, { params }) {
  try {
    const current = getStudioProject(params.id);
    if (!current) return NextResponse.json({ error: 'Studio project not found.' }, { status: 404 });
    const body = await request.json();
    const patch = {};
    if (body.name !== undefined) patch.name = String(body.name).trim() || current.name;
    if (body.transcriptMd !== undefined) {
      parseTranscriptMarkdown(body.transcriptMd);
      patch.transcriptMd = String(body.transcriptMd);
      if (patch.transcriptMd !== current.transcriptMd) {
        const updatedAt = new Date().toISOString();
        patch.subtitleText = '';
        patch.contextMd = '';
        patch.contextManifest = [];
        patch.analysis = {};
        patch.chatHistory = [];
        patch.contextSettings = {
          intervalSeconds: Number(current.contextSettings?.intervalSeconds) || 15,
          maxFrames: Number(current.contextSettings?.maxFrames) || 120,
        };
        patch.stageStatus = {
          ...current.stageStatus,
          context: { status: 'pending', detail: 'Transcript changed - rebuild screenshot context', updatedAt },
          correct: { status: 'pending', detail: 'Waiting for rebuilt context', updatedAt },
          translate: { status: 'pending', detail: 'Waiting for revised transcript', updatedAt },
        };
      }
    }
    if (body.contextMd !== undefined) {
      const parsed = parseContextMarkdown(body.contextMd);
      patch.contextMd = String(body.contextMd);
      patch.contextManifest = parsed.frames;
      patch.contextSettings = {
        ...current.contextSettings,
        intervalSeconds: parsed.intervalSeconds,
        transcriptSha256: parsed.transcriptSha256 || current.contextSettings?.transcriptSha256,
        revision: parsed.revision,
        provider: parsed.provider,
        model: parsed.model,
        promptVersion: parsed.promptVersion,
      };
      patch.stageStatus = {
        ...current.stageStatus,
        correct: {
          status: 'pending',
          detail: 'Context edited - ready for context-assisted Whisper',
          updatedAt: new Date().toISOString(),
        },
      };
    }
    if (body.subtitleText !== undefined) {
      const parsed = parseSubtitle(body.subtitleText, body.format || current.format);
      if (!parsed.length) throw new Error('Subtitle document has no valid timestamped cues.');
      patch.subtitleText = String(body.subtitleText);
      patch.format = body.format || current.format;
    }
    const next = updateStudioProject(current.id, patch);
    const directory = ensureProjectDirectory(current.id);
    if (body.transcriptMd !== undefined && patch.transcriptMd !== current.transcriptMd) {
      fs.writeFileSync(path.join(directory, 'transcript.md'), patch.transcriptMd, 'utf8');
      for (const relative of [
        'context.md',
        'context.json',
        'context-handoff.json',
        'context-retranscription.json',
        'transcript.context.md',
        'transcript.corrected.md',
        'subtitles.ass',
        'subtitles.srt',
      ]) {
        fs.rmSync(path.join(directory, relative), { force: true });
      }
    }
    if (body.contextMd !== undefined) {
      fs.writeFileSync(path.join(directory, 'context.md'), patch.contextMd, 'utf8');
      fs.writeFileSync(path.join(directory, 'context.json'), JSON.stringify(patch.contextManifest, null, 2), 'utf8');
    }
    if (body.subtitleText !== undefined) {
      fs.writeFileSync(path.join(directory, 'subtitles.ass'), patch.subtitleText, 'utf8');
    }
    return NextResponse.json({ project: publicStudioProject(next) });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Could not save Studio project.' }, { status: 400 });
  }
}

export async function DELETE(_request, { params }) {
  if (!getStudioProject(params.id)) return NextResponse.json({ error: 'Studio project not found.' }, { status: 404 });
  deleteStudioProject(params.id);
  return NextResponse.json({ deleted: true });
}
