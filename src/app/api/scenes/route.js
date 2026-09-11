import { withOperator } from '../../../lib/agent/auth.js';
import { NextResponse } from 'next/server';
import {
  approveSceneScript,
  computeHeatScore,
  listMentions,
  listSceneCandidates,
  listShows,
  saveSceneCandidates,
  saveSceneScript,
  updateCandidateStatus,
  upsertShow,
} from '../../../lib/scenes/store';
import { createJob } from '../../../lib/pipeline/pipeline';

async function handleGET(request) {
  const { searchParams } = new URL(request.url);
  const showId = Number(searchParams.get('showId') || 0);
  return NextResponse.json({
    shows: listShows(),
    candidates: showId ? listSceneCandidates(showId) : [],
    mentions: showId ? listMentions(showId).slice(0, 50) : [],
  });
}

async function handlePOST(request) {
  try {
    const body = await request.json();
    if (body.action === 'add-show') {
      return NextResponse.json({ show: upsertShow(body) });
    }
    if (body.action === 'scrape') {
      return NextResponse.json(
        { error: 'Scene scraping needs a configured site adapter/login before it can run.' },
        { status: 409 }
      );
    }
    if (body.action === 'analyze') {
      const mentions = listMentions(body.showId);
      if (!mentions.length) {
        return NextResponse.json({ candidates: [] });
      }
      const candidate = {
        title: body.title || 'Hot scene candidate',
        heatScore: computeHeatScore(mentions),
        whyHot: 'Ranked from saved social mentions.',
        mentionIds: mentions.map((mention) => mention.id),
      };
      return NextResponse.json({ candidates: saveSceneCandidates(body.showId, [candidate]) });
    }
    if (body.action === 'draft-script') {
      const script = {
        hook: body.hook || '',
        beats: Array.isArray(body.beats) ? body.beats : [],
        outro: body.outro || '',
        titleEn: body.titleEn || '',
        descriptionEn: body.descriptionEn || '',
        tags: Array.isArray(body.tags) ? body.tags : [],
        approved: false,
      };
      return NextResponse.json({ script: saveSceneScript(body.candidateId, script) });
    }
    if (body.action === 'approve') {
      return NextResponse.json({ candidate: approveSceneScript(body.candidateId) });
    }
    if (body.action === 'reject') {
      return NextResponse.json({ candidate: updateCandidateStatus(body.candidateId, 'rejected') });
    }
    if (body.action === 'produce') {
      if (!body.sourceInput) throw new Error('sourceInput is required to produce a scene video');
      const job = createJob({
        sourceId: body.sourceId || 'bilibili',
        sourceInput: body.sourceInput,
        processorIds: ['sceneCut', 'voiceover'],
        uploaderId: 'youtube',
        sceneScriptId: body.scriptId || null,
        options: {
          sceneCut: { clips: body.clips || [] },
          voiceover: { existingTranscript: body.voiceover || null },
          youtube: { privacyStatus: 'private' },
        },
      });
      return NextResponse.json({ job });
    }
    return NextResponse.json(
      { error: 'Unknown action. Valid actions: add-show|scrape|analyze|draft-script|approve|reject|produce' },
      { status: 400 }
    );
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export const GET = withOperator(handleGET);
export const POST = withOperator(handlePOST);
