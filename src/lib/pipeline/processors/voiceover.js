/**
 * ENGLISH VOICEOVER PROCESSOR — automated dub of a source-language video.
 *
 *   source video ─► extract audio ─► transcribe (Whisper, timestamped)
 *                 ─► translate + transliterate  (translation module)
 *                 ─► RE-SCRIPT with Kimi        (polish literal → narration)
 *                 ─► TTS per segment            (ElevenLabs OR CosyVoice local)
 *                 ─► ffmpeg: duck original + overlay EN speech (+ optional subs)
 *                 ─► dubbed video
 *
 * Fully automated: given a configured "voiceover" connection it runs end to end
 * with no human step. Two pluggable seams:
 *   • translationBackend: 'aiProvider' (default) | 'liveTranslation'
 *   • ttsBackend:         'elevenlabs' (default) | 'cosyvoice' (Alibaba, local)
 *
 * CONNECTION credentials (Settings ▸ voiceover) — all persist on Save:
 *   transcribeApiKey / transcribeBaseUrl / transcribeModel   (Whisper)
 *   ttsBackend                                               ('elevenlabs'|'cosyvoice')
 *   elevenApiKey / voiceId / modelId                         (ElevenLabs)
 *   cosyEndpoint / cosyMode / cosySpeakerId /
 *     cosyPromptWav / cosyPromptText                         (CosyVoice)
 *   translationBackend                                       ('aiProvider'|'liveTranslation')
 *   rescript ('on'|'off') / rescriptStyle                    (Kimi re-scripting)
 *
 * options (per-job): { sourceLang?, targetLang?='en', style?, burnSubtitles?,
 *   showTransliteration?, keepOriginalAudioLevel?=0.15, existingTranscript?,
 *   rescript?, rescriptStyle? }
 *
 * Returns { outputPath, artifacts:{ transcriptSource, transcriptEn, scriptEn,
 *   srtPath, translationBackend, ttsBackend, rescripted, segmentCount } }.
 */

import fs from 'fs';
import path from 'path';
import { transcribe } from '../../translation/whisper';
import { translateTranscript } from '../../translation/translator';
import { writeSrt } from '../../translation/srt';
import { rescriptSegments } from '../../ai/getEnglish';
import { getTtsBackend } from '../../tts';
import { extractAudio, probeDuration, mixVoiceover, burnSubtitles } from '../../media/ffmpeg';

export const id = 'voiceover';

function resolveCreds(credentials = {}) {
  return {
    // transcription
    transcribeApiKey: credentials.transcribeApiKey || process.env.OPENAI_API_KEY || '',
    transcribeBaseUrl: credentials.transcribeBaseUrl || process.env.WHISPER_BASE_URL || undefined,
    transcribeModel: credentials.transcribeModel || 'whisper-1',
    // translation
    translationBackend: credentials.translationBackend || 'aiProvider',
    // re-scripting
    rescript: credentials.rescript !== 'off',
    rescriptStyle: credentials.rescriptStyle || '',
    // tts selection
    ttsBackend: credentials.ttsBackend || process.env.TTS_BACKEND || 'elevenlabs',
    // elevenlabs
    elevenApiKey: credentials.elevenApiKey || process.env.ELEVENLABS_API_KEY || '',
    voiceId: credentials.voiceId || process.env.ELEVENLABS_VOICE_ID || '',
    modelId: credentials.modelId || 'eleven_multilingual_v2',
    // cosyvoice (local)
    cosyEndpoint: credentials.cosyEndpoint || process.env.COSYVOICE_ENDPOINT || '',
    cosyMode: credentials.cosyMode || 'zero_shot',
    cosySpeakerId: credentials.cosySpeakerId || '',
    cosyPromptWav: credentials.cosyPromptWav || '',
    cosyPromptText: credentials.cosyPromptText || '',
    cosyInstruct: credentials.cosyInstruct || '',
    // qwen3-tts (DashScope cloud or local server)
    qwenApiKey: credentials.qwenApiKey || process.env.DASHSCOPE_API_KEY || '',
    qwenBaseUrl: credentials.qwenBaseUrl || process.env.DASHSCOPE_BASE_URL || '',
    qwenModel: credentials.qwenModel || 'qwen3-tts-flash',
    qwenVoice: credentials.qwenVoice || 'Cherry',
    qwenLocalEndpoint: credentials.qwenLocalEndpoint || process.env.QWEN_TTS_ENDPOINT || '',
  };
}

/** Verify transcription + the SELECTED tts backend. */
export async function testConnection(credentials = {}) {
  const creds = resolveCreds(credentials);
  if (!creds.transcribeApiKey) return { ok: false, error: 'Transcription API key is not configured.' };
  const backend = getTtsBackend(creds.ttsBackend);
  const tts = await backend.test(creds);
  if (!tts.ok) return { ok: false, error: `TTS (${backend.id}): ${tts.error}` };
  return { ok: true };
}

