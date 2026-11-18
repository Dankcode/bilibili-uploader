import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { withEditor } from '../../videoEditor/client.js';
import { agentInputRequired } from '../agentInput.js';

export const id = 'videoEditor';
const REQUIRED_TOOLS = ['get_status', 'create_project', 'get_project', 'autopilot', 'render', 'get_job', 'cancel_job', 'get_transcript'];

export async function testConnection(credentials = {}) {
  try {
    return await withEditor(credentials, async ({ client, call }) => {
      const names = new Set();
      let cursor;
      do {
        const page = await client.listTools(cursor ? { cursor } : {});
        for (const tool of page.tools) names.add(tool.name);
        cursor = page.nextCursor;
      } while (cursor);
      const missing = REQUIRED_TOOLS.filter((name) => !names.has(name));
      if (missing.length) throw new Error(`Video editor MCP is missing: ${missing.join(', ')}`);
      const status = await call('get_status');
      if (!status.ffmpeg?.ready) throw new Error('Video editor ffmpeg is not ready. Configure it in video-automation.');
      return { ok: true };
    });
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

// Media bytes use the editor's streaming file API; every editing operation uses MCP.
// The uploader owns only this checkpoint and its downloaded publishing asset.
export async function process(inputPath, options = {}, onProgress = () => {}, credentials = {}, currentMeta = {}, context = {}) {
  if (!inputPath || !path.isAbsolute(inputPath) || !fs.statSync(inputPath).isFile()) throw new Error('Video editor requires an existing absolute video path.');
  const mode = options.mode || 'localize';
  if (!['localize', 'render', 'clean'].includes(mode)) throw new Error('Video editor mode must be localize, render or clean.');
  const clean = mode === 'clean' ? cleanOptions(options) : null;
  const quality = options.quality || 'high';
  if (!['high', 'draft'].includes(quality)) throw new Error('Video editor quality must be high or draft.');
  const direction = options.direction || 'zh-to-en';
  if (!['zh-to-en', 'en-to-zh'].includes(direction)) throw new Error('Video editor direction must be zh-to-en or en-to-zh.');
  const workDir = context.workDir || path.dirname(inputPath);
  await fsp.mkdir(workDir, { recursive: true });
  const checkpointPath = context.workDir ? path.join(workDir, 'video-editor.json') : `${inputPath}.video-editor.json`;
  const outputPath = path.join(workDir, `${path.basename(inputPath, path.extname(inputPath))}.edited.mp4`);
  const timeoutMs = Number(credentials.timeoutMs) > 0 ? Number(credentials.timeoutMs) : 6 * 60 * 60 * 1000;
  const deadline = Date.now() + timeoutMs;
  return withEditor(credentials, async ({ endpoint, headers, call }) => {
    const stat = fs.statSync(inputPath);
    const fingerprint = createHash('sha256').update(JSON.stringify({ endpoint: endpoint.href, inputPath, size: stat.size, mtime: stat.mtimeMs, options })).digest('hex');
    const state = fs.existsSync(checkpointPath) ? JSON.parse(await fsp.readFile(checkpointPath, 'utf8')) : { fingerprint };
    if (state.fingerprint !== fingerprint) throw new Error(`Video editor settings or input changed. Use a new job; checkpoint: ${checkpointPath}`);
    if (state.pending) throw new Error(`Video editor ${state.pending} submission has an unknown outcome. Inspect the editor before retrying; checkpoint: ${checkpointPath}`);
    async function save() {
      await fsp.writeFile(`${checkpointPath}.tmp`, JSON.stringify(state, null, 2));
      await fsp.rename(`${checkpointPath}.tmp`, checkpointPath);
    }
    async function submit(key, action) {
      if (state[key]) return state[key];
      state.pending = key;
      await save();
      const result = await action();
      state[key] = result;
      delete state.pending;
      await save();
      return result;
    }
    async function transfer(percent, note, action) {
      const controller = new AbortController();
      let cancellation;
      const heartbeat = setInterval(() => {
        try { onProgress(percent, note); } catch (error) { cancellation = error; controller.abort(); }
      }, 5000);
      try {
        return await action(AbortSignal.any([controller.signal, AbortSignal.timeout(30 * 60 * 1000)]));
      } catch (error) {
        throw cancellation || error;
      } finally {
        clearInterval(heartbeat);
      }
    }
    async function waitFor(key, tool, args, from, to, label = '') {
      let job = await submit(key, async () => {
        const response = await call(tool, args);
        if (!response.job?.id) throw new Error(`Video editor ${tool} did not return a job ID.`);
        return { id: response.job.id };
      });
      while (true) {
        // Always refresh persisted IDs: the editor may have completed after a worker restart.
        job = await call('get_job', { jobId: job.id });
        try {
          onProgress(from + (to - from) * Math.max(0, Math.min(1, Number(job.progress) || 0)), `${label || 'Video editor'}: ${job.message || job.status}`);
        } catch (error) {
          if (error.message === 'Job canceled') await call('cancel_job', { jobId: job.id }).catch(() => {});
          throw error;
        }
        if (job.status === 'done') return job.result;
        if (['failed', 'canceled', 'interrupted'].includes(job.status)) {
          // Forget the finished-badly job so a retry submits this stage again;
          // completed stages before it stay checkpointed and are not redone.
          delete state[key];
          await save();
          throw new Error(`Video editor job ${job.id}: ${job.error?.message || job.error || job.status}`);
        }
        if (Date.now() >= deadline) throw new Error(`Video editor job ${job.id} timed out; retry resumes the saved job.`);
        await delay(2000);
      }
    }
    onProgress(1, 'Connecting to video editor MCP');
    const textModel = (status) => status.providers?.llm || status.providers?.gemini || status.providers?.codex;
    if (mode === 'localize' && !state.localization) {
      const status = await call('get_status');
      if (!textModel(status)) throw new Error('Configure a translation/vision provider in video-automation before automatic localization, or choose render mode.');
    }
    if (clean && !state.render) {
      // Fail before uploading anything if the editor cannot do what was asked.
      const status = await call('get_status');
      const caps = status.capabilities || {};
      const missing = [
        clean.overlayProfile && !caps.overlayReconstruction && 'overlay reconstruction (local Python/OpenCV)',
        clean.transcribe && !caps.speech && 'speech-to-text (Whisper)',
        clean.screenText && !caps.screenTextOverlays && 'on-screen text reading (local OCR)',
        (clean.transcribe || clean.screenText) && clean.translator === 'model' && !textModel(status) && 'a translation model',
        (clean.transcribe || clean.screenText) && clean.translator === 'agent' && !caps.agentTranslation && 'agent translation (request_translation; update video-automation)',
      ].filter(Boolean);
      if (missing.length) throw new Error(`Video editor cannot run the clean workflow: missing ${missing.join(', ')}.`);
      if (clean.overlayProfile) {
        const { profiles = [] } = await call('list_overlay_profiles');
        if (!profiles.some((profile) => profile.id === clean.overlayProfile)) throw new Error(`Video editor has no overlay profile "${clean.overlayProfile}". Save the channel's watermark mask first (save_overlay_profile).`);
      }
    }
    const project = await submit('project', () => call('create_project', {
      name: String(options.name || currentMeta.title || path.basename(inputPath)).slice(0, 160), mode: direction,
    }));
    if (!/^prj_[a-z0-9]{10}$/.test(project.id)) throw new Error('Video editor returned an invalid project ID.');
    const apiUrl = (suffix) => new URL(`/api/v1/projects/${project.id}/${suffix}`, endpoint);
    await submit('media', async () => {
      onProgress(3, 'Sending source video to editor');
      const url = apiUrl('media');
      url.searchParams.set('filename', path.basename(inputPath));
      return transfer(3, 'Sending source video to editor', async (signal) => {
        const response = await fetch(url, {
          method: 'PUT', headers: { ...headers, 'Content-Type': 'application/octet-stream' },
          body: fs.createReadStream(inputPath), duplex: 'half', redirect: 'error', signal,
        });
        if (!response.ok) throw new Error(`Video editor media import failed (HTTP ${response.status}).`);
        const data = await response.json();
        if (!data.file?.id) throw new Error('Video editor import returned no file ID.');
        return { id: data.file.id };
      });
    });
    if (mode === 'localize') await waitFor('localization', 'autopilot', { projectId: project.id }, 5, 65);
    const report = {};
    if (clean) {
      await submit('settings', () => call('update_settings', {
        projectId: project.id, mode: direction, workflow: 'subtitles',
        ...(clean.glossary.length ? { glossary: clean.glossary } : {}),
        ...(clean.context ? { context: clean.context } : {}),
        subtitles: { layout: clean.subtitleLayout },
      }).then(() => ({ ok: true })));
      if (clean.overlayProfile) {
        report.overlay = await waitFor('overlay', 'reconstruct_overlay', { projectId: project.id, profile: clean.overlayProfile }, 5, 25, 'Removing watermark');
      }
      // A transcript saved for this source (any earlier project) is reused as-is:
      // no transcription, OCR or translation round-trip.
      const reference = clean.libraryReference || libraryReference(currentMeta);
      if (reference && clean.reuseLibrary && !state.library) {
        const saved = await call('get_transcript_library', { reference }).catch(() => ({ found: false }));
        state.library = saved.found ? { reference, ...(await call('apply_transcript_library', { projectId: project.id, reference })) } : { reference, applied: false };
        await save();
      }
      report.library = state.library || null;
      const reused = Boolean(state.library?.speechCues || state.library?.screenLines);
      if (clean.transcribe && !reused) {
        report.speech = await waitFor('speech', 'transcribe', { projectId: project.id, allowNoSpeech: true }, 25, 45, 'Transcribing speech');
        if (clean.translator === 'model' && Number(report.speech?.cues) > 0) report.speechTranslation = await waitFor('speechTranslation', 'translate', { projectId: project.id, scope: 'transcript' }, 45, 50, 'Translating speech');
      }
      if (clean.screenText && !reused) {
        report.screenText = await waitFor('screenText', 'translate_screen_text', { projectId: project.id, intervalMs: clean.screenTextIntervalMs, translate: clean.translator === 'model' }, 50, 66, clean.translator === 'model' ? 'Translating on-screen text' : 'Reading on-screen text');
      }
      if (clean.translator === 'agent') {
        report.translation = await agentTranslation({ call, state, save, projectId: project.id, workDir, onProgress });
      }
    }
    const renderFrom = clean ? 72 : 65;
    const layers = clean ? { subtitles: clean.captions === 'burn' } : undefined;
    const rendered = await waitFor('render', 'render', { projectId: project.id, quality, ...(layers ? { layers } : {}) }, renderFrom, 95, clean ? 'Rendering' : '');
    const relative = rendered?.path;
    if (typeof relative !== 'string' || !relative.startsWith('renders/') || relative.split('/').some((part) => part === '..' || part === '.') || relative.includes('\\')) {
      throw new Error('Video editor returned an invalid render path.');
    }
    await transfer(97, 'Receiving finished video from editor', async (signal) => {
      const response = await fetch(apiUrl(`files/${relative.split('/').map(encodeURIComponent).join('/')}`), { headers, redirect: 'error', signal });
      if (!response.ok || !response.body) throw new Error(`Video editor output download failed (HTTP ${response.status}).`);
      const temporary = `${outputPath}.part`;
      try {
        await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temporary), { signal });
        if (!(await fsp.stat(temporary)).size) throw new Error('Video editor returned an empty video.');
        await fsp.rename(temporary, outputPath);
      } finally {
        await fsp.rm(temporary, { force: true });
      }
    });
    const cues = [];
    let page;
    do {
      page = await call('get_transcript', { projectId: project.id, limit: 500, offset: cues.length });
      cues.push(...(page.cues || []));
    } while (page.cues?.length && cues.length < page.total);
    const artifactFiles = [];
    let captions = null;
    if (clean && clean.captions === 'youtube') {
      captions = await submit('captions', () => call('export_captions', { projectId: project.id, language: 'target' }));
      if (captions?.path) {
        const local = path.join(workDir, `${path.basename(outputPath, '.mp4')}.${captions.language || 'en'}.srt`);
        await downloadEditorFile(apiUrl, headers, captions.path, local);
        captions = { ...captions, localPath: local };
        artifactFiles.push({ kind: 'captions', path: local, meta: { language: captions.language, format: 'srt', cues: captions.cues, sha256: captions.sha256, purpose: 'YouTube timed caption track (Upload file → With timing)' } });
      }
    }
    if (clean) {
      const reference = clean.libraryReference || libraryReference(currentMeta);
      if (reference && !state.librarySaved) {
        try {
          state.librarySaved = await call('save_transcript_library', { projectId: project.id, reference });
          await save();
        } catch (error) {
          state.librarySaved = { error: error.message };
        }
      }
      report.librarySaved = state.librarySaved || null;
      if (state.librarySaved?.dir) artifactFiles.push({ kind: 'transcriptLibrary', path: state.librarySaved.dir, meta: { reference: state.librarySaved.reference, files: state.librarySaved.files, editorUrl: endpoint.origin } });
    }
    onProgress(100, 'Video editor output ready');
    return { outputPath, artifactFiles, metrics: clean ? cleanMetrics(summarizeClean(report, rendered)) : undefined, artifacts: {
      ...(clean ? { editorReport: summarizeClean(report, rendered) } : {}),
      ...(captions?.localPath ? { captionsPath: captions.localPath, captionsLanguage: captions.language, captionsCues: captions.cues } : {}),
      editorProjectId: project.id, editorUrl: endpoint.origin, editorRenderId: rendered.id,
      transcriptSource: cues.map((cue) => cue.sourceText || '').filter((text) => text.trim()).join('\n'),
      transcriptEn: cues.map((cue) => direction === 'zh-to-en' ? cue.translatedText || '' : cue.sourceText || '').filter((text) => text.trim()).join('\n'),
    } };
  });
}

