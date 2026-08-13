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
 *   existingTranslation?,
 *   rescript?, rescriptStyle? }
 *
 * Returns { outputPath, artifacts:{ transcriptSource, transcriptEn, scriptEn,
 *   srtPath, translationBackend, ttsBackend, rescripted, segmentCount } }.
 */

import fs from 'fs';
import path from 'path';
import { getSttBackend } from '../../stt';
import { getBackend as getTranslationBackend, translateTranscript } from '../../translation/translator';
import { parseSrt, writeDualSrt, writeSrt } from '../../translation/srt';
import { rescriptSegments } from '../../ai/getEnglish';
import { getTtsBackend } from '../../tts';
import { burnSubtitles, extractAudio, fitClipToWindow, mixVoiceover, probeDuration } from '../../media/ffmpeg';
import { checkAndIncrementUsage } from '../usage';

export const id = 'voiceover';

function resolveCreds(credentials = {}) {
  const env = globalThis.process?.env || {};
  return {
    // transcription
    transcribeApiKey: credentials.transcribeApiKey || env.OPENAI_API_KEY || '',
    transcribeBaseUrl: credentials.transcribeBaseUrl || env.WHISPER_BASE_URL || undefined,
    transcribeModel: credentials.transcribeModel || 'whisper-1',
    sttBackend: credentials.sttBackend || 'openaiWhisper',
    sttQuality: credentials.sttQuality || 'fast',
    // translation
    translationBackend: credentials.translationBackend || 'aiProvider',
    geminiApiKey: credentials.geminiApiKey || env.GEMINI_API_KEY || '',
    geminiModel: credentials.geminiModel || env.GEMINI_MODEL || 'gemini-1.5-flash',
    geminiRefine: credentials.geminiRefine === 'on',
    // re-scripting
    rescript: credentials.rescript !== 'off',
    rescriptStyle: credentials.rescriptStyle || '',
    // tts selection
    ttsBackend: credentials.ttsBackend || env.TTS_BACKEND || 'elevenlabs',
    // elevenlabs
    elevenApiKey: credentials.elevenApiKey || env.ELEVENLABS_API_KEY || '',
    voiceId: credentials.voiceId || env.ELEVENLABS_VOICE_ID || '',
    modelId: credentials.modelId || 'eleven_multilingual_v2',
    // cosyvoice (local)
    cosyEndpoint: credentials.cosyEndpoint || env.COSYVOICE_ENDPOINT || '',
    cosyMode: credentials.cosyMode || 'zero_shot',
    cosySpeakerId: credentials.cosySpeakerId || '',
    cosyPromptWav: credentials.cosyPromptWav || '',
    cosyPromptText: credentials.cosyPromptText || '',
    cosyInstruct: credentials.cosyInstruct || '',
    // qwen3-tts (DashScope cloud or local server)
    qwenApiKey: credentials.qwenApiKey || env.DASHSCOPE_API_KEY || '',
    qwenBaseUrl: credentials.qwenBaseUrl || env.DASHSCOPE_BASE_URL || '',
    qwenModel: credentials.qwenModel || 'qwen3-tts-flash',
    qwenVoice: credentials.qwenVoice || 'Cherry',
    qwenLocalEndpoint: credentials.qwenLocalEndpoint || env.QWEN_TTS_ENDPOINT || '',
    maxDailySeconds: Number(credentials.maxDailySeconds) || 21600,
  };
}

function secondsFromTimestamp(value) {
  if (typeof value === 'number') return value;
  const text = String(value || '').trim();
  if (!text) return 0;
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text);
  const parts = text.split(':').map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part))) return 0;
  return parts.reduce((total, part) => (total * 60) + part, 0);
}

function normalizeExistingTranscript(existingTranscript) {
  if (existingTranscript?.srtPath) {
    if (!fs.existsSync(existingTranscript.srtPath)) throw new Error(`Transcript SRT not found: ${existingTranscript.srtPath}`);
    const segments = parseSrt(fs.readFileSync(existingTranscript.srtPath, 'utf8'));
    return {
      language: existingTranscript.language || 'srt',
      fullText: segments.map((segment) => segment.text).join('\n'),
      segments,
    };
  }
  const rawSegments = Array.isArray(existingTranscript)
    ? existingTranscript
    : existingTranscript?.segments;
  if (!Array.isArray(rawSegments) || rawSegments.length === 0) return null;
  const segments = rawSegments.map((seg, index) => {
    const start = secondsFromTimestamp(seg.start ?? seg.tStart);
    const rawEnd = secondsFromTimestamp(seg.end ?? seg.tEnd ?? seg.start ?? seg.tStart);
    return {
      index: Number(seg.index ?? index),
      start,
      end: rawEnd > start ? rawEnd : start + 3,
      text: String(seg.text ?? seg.textEn ?? seg.voiceoverEn ?? '').trim(),
      textEn: String(seg.textEn ?? seg.voiceoverEn ?? '').trim(),
    };
  }).filter((seg) => seg.text || seg.textEn);
  if (!segments.length) return null;
  return {
    language: existingTranscript?.language || 'script',
    fullText: segments.map((seg) => seg.text || seg.textEn).join('\n'),
    segments,
  };
}

