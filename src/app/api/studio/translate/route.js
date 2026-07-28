import { promises as fs } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { buildSubtitleContextHints } from '@/lib/studio/context';
import { translateSubtitles } from '@/lib/studio/kimi';
import { parseTranscriptMarkdown } from '@/lib/studio/markdown';
import { buildAss, buildSrt } from '@/lib/studio/subtitles';
import { maybeAutoPublishStudioProject } from '@/lib/studio/publish';
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
    const parsed = parseTranscriptMarkdown(project.transcriptMd);
    if (!parsed.segments.length) return NextResponse.json({ error: 'Transcribe the video before translating.' }, { status: 409 });
    updateStudioStage(projectId, 'translate', 'running', 'Translating subtitles');
    const sourceAss = buildAss(parsed.segments, { title: project.name });
    const contextHints = buildSubtitleContextHints(parsed.segments, project.contextManifest);
    const translated = await translateSubtitles(sourceAss, {
      from: body.from || project.sourceLang,
      to: body.to || project.targetLang,
      model: body.model,
      temperature: body.temperature,
      contextHints,
    });
    const srtText = buildSrt(translated.segments, { dual: true });
    const directory = ensureProjectDirectory(projectId);
    await Promise.all([
      fs.writeFile(path.join(directory, 'subtitles.ass'), translated.text, 'utf8'),
      fs.writeFile(path.join(directory, 'subtitles.srt'), srtText, 'utf8'),
    ]);
    updateStudioProject(projectId, { subtitleText: translated.text, format: 'ass' });
    const next = updateStudioStage(
      projectId,
      'translate',
      'done',
      `${translated.segments.length} cues - ${translated.provider}/${translated.model}`,
    );
    const autoPublish = maybeAutoPublishStudioProject(projectId);
    const finalProject = getStudioProject(projectId) || next;
    return NextResponse.json({
      project: publicStudioProject(finalProject), subtitleText: translated.text, autoPublish,
    });
  } catch (error) {
    if (projectId && getStudioProject(projectId)) updateStudioStage(projectId, 'translate', 'failed', error.message);
    return NextResponse.json({ error: error.message || 'Translation failed.' }, { status: 500 });
  }
}
