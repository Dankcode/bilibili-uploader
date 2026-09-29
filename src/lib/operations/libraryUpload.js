import fs from 'node:fs';
import db from '../db/sqlite.js';
import { savedVideo } from '../pipeline/sources/library.js';
import { uploadBlocker, generationSettings, sourceIdentity } from './uploadCatalog.js';
import { updateVideoRecord } from './store.js';
import { createJobBatch } from '../pipeline/pipeline.js';

export function queueLibraryUploads(input = {}, { principal = '' } = {}) {
  const ids = [...new Set(Array.isArray(input.videoIds) ? input.videoIds.map(String) : [])];
  if (!ids.length || ids.length > 100) throw new Error('Select between 1 and 100 library videos');
  if (input.metadataMode && !['saved', 'generate'].includes(input.metadataMode)) throw new Error('Invalid metadata mode');
  const spacing = Number(input.spacingMinutes ?? 0);
  if (!Number.isFinite(spacing) || spacing < 0 || spacing > 525600) throw new Error('Invalid upload spacing');
  const start = input.startAt ? new Date(input.startAt).getTime() : Date.now();
  if (!Number.isFinite(start)) throw new Error('Invalid start time');
  const privacyStatus = input.privacyStatus || 'private';
  if (!['private', 'unlisted', 'public'].includes(privacyStatus)) throw new Error('Invalid visibility');
  return db.transaction(() => {
    const itemsSeen = [];
    const items = ids.map((id, index) => {
      const video = savedVideo(id);
      const blocker = uploadBlocker(id);
      if (blocker) throw new Error(`${video.title} already has ${blocker.reason}${blocker.url ? ': ' + blocker.url : ''}`);
      const duplicate = itemsSeen.find((entry) => entry.keys.some((key) => sourceIdentity(key) && sourceIdentity(key) === sourceIdentity(video.row.source_url || video.row.source_ref)));
      if (duplicate) throw new Error('The same source video appears more than once in this batch');
      itemsSeen.push({ keys: [video.row.source_url, video.row.source_ref] });
      const generation = generationSettings({ ...video.metadata.uploadGeneration,
        ...(input.personality === undefined ? {} : { personality: input.personality }),
        ...(input.context === undefined ? {} : { context: input.context }) });
      const saved = video.metadata.uploadMetadata || {};
      const useSaved = input.metadataMode === 'saved';
      if (useSaved && (!saved.titleEn || !saved.descriptionEn || !saved.tags?.length)) throw new Error(`${video.title}: save title, description and tags first`);
      updateVideoRecord(id, { metadata: { uploadGeneration: generation } });
      const local = video.filePath && fs.existsSync(video.filePath) && fs.statSync(video.filePath).isFile();
      const sourceId = local ? 'library' : video.row.source_type;
      if (!['library', 'bilibili', 'douyin'].includes(sourceId)) throw new Error(`${video.title}: download this source into the library first`);
      return { videoRecordId: id, title: video.title, sourceId, agentPrincipal: principal,
        sourceDurationSeconds: video.row.duration_seconds || 0,
        sourceInput: local ? id : (video.row.source_url || video.row.source_ref),
        processorIds: ['metadata'], uploaderId: 'youtube',
        youtubeAuthorizationId: input.youtubeAuthorizationId || '', uploadMethod: input.uploadMethod || 'studio',
        scheduledFor: input.startAt || spacing ? new Date(start + index * spacing * 60000).toISOString() : '',
        options: { metadata: { sourceTitle: video.title, sourceDescription: video.description,
          transcript: video.metadata.transcriptEn || video.metadata.transcriptSource || '',
          style: generation.personality, copyPrompt: generation.context,
          generationFields: useSaved ? [] : ['title', 'description', 'tags'],
          title: saved.titleEn || '', description: saved.descriptionEn || '', tags: saved.tags || [],
          reviewMetadata: Boolean(principal) || input.reviewMetadata !== false },
          youtube: { uploadMethod: input.uploadMethod || 'studio', privacyStatus } } };
    });
    return createJobBatch({ name: input.name || 'Library uploads', items });
  })();
}