/**
 * The clean workflow: remove a channel watermark (saved overlay profile),
 * subtitle reliable speech, translate changing on-screen text, and render
 * at the source's size, timing and audio. Each part can be turned off.
 */
export function cleanOptions(options = {}) {
  const glossary = (Array.isArray(options.glossary) ? options.glossary : [])
    .filter((entry) => entry && String(entry.source || '').trim() && String(entry.target || '').trim())
    .slice(0, 300).map((entry) => ({ source: String(entry.source).trim().slice(0, 200), target: String(entry.target).trim().slice(0, 300) }));
  const profile = String(options.overlayProfile || '').trim();
  if (profile && !/^[a-z0-9][a-z0-9-]{1,60}$/.test(profile)) throw new Error('overlayProfile must be a saved profile id (lowercase letters, digits, dashes).');
  const interval = Math.round(Number(options.screenTextIntervalMs) || 1000);
  return {
    overlayProfile: profile,
    transcribe: options.transcribe !== false,
    screenText: options.screenText !== false,
    screenTextIntervalMs: Math.max(250, Math.min(10000, interval)),
    glossary,
    context: String(options.context || '').slice(0, 6000),
    subtitleLayout: ['dual', 'target', 'source'].includes(options.subtitleLayout) ? options.subtitleLayout : 'target',
    // agent = one subtitle file goes to the agent and one comes back (job waits
    // in review:translation); model = the editor's own text model translates.
    translator: options.translator === 'model' ? 'model' : 'agent',
    // youtube = spoken subtitles become a timed caption file, not pixels.
    captions: ['youtube', 'burn', 'none'].includes(options.captions) ? options.captions : 'youtube',
    libraryReference: /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(String(options.libraryReference || '')) ? String(options.libraryReference) : '',
    reuseLibrary: options.reuseLibrary !== false,
  };
}

