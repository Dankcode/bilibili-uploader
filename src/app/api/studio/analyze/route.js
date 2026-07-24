import { NextResponse } from 'next/server';
import { analyzeTranscript, getTranscriptAnalysisStatus } from '@/lib/studio/analysis';
import {
  getStudioProject, publicStudioProject, updateStudioProject, updateStudioStage,
} from '@/lib/studio/store';

export const runtime = 'nodejs';
export const maxDuration = 600;

export async function GET(request) {
  const provider = new URL(request.url).searchParams.get('provider') || undefined;
  return NextResponse.json(getTranscriptAnalysisStatus(provider));
}

export async function POST(request) {
  let projectId = '';
  try {
    const body = await request.json();
    projectId = String(body.projectId || '');
    const project = getStudioProject(projectId);
    if (!project) return NextResponse.json({ error: 'Studio project not found.' }, { status: 404 });
    if (!project.transcriptMd) return NextResponse.json({ error: 'Transcribe the video before analyzing it.' }, { status: 409 });
    const status = getTranscriptAnalysisStatus(body.provider);
    if (!status.configured) {
      return NextResponse.json({
        error: status.selected
          ? `The ${status.selected} transcript analysis provider is not configured.`
          : 'No transcript analysis provider is configured.',
        code: 'ANALYSIS_PROVIDER_NOT_CONFIGURED',
      }, { status: 409 });
    }
    updateStudioStage(projectId, 'analyze', 'running', `Analyzing transcript with ${status.selected}`);
    const result = await analyzeTranscript(project.transcriptMd, {
      provider: status.selected,
      temperature: body.temperature,
    });
    const analysis = {
      ...result,
      originalTone: result.tone,
      originalSchema: result.schema,
      updatedAt: result.generatedAt,
    };
    updateStudioProject(projectId, { analysis });
    const next = updateStudioStage(projectId, 'analyze', 'done', `${result.providerLabel} - ${result.model}`);
    return NextResponse.json({ project: publicStudioProject(next), analysis });
  } catch (error) {
    if (projectId && getStudioProject(projectId)) updateStudioStage(projectId, 'analyze', 'failed', error.message);
    return NextResponse.json({ error: error.message || 'Transcript analysis failed.' }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const body = await request.json();
    const project = getStudioProject(body.projectId);
    if (!project) return NextResponse.json({ error: 'Studio project not found.' }, { status: 404 });
    if (!project.analysis?.generatedAt) return NextResponse.json({ error: 'Analyze the transcript before editing its tone or schema.' }, { status: 409 });
    const tone = String(body.tone || '').trim();
    const schema = String(body.schema || '').trim();
    if (!tone || !schema) return NextResponse.json({ error: 'Tone and schema cannot be empty.' }, { status: 400 });
    if (tone === project.analysis.tone && schema === project.analysis.schema) {
      return NextResponse.json({ project: publicStudioProject(project), unchanged: true });
    }
    const next = updateStudioProject(project.id, {
      analysis: { ...project.analysis, tone, schema, updatedAt: new Date().toISOString() },
    });
    return NextResponse.json({ project: publicStudioProject(next), unchanged: false });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Could not save transcript analysis.' }, { status: 500 });
  }
}