/** Verify transcription + the SELECTED tts backend. */
export async function testConnection(credentials = {}) {
  const creds = resolveCreds(credentials);
  const sttBackend = getSttBackend(creds.sttBackend);
  const stt = await sttBackend.test(creds);
  if (!stt.ok) return { ok: false, error: `STT (${sttBackend.id}): ${stt.error}` };
  if (creds.translationBackend === 'gemini') {
    const translation = await getTranslationBackend('gemini').test(creds);
    if (!translation.ok) return { ok: false, error: `Translation (gemini): ${translation.error}` };
  }
  const ttsBackend = getTtsBackend(creds.ttsBackend);
  const tts = await ttsBackend.test(creds);
  if (!tts.ok) return { ok: false, error: `TTS (${ttsBackend.id}): ${tts.error}` };
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
  const sttBackend = getSttBackend(options.sttBackend || creds.sttBackend);
  const backend = getTtsBackend(options.ttsBackend || creds.ttsBackend);
  const workDir = path.dirname(inputPath);
  const tmpDir = path.join(workDir, 'voiceover');
  const clipsDir = path.join(tmpDir, 'clips');
  fs.mkdirSync(clipsDir, { recursive: true });

  // 1) Transcribe (or reuse a transcript the scene pipeline already produced).
  onProgress(5, 'Extracting audio');
  const suppliedTranslation = normalizeExistingTranscript(options.existingTranslation);
  let transcript = suppliedTranslation || normalizeExistingTranscript(options.existingTranscript);
  if (!transcript?.segments?.length) {
    const audioPath = path.join(tmpDir, 'source.wav');
    await extractAudio(inputPath, audioPath);
    onProgress(16, 'Transcribing source audio');
    const duration = await probeDuration(inputPath);
    checkAndIncrementUsage(
      `stt:${sttBackend.id}`,
      sttBackend.id === 'openaiWhisper' ? creds.transcribeApiKey : sttBackend.id,
      duration,
      creds.maxDailySeconds,
    );
    transcript = await sttBackend.transcribe(audioPath, {
      apiKey: creds.transcribeApiKey,
      baseURL: creds.transcribeBaseUrl,
      model: creds.transcribeModel,
      language: options.sourceLang,
      quality: options.sttQuality || creds.sttQuality,
      workDir: tmpDir,
      onProgress: (progress, note) => onProgress(16 + Math.round(progress * 0.14), note),
    });
  }

  // 2) Translate (+ transliterate). Pluggable backend.
  onProgress(32, 'Translating segments');
  let translated;
  const doRescript = options.rescript !== undefined ? options.rescript !== false : creds.rescript;
  const scriptedSegments = transcript.segments.filter((seg) => seg.textEn);
  if (scriptedSegments.length === transcript.segments.length) {
    translated = {
      backend: suppliedTranslation ? 'existingTranslation' : 'existingTranscript',
      segments: scriptedSegments,
      transcriptSource: transcript.fullText,
      transcriptEn: scriptedSegments.map((seg) => seg.textEn).join('\n'),
      partial: false,
    };
  } else {
    translated = await translateTranscript({
      segments: transcript.segments,
      sourceLang: options.sourceLang || transcript.language,
      targetLang: options.targetLang || 'English',
      backend: creds.translationBackend,
      style: options.style,
      transliterate: options.showTransliteration !== false,
      credentials: creds,
      refine: creds.translationBackend === 'gemini' && creds.geminiRefine && !doRescript,
    });
  }

  // 3) Re-script the literal translation into narration (Kimi). Non-fatal:
  //    if re-scripting fails we fall back to the literal translation.
  if (doRescript) {
    onProgress(46, 'Re-scripting narration (Kimi)');
    try {
      const rescripted = await rescriptSegments(translated.segments, {
        targetLang: options.targetLang || 'English',
        style: options.rescriptStyle || creds.rescriptStyle,
        credentials: creds,
      });
      translated.rescriptProvider = rescripted.provider;
      translated.rescriptModel = rescripted.model;
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
  const mediaDuration = await probeDuration(inputPath);
  const ttsKey = backend.id === 'elevenlabs'
    ? creds.elevenApiKey
    : backend.id === 'qwen3' ? (creds.qwenApiKey || creds.qwenLocalEndpoint) : (creds.cosyEndpoint || backend.id);
  checkAndIncrementUsage(`tts:${backend.id}`, ttsKey, mediaDuration, creds.maxDailySeconds);
  for (let i = 0; i < total; i += 1) {
    const seg = translated.segments[i];
    if (!seg.textEn) continue;
    const clipPath = path.join(clipsDir, `seg_${String(seg.index).padStart(4, '0')}.${backend.ext}`);
    const fittedPath = path.join(clipsDir, `seg_${String(seg.index).padStart(4, '0')}.fit.${backend.ext}`);
    // eslint-disable-next-line no-await-in-loop
    await backend.synthesize(seg.textEn, clipPath, creds);
    // eslint-disable-next-line no-await-in-loop
    await fitClipToWindow(clipPath, Math.max(0.08, seg.end - seg.start), fittedPath);
    clips.push({ path: fittedPath, start: seg.start });
    onProgress(48 + Math.round((i / total) * 34), `Synthesizing voice ${i + 1}/${total} (${backend.id})`);
  }
  if (clips.length === 0) throw new Error('No voiceover clips were produced (empty translation?).');

  // 5) SRT sidecar (English, optional romanization line).
  const srtPath = path.join(tmpDir, 'subtitles.en.srt');
  writeSrt(translated.segments, srtPath, { withTranslit: Boolean(options.showTransliteration) });
  const dualSrtPath = path.join(tmpDir, 'subtitles.dual.srt');
  writeDualSrt(translated.segments, dualSrtPath, { showTranslit: Boolean(options.showTransliteration) });

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
      dualSrtPath,
      sttBackend: sttBackend.id,
      translationBackend: translated.backend,
      translationProvider: translated.provider || translated.backend,
      translationModel: translated.model || null,
      rescriptProvider: translated.rescriptProvider || null,
      rescriptModel: translated.rescriptModel || null,
      ttsBackend: backend.id,
      rescripted: Boolean(doRescript),
      segmentCount: clips.length,
      durationSec: await probeDuration(outputPath).catch(() => null),
    },
  };
}
