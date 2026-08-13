import fs from 'fs';
import path from 'path';
import { completeJsonWithMeta, hasProvider } from '../../ai/getEnglish';

export const id = 'metadata';

function normalizeTags(value) {
  const tags = Array.isArray(value) ? value : String(value || '').split(/[,\n]/);
  return [...new Set(tags.map((tag) => String(tag || '').trim()).filter(Boolean))].slice(0, 20);
}

function styleInstruction(value) {
  const style = String(value || '').trim();
  if (!style || style === 'professional') return 'Professional, precise, and useful to the likely audience.';
  if (style === 'asmr') return 'Calm, personal, sleep-friendly ASMR creator voice.';
  if (style === 'educational') return 'Clear educational voice with accurate terminology and restrained claims.';
  return style;
}

function metadataPrompt({ sourceTitle, transcript, analysis, style }) {
  return `Create upload-ready English YouTube metadata from this video transcript.

Return strict JSON only:
{"titleEn":"concise English title","descriptionEn":"complete English description","tags":["tag one"]}

Rules:
- Preserve proper nouns and technical terminology.
- Do not invent facts, results, links, or affiliations.
- Keep the title under 100 characters.
- Return 8 to 15 concise tags without hash symbols.
- Editorial style: ${styleInstruction(style)}
${analysis?.tone ? `- Transcript tone: ${analysis.tone}` : ''}
${analysis?.schema ? `- Transcript schema: ${analysis.schema}` : ''}

Source title: ${sourceTitle || '(untitled)'}

Transcript:
${String(transcript || '').slice(0, 70000)}`;
}

function validateMetadata(payload) {
  const metadata = {
    titleEn: String(payload?.titleEn || payload?.Title || '').trim(),
    descriptionEn: String(payload?.descriptionEn || payload?.Description || '').trim(),
    tags: normalizeTags(payload?.tags || payload?.Tags),
  };
  if (!metadata.titleEn || !metadata.descriptionEn || metadata.tags.length === 0) {
    throw new Error('The metadata provider returned incomplete title, description, or tags.');
  }
  return metadata;
}

export async function testConnection(credentials = {}) {
  const provider = credentials.provider || globalThis.process?.env?.AI_PROVIDER || (hasProvider('kimi', credentials) ? 'kimi' : 'gemini');
  try {
    const result = await completeJsonWithMeta('Return {"ok":true}.', {
      system: 'Return strict JSON only.',
      temperature: 0,
      provider,
      credentials,
    });
    return { ok: result.data?.ok === true, detail: `${result.provider}/${result.model}` };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

export async function process(inputPath, options = {}, onProgress = () => {}, credentials = {}, currentMeta = {}) {
  if (!inputPath || !fs.existsSync(inputPath)) throw new Error(`Metadata input not found: ${inputPath}`);
  const transcript = options.transcript || currentMeta.scriptEn || currentMeta.transcriptEn || currentMeta.transcriptSource;
  if (!String(transcript || '').trim()) throw new Error('Metadata generation requires a transcript.');
  onProgress(15, 'Analyzing transcript for metadata');
  const completion = await completeJsonWithMeta(metadataPrompt({
    sourceTitle: options.sourceTitle || currentMeta.title || path.basename(inputPath, path.extname(inputPath)),
    transcript,
    analysis: options.analysis,
    style: options.style || credentials.metadataStyle,
  }), {
    system: 'You are a careful YouTube metadata editor. Return strict JSON only.',
    temperature: 0.25,
    provider: credentials.provider,
    credentials,
  });
  const metadata = validateMetadata(completion.data);
  onProgress(100, `Metadata ready from ${completion.provider}`);
  return {
    outputPath: inputPath,
    pauseForReview: Boolean(options.reviewMetadata),
    artifacts: {
      ...metadata,
      metadataProvider: completion.provider,
      metadataModel: completion.model,
      metadataReviewRequired: Boolean(options.reviewMetadata),
    },
  };
}