/** The saved-transcript key for a source: its Bilibili BV id when known. */
export function libraryReference(meta = {}) {
  const candidates = [meta.bvid, meta.sourceUrl, meta.canonicalUrl, meta.sourceRef];
  for (const value of candidates) {
    const match = String(value || '').match(/BV[0-9A-Za-z]{10}/);
    if (match) return match[0];
  }
  return '';
}

async function downloadEditorFile(apiUrl, headers, relative, destination) {
  if (typeof relative !== 'string' || !relative.startsWith('renders/') || relative.split('/').some((part) => part === '..' || part === '.')) throw new Error('Video editor returned an invalid file path.');
  const response = await fetch(apiUrl(`files/${relative.split('/').map(encodeURIComponent).join('/')}`), { headers, redirect: 'error' });
  if (!response.ok) throw new Error(`Video editor file download failed (HTTP ${response.status}).`);
  await fsp.writeFile(destination, Buffer.from(await response.arrayBuffer()));
  return destination;
}

export const TRANSLATION_REQUEST_FILE = 'translation-request.srt';
export const TRANSLATION_RESPONSE_FILE = 'translation-response.srt';

/**
 * The single agent round-trip: ask the editor for one SRT of everything still
 * untranslated; if the agent's reply is already in the work folder apply it,
 * otherwise write the request there and pause the job for the agent.
 */
