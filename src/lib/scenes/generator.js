import { createJob } from '../pipeline/pipeline';

export async function generateSceneVideo(candidateId, { sourceId = 'bilibili', sourceInput, script, clips = [] } = {}) {
  if (!candidateId) throw new Error('candidateId is required');
  if (!sourceInput) throw new Error('sourceInput is required');
  return createJob({
    sourceId,
    sourceInput,
    processorIds: ['sceneCut', 'voiceover'],
    uploaderId: 'youtube',
    sceneScriptId: script?.id || null,
    options: {
      sceneCut: { clips },
      voiceover: { existingTranscript: fromScript(script || {}) },
      youtube: {
        title: script?.titleEn || 'Scene highlight',
        description: script?.descriptionEn || '',
        tags: script?.tags || [],
        privacyStatus: 'private',
      },
    },
  });
}

export function fromScript(script = {}) {
  return (script.beats || []).map((beat) => ({
    start: beat.tStart || beat.start || '',
    end: beat.tEnd || beat.end || '',
    textEn: beat.voiceoverEn || beat.textEn || '',
  }));
}
