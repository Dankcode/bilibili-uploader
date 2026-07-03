import { computeHeatScore } from './store';

export async function clusterScenes(show, mentions = []) {
  if (!mentions.length) return [];
  const title = show?.titleEn || show?.titleZh || show?.title_zh || 'Hot scene';
  return [{
    title: `${title} audience highlight`,
    episode: mentions.find((mention) => mention.episodeHint)?.episodeHint || '',
    timeStart: mentions.find((mention) => mention.timestampHint)?.timestampHint || '',
    timeEnd: '',
    whyHot: 'Generated from the currently saved social mentions.',
    mentionIds: mentions.map((mention) => mention.id).filter(Boolean),
    heatScore: computeHeatScore(mentions),
  }];
}

export async function draftSceneScript(candidate, mentions = []) {
  const title = candidate?.title || 'Audience highlight';
  const sample = mentions.find((mention) => mention.content)?.content || '';
  return {
    hook: `Everyone is talking about ${title}.`,
    beats: [{
      tStart: candidate?.timeStart || candidate?.time_start || '',
      tEnd: candidate?.timeEnd || candidate?.time_end || '',
      voiceoverEn: sample ? `Fans reacted to this moment: ${sample.slice(0, 180)}` : `This moment is gaining attention across social posts.`,
      onScreenNote: 'Use the strongest reaction shot from the source clip.',
    }],
    outro: 'Watch the full moment and decide why it hit so hard.',
    titleEn: title.slice(0, 100),
    descriptionEn: candidate?.whyHot || '',
    tags: ['drama', 'scene', 'highlight'],
    estimatedDurationSec: 45,
  };
}

export function validateSceneScript(json) {
  const errors = [];
  if (!json || typeof json !== 'object') errors.push('script must be an object');
  if (json && typeof json.hook !== 'string') errors.push('hook must be a string');
  if (json && !Array.isArray(json.beats)) errors.push('beats must be an array');
  if (json && typeof json.titleEn !== 'string') errors.push('titleEn must be a string');
  if (json && !Array.isArray(json.tags)) errors.push('tags must be an array');
  return { ok: errors.length === 0, errors };
}
