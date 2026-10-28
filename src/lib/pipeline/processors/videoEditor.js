import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { withEditor } from '../../videoEditor/client.js';

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
  if (!['localize', 'render'].includes(mode)) throw new Error('Video editor mode must be localize or render.');
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
    async function waitFor(key, tool, args, from, to) {
      let job = await submit(key, async () => {
        const response = await call(tool, args);
        if (!response.job?.id) throw new Error(`Video editor ${tool} did not return a job ID.`);
        return { id: response.job.id };
      });
      while (true) {
        // Always refresh persisted IDs: the editor may have completed after a worker restart.
        job = await call('get_job', { jobId: job.id });
        try {
          onProgress(from + (to - from) * Math.max(0, Math.min(1, Number(job.progress) || 0)), `Video editor: ${job.message || job.status}`);
        } catch (error) {
          if (error.message === 'Job canceled') await call('cancel_job', { jobId: job.id }).catch(() => {});
          throw error;
        }
        if (job.status === 'done') return job.result;
        if (['failed', 'canceled', 'interrupted'].includes(job.status)) throw new Error(`Video editor job ${job.id}: ${job.error?.message || job.error || job.status}`);
        if (Date.now() >= deadline) throw new Error(`Video editor job ${job.id} timed out; retry resumes the saved job.`);
        await delay(2000);
      }
    }
    onProgress(1, 'Connecting to video editor MCP');
    if (mode === 'localize' && !state.localization) {
      const status = await call('get_status');
      if (!status.providers?.llm && !status.providers?.gemini) throw new Error('Configure a translation/vision provider in video-automation before automatic localization, or choose render mode.');
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
    const rendered = await waitFor('render', 'render', { projectId: project.id, quality }, 65, 95);
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
    onProgress(100, 'Video editor output ready');
    return { outputPath, artifacts: {
      editorProjectId: project.id, editorUrl: endpoint.origin, editorRenderId: rendered.id,
      transcriptSource: cues.map((cue) => cue.sourceText || '').filter((text) => text.trim()).join('\n'),
      transcriptEn: cues.map((cue) => direction === 'zh-to-en' ? cue.translatedText || '' : cue.sourceText || '').filter((text) => text.trim()).join('\n'),
    } };
  });
}