async function agentTranslation({ call, state, save, projectId, workDir, onProgress }) {
  if (state.translation) return state.translation;
  onProgress(68, 'Collecting lines for translation');
  const request = state.translationRequest || await call('request_translation', { projectId });
  if (!request.cues) {
    state.translation = { requestId: null, cues: 0, applied: { speech: 0, screen: 0 } };
    await save();
    return state.translation;
  }
  if (!state.translationRequest) {
    state.translationRequest = { requestId: request.requestId, cues: request.cues, speech: request.speech, screen: request.screen, instructions: request.instructions, kinds: request.kinds };
    await save();
  }
  const responsePath = path.join(workDir, TRANSLATION_RESPONSE_FILE);
  if (fs.existsSync(responsePath)) {
    onProgress(70, 'Applying agent translation');
    const srt = await fsp.readFile(responsePath, 'utf8');
    const applied = await call('apply_translation', { projectId, requestId: state.translationRequest.requestId, srt });
    state.translation = { ...applied, cues: state.translationRequest.cues };
    await save();
    return state.translation;
  }
  const requestPath = path.join(workDir, TRANSLATION_REQUEST_FILE);
  await fsp.writeFile(requestPath, request.srt || (await call('request_translation', { projectId })).srt);
  await fsp.writeFile(path.join(workDir, 'translation-request.json'), JSON.stringify({ ...state.translationRequest, projectId, requestPath, responsePath }, null, 2));
  throw agentInputRequired('translation', {
    requestPath, responsePath, ...state.translationRequest,
    message: `Waiting for the agent to translate ${request.cues} line(s) (${request.speech} speech, ${request.screen} on-screen) as one subtitle file.`,
  });
}

