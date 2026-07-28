import { promises as fs } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { buildSubtitleContextHints } from '@/lib/studio/context';
import { refineSubtitles } from '@/lib/studio/kimi';
import { buildSrt, parseAss } from '@/lib/studio/subtitles';
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
    if (!project.subtitleText) return NextResponse.json({ error: 'Translate subtitles before refining them.' }, { status: 409 });
    const instruction = String(body.instruction || '').trim();
    if (!instruction) {
      return NextResponse.json({
        project: publicStudioProject(project),
        unchanged: true,
        message: 'No refine changes were supplied. Subtitles were left unchanged.',
      });
    }
    updateStudioStage(projectId, 'refine', 'running', instruction.slice(0, 120));
    const before = parseAss(project.subtitleText);
    const refined = await refineSubtitles(project.subtitleText, instruction, {
      history: project.chatHistory,
      model: body.model,
      temperature: body.temperature,
      contextHints: buildSubtitleContextHints(before, project.contextManifest),
    });
    const translationChanged = refined.segments.some((segment, index) => segment.textEn !== before[index]?.textEn);
    if (!translationChanged) {
      const unchanged = updateStudioStage(projectId, 'refine', 'skipped', 'Provider returned no subtitle text changes');
      return NextResponse.json({
        project: publicStudioProject(unchanged),
        unchanged: true,
        message: 'The provider returned no text changes. Subtitles were left unchanged.',
      });
    }
    const history = [...project.chatHistory, {
      instruction,
      model: refined.model,
      createdAt: new Date().toISOString(),
    }].slice(-20);
    const directory = ensureProjectDirectory(projectId);
    await Promise.all([
      fs.writeFile(path.join(directory, 'subtitles.ass'), refined.text, 'utf8'),
      fs.writeFile(path.join(directory, 'subtitles.srt'), buildSrt(refined.segments, { dual: true }), 'utf8'),
    ]);
    updateStudioProject(projectId, { subtitleText: refined.text, chatHistory: history, format: 'ass' });
    const next = updateStudioStage(
      projectId,
      'refine',
      'done',
      `Revision ${history.length} - ${refined.provider}/${refined.model}`,
    );
    return NextResponse.json({ project: publicStudioProject(next) });
  } catch (error) {
    if (projectId && getStudioProject(projectId)) updateStudioStage(projectId, 'refine', 'failed', error.message);
    return NextResponse.json({ error: error.message || 'Subtitle refinement failed.' }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const body = await request.json();
    const project = getStudioProject(body.projectId);
    if (!project) return NextResponse.json({ error: 'Studio project not found.' }, { status: 404 });
    const next = updateStudioProject(project.id, { chatHistory: [] });
    return NextResponse.json({ project: publicStudioProject(next) });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Could not reset refine history.' }, { status: 500 });
  }
}
