import fs from 'fs';
import path from 'path';
import { parseTranscriptMarkdown } from './markdown.js';
import { parseSubtitle } from './subtitles.js';

function translatedSegments(project) {
  if (project.subtitleText) {
    const parsed = parseSubtitle(project.subtitleText, project.format);
    if (!parsed.length) throw new Error('The saved subtitle document has no timestamped cues.');
    return parsed;
  }
  const parsed = parseTranscriptMarkdown(project.transcriptMd);
  if (!parsed.segments.length) throw new Error('Transcribe the project before publishing it.');
  if (project.sourceLang !== project.targetLang) {
    throw new Error('Translate the project before sending it to voiceover.');
  }
  return parsed.segments.map((segment) => ({ ...segment, textEn: segment.text }));
}

function metadataFrames(project, includeFrames) {
  if (!includeFrames) return [];
  const root = path.join(path.dirname(project.videoPath), 'frames');
  return project.frameManifest.slice(0, 3).map((frame) => path.join(root, frame.file))
    .filter((filePath) => fs.existsSync(filePath));
}

export function buildStudioPipelineInput(project, options = {}) {
  if (!project?.id || !project.videoPath || !fs.existsSync(project.videoPath)) {
    throw new Error('The Studio project video is missing.');
  }
  const voiceover = options.voiceover !== false;
  const metadata = options.metadata !== false;
  const upload = Boolean(options.upload);
  if (!voiceover && !metadata && !upload) throw new Error('Select at least one publish step.');

  const segments = translatedSegments(project);
  if (voiceover && segments.some((segment) => !String(segment.textEn || '').trim())) {
    throw new Error('Every subtitle cue needs translated text before voiceover.');
  }
  const processorIds = [
    ...(voiceover ? ['voiceover'] : []),
    ...(metadata ? ['metadata'] : []),
  ];
  const transcript = segments.map((segment) => segment.textEn || segment.text).filter(Boolean).join('\n');
  return {
    sourceId: 'localFile',
    sourceInput: project.videoPath,
    processorIds,
    uploaderId: upload ? 'youtube' : '',
    options: {
      ...(voiceover ? {
        voiceover: {
          existingTranslation: {
            language: project.targetLang,
            sourceLanguage: project.sourceLang,
            segments,
          },
          sourceLang: project.sourceLang,
          targetLang: project.targetLang,
          burnSubtitles: Boolean(options.burnSubtitles),
          ...(options.rescript === undefined ? {} : { rescript: Boolean(options.rescript) }),
        },
      } : {}),
      ...(metadata ? {
        metadata: {
          transcript,
          sourceTitle: path.basename(project.name, path.extname(project.name)),
          analysis: project.analysis || {},
          framePaths: metadataFrames(project, options.includeFrames),
          reviewMetadata: Boolean(options.reviewMetadata),
          style: options.metadataStyle || '',
        },
      } : {}),
      ...(upload ? {
        youtube: {
          ...(options.authorizationId ? { authorizationId: options.authorizationId } : {}),
          ...(options.channelId ? { channelId: options.channelId } : {}),
          privacyStatus: options.privacyStatus || 'private',
        },
      } : {}),
    },
  };
}