/** What each part of the clean workflow did, for the job record and the process view. */
export function summarizeClean(report = {}, rendered = {}) {
  const overlay = report.overlay || null;
  const speech = report.speech || null;
  const screen = report.screenText || null;
  return {
    overlay: overlay ? {
      motion: overlay.motion, regions: (overlay.regions || []).length, samples: overlay.samples, counts: overlay.counts,
      reviewTimesMs: overlay.reviewTimesMs || [], maskScaled: Boolean(overlay.maskScaled), method: overlay.method,
      maskSource: overlay.maskProvenance?.method || overlay.maskProvenance?.profile || '',
    } : null,
    speech: speech ? {
      cues: Number(speech.cues) || 0, translated: Number(report.speechTranslation?.cues) || 0,
      reliable: speech.speech?.reliable ?? Number(speech.cues) > 0, segments: speech.speech?.segments ?? null,
      dropped: speech.speech?.dropped || null, notes: speech.notes || [],
    } : null,
    screenText: screen ? {
      intervalMs: screen.intervalMs, samples: screen.samples, lines: screen.tracks, translated: screen.translated,
      untranslated: screen.untranslated, uncertain: screen.uncertain, excludedAsWatermark: screen.excluded,
      reviewed: Boolean(screen.reviewed), coverageNote: screen.coverageNote, ...(screen.translationError ? { translationError: screen.translationError } : {}),
    } : null,
    translation: report.translation ? { translator: 'agent', requestId: report.translation.requestId || null, cues: report.translation.cues || 0, applied: report.translation.applied || null, missing: report.translation.missing || [], stale: report.translation.stale || [] } : null,
    library: report.library ? { reference: report.library.reference, reused: Boolean(report.library.speechCues || report.library.screenLines), saved: Boolean(report.librarySaved?.dir) } : null,
    render: { audio: rendered.summary?.audio || '', regions: rendered.summary?.regions ?? null, subtitleEvents: rendered.summary?.subtitleEvents ?? null, screenTextEvents: rendered.summary?.screenTextEvents ?? null },
  };
}

/** One readable line per part, for the step's metrics in the process view. */
export function cleanMetrics(summary) {
  const out = {};
  const { overlay, speech, screenText, render } = summary || {};
  if (overlay) {
    const found = (overlay.counts?.present || 0) + (overlay.counts?.moved || 0);
    out.watermark = `${overlay.motion}; ${overlay.regions} region${overlay.regions === 1 ? '' : 's'}; found in ${found}/${overlay.samples} sampled frames${overlay.reviewTimesMs?.length ? `; review ${overlay.reviewTimesMs.length} moment(s)` : ''}${overlay.maskScaled ? '; mask rescaled' : ''}`;
  }
  if (speech) {
    out.speech = speech.cues ? `${speech.cues} reliable line(s), ${speech.translated} translated` : `no reliable speech${speech.segments ? ` (${speech.segments} Whisper segment(s) rejected)` : ''}; no spoken subtitles`;
  }
  if (screenText) {
    out.onScreenText = `${screenText.lines} line(s) read every ${screenText.intervalMs / 1000}s; ${screenText.translated} translated, ${screenText.untranslated} untranslated, ${screenText.uncertain} uncertain${screenText.reviewed ? '' : '; not reviewed'}`;
  }
  if (summary?.translation) out.translation = summary.translation.cues ? `agent translated ${(summary.translation.applied?.speech || 0) + (summary.translation.applied?.screen || 0)} line(s) from one subtitle file${summary.translation.missing?.length ? `; ${summary.translation.missing.length} left untranslated` : ''}` : 'nothing to translate';
  if (summary?.library?.reused) out.transcript = `reused saved transcript ${summary.library.reference}`;
  if (render?.audio) out.audio = render.audio;
  return out;
}