/**
 * @param {string} inputPath   source video
 * @param {object} options     per-job options (see header)
 * @param {function} onProgress (0..100, note)
 * @param {object} credentials  the 'voiceover' connection credentials
 */
export async function process(inputPath, options = {}, onProgress = () => {}, credentials = {}) {
  if (!inputPath || !fs.existsSync(inputPath)) throw new Error(`Voiceover input not found: ${inputPath}`);
  const creds = resolveCreds(credentials);
  if (!creds.transcribeApiKey) throw new Error('Voiceover: transcription API key is not configured.');

  const backend = getTtsBackend(creds.ttsBackend);
  const workDir = path.dirname(inputPath);
  const tmpDir = path.join(workDir, 'voiceover');
  const clipsDir = path.join(tmpDir, 'clips');
  fs.mkdirSync(clipsDir, { recursive: true });

  // 1) Transcribe (or reuse a transcript the scene pipeline already produced).
  onProgress(5, 'Extracting audio');
  let transcript = options.existingTranscript;
  if (!transcript?.segments?.length) {
    const audioPath = path.join(tmpDir, 'source.wav');
    await extractAudio(inputPath, audioPath);
    onProgress(16, 'Transcribing source audio');
    transcript = await transcribe(audioPath, {
      apiKey: creds.transcribeApiKey,
      baseURL: creds.transcribeBaseUrl,
      model: creds.transcribeModel,
      language: options.sourceLang,
    });
  }

  // 2) Translate (+ transliterate). Pluggable backend.
  onProgress(32, 'Translating segments');
  const translated = await translateTranscript({
    segments: transcript.segments,
    sourceLang: options.sourceLang || transcript.language,
    targetLang: options.targetLang || 'English',
    backend: creds.translationBackend,
    style: options.style,
    transliterate: options.showTransliteration !== false,
  });

  // 3) Re-script the literal translation into narration (Kimi). Non-fatal:
  //    if re-scripting fails we fall back to the literal translation.
  const doRescript = options.rescript !== undefined ? options.rescript !== false : creds.rescript;
  if (doRescript) {
    onProgress(46, 'Re-scripting narration (Kimi)');
    try {
      const rescripted = await rescriptSegments(translated.segments, {
        targetLang: options.targetLang || 'English',
        style: options.rescriptStyle || creds.rescriptStyle,
      });
      const byIndex = new Map(rescripted.map((r) => [r.index, r.textEn]));
      translated.segments = translated.segments.map((s) => ({ ...s, textEn: byIndex.get(s.index) || s.textEn }));
    } catch (error) {
      onProgress(46, `Re-script skipped: ${error.message}`);
    }
  }
  const scriptEn = translated.segments.map((s) => s.textEn).filter(Boolean).join('\n');

  // 4) TTS each segment with the selected backend.
  const clips = [];
  const total = translated.segments.length;
  for (let i = 0; i < total; i += 1) {
    const seg = translated.segments[i];
    if (!seg.textEn) continue;
    const clipPath = path.join(clipsDir, `seg_${String(seg.index).padStart(4, '0')}.${backend.ext}`);
    // eslint-disable-next-line no-await-in-loop
    await backend.synthesize(seg.textEn, clipPath, creds);
    clips.push({ path: clipPath, start: seg.start });
    onProgress(48 + Math.round((i / total) * 34), `Synthesizing voice ${i + 1}/${total} (${backend.id})`);
  }
  if (clips.length === 0) throw new Error('No voiceover clips were produced (empty translation?).');

  // 5) SRT sidecar (English, optional romanization line).
  const srtPath = path.join(tmpDir, 'subtitles.en.srt');
  writeSrt(translated.segments, srtPath, { withTranslit: Boolean(options.showTransliteration) });

  // 6) Mix: duck original audio + overlay the English voiceover.
  onProgress(84, 'Mixing voiceover into video');
  const mixedPath = path.join(tmpDir, 'dubbed.mp4');
  await mixVoiceover({
    videoPath: inputPath,
    clips,
    outPath: mixedPath,
    originalVolume: Number(options.keepOriginalAudioLevel ?? 0.15),
    onProgress: (p) => onProgress(84 + Math.min(8, Math.round((p.percent || 0) / 12)), 'Mixing audio'),
  });

  // 7) Optional burned-in subtitles.
  let outputPath = mixedPath;
  if (options.burnSubtitles) {
    onProgress(94, 'Burning subtitles');
    const subbedPath = path.join(tmpDir, 'dubbed.subbed.mp4');
    await burnSubtitles(mixedPath, srtPath, subbedPath);
    outputPath = subbedPath;
  }

  onProgress(100, 'Voiceover complete');
  return {
    outputPath,
    artifacts: {
      transcriptSource: translated.transcriptSource,
      transcriptEn: translated.transcriptEn,
      scriptEn,
      srtPath,
      translationBackend: translated.backend,
      ttsBackend: backend.id,
      rescripted: Boolean(doRescript),
      segmentCount: clips.length,
      durationSec: await probeDuration(outputPath).catch(() => null),
    },
  };
}
