import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { editorConfig } from '../src/lib/videoEditor/client.js';
import { process as editVideo, testConnection } from '../src/lib/pipeline/processors/videoEditor.js';

async function fixture(t, overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'video-editor-mcp-'));
  const input = path.join(directory, 'source.mp4');
  fs.writeFileSync(input, 'source-video');
  const calls = [];
  const requests = [];
  const state = { failDownload: false, renderedPath: 'renders/final.mp4', jobStatus: 'done', providers: { llm: true }, ...overrides };
  const tools = ['get_status', 'create_project', 'get_project', 'autopilot', 'render', 'get_job', 'cancel_job', 'get_transcript'];
  const server = http.createServer(async (request, response) => {
    requests.push({ url: request.url, authorization: request.headers.authorization });
    if (request.headers.authorization !== 'Bearer test-secret') { response.writeHead(401).end(); return; }
    if (request.url.startsWith('/mcp') && request.method === 'POST') {
      let body = ''; for await (const chunk of request) body += chunk;
      const mcp = new Server({ name: 'video-automation-fixture', version: '1.0.0' }, { capabilities: { tools: {} } });
      mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: tools.filter((name) => name !== state.missingTool).map((name) => ({ name, inputSchema: { type: 'object' } })) }));
      mcp.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
        calls.push(params);
        let data;
        switch (params.name) {
          case 'get_status': data = { ffmpeg: { ready: true }, providers: state.providers, capabilities: state.capabilities || {} }; break;
          case 'update_settings': data = { id: 'prj_abcdefghij' }; break;
          case 'list_overlay_profiles': data = { profiles: state.profiles || [] }; break;
          case 'reconstruct_overlay': data = { job: { id: 'job_overlay' } }; break;
          case 'transcribe': data = { job: { id: 'job_speech' } }; break;
          case 'translate': data = { job: { id: 'job_translate' } }; break;
          case 'translate_screen_text': data = { job: { id: 'job_screen' } }; break;
          case 'create_project': data = { id: 'prj_abcdefghij' }; break;
          case 'autopilot': data = { job: { id: 'job_localize' } }; break;
          case 'render': data = { job: { id: 'job_render' } }; break;
          case 'cancel_job': data = { ok: true }; break;
          case 'get_job': data = { id: params.arguments.jobId, status: state.jobStatusFor ? state.jobStatusFor(params.arguments.jobId) : state.jobStatus, progress: .5, error: state.jobError,
            result: params.arguments.jobId === 'job_render' ? { id: 'exp_final', path: state.renderedPath, summary: { audio: 'copied', regions: 1, subtitleEvents: 0, screenTextEvents: 3 } }
              : state.results?.[params.arguments.jobId] || { provider: 'llm' } }; break;
          case 'get_transcript': data = params.arguments.offset ? { total: 2, cues: [{ sourceText: '第二', translatedText: 'Second' }] }
            : { total: 2, cues: [{ sourceText: '第一', translatedText: 'First' }] }; break;
          default: data = {};
        }
        if (state.toolError === params.name) return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { message: 'Bad test-secret' } }) }] };
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      response.on('close', () => { transport.close(); mcp.close(); });
      await mcp.connect(transport);
      await transport.handleRequest(request, response, JSON.parse(body));
    } else if (request.url.startsWith('/api/v1/projects/prj_abcdefghij/media') && request.method === 'PUT') {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      state.upload = Buffer.concat(chunks);
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ file: { id: 'file_import' } }));
    } else if (request.url === '/api/v1/projects/prj_abcdefghij/files/renders/final.mp4') {
      response.writeHead(state.failDownload ? 503 : 200, { 'Content-Type': 'video/mp4' });
      response.end(state.media || 'finished-video');
    } else response.writeHead(405).end();
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const credentials = { endpoint: `http://127.0.0.1:${server.address().port}/mcp`, apiKey: 'test-secret' };
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); });
  return { input, directory, credentials, state, calls, requests };
}

test('editor URLs reject embedded credentials, non-HTTP schemes and query strings', () => {
  for (const endpoint of ['file:///tmp/editor', 'http://user:secret@localhost/mcp', 'http://localhost/mcp?token=secret']) {
    assert.throws(() => editorConfig({ endpoint }), /HTTP\(S\)/);
  }
});

test('connection test checks the real MCP tools and server-side FFmpeg', async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await testConnection(f.credentials), { ok: true });
  f.state.missingTool = 'render';
  assert.match((await testConnection(f.credentials)).error, /missing: render/);
});

test('localization streams source, polls MCP jobs, downloads video and pages transcript for metadata', async (t) => {
  const f = await fixture(t);
  const progress = [];
  const result = await editVideo(f.input, {}, (percent) => progress.push(percent), f.credentials);
  assert.equal(fs.readFileSync(result.outputPath, 'utf8'), 'finished-video');
  assert.equal(f.state.upload.toString(), 'source-video');
  assert.equal(result.artifacts.editorProjectId, 'prj_abcdefghij');
  assert.equal(result.artifacts.transcriptSource, '第一\n第二');
  assert.equal(result.artifacts.transcriptEn, 'First\nSecond');
  assert.equal(progress.at(-1), 100);
  assert.deepEqual(f.calls.filter((call) => ['create_project', 'autopilot', 'render'].includes(call.name)).map((call) => call.name), ['create_project', 'autopilot', 'render']);
  assert.ok(f.requests.every((request) => request.authorization === 'Bearer test-secret'));
  assert.ok(!fs.readFileSync(`${f.input}.video-editor.json`, 'utf8').includes('test-secret'));
});

test('render mode works without localization providers', async (t) => {
  const f = await fixture(t, { providers: {} });
  await editVideo(f.input, { mode: 'render', direction: 'en-to-zh' }, undefined, f.credentials);
  assert.equal(f.calls.some((call) => call.name === 'autopilot'), false);
  assert.equal(f.calls.find((call) => call.name === 'create_project').arguments.mode, 'en-to-zh');
});

test('automatic localization fails before importing when no translation provider exists', async (t) => {
  const f = await fixture(t, { providers: {} });
  await assert.rejects(editVideo(f.input, {}, undefined, f.credentials), /Configure a translation\/vision provider/);
  assert.equal(f.calls.some((call) => call.name === 'create_project'), false);
});

test('retry after download failure reuses the project, import and editor jobs', async (t) => {
  const f = await fixture(t, { failDownload: true });
  await assert.rejects(editVideo(f.input, {}, undefined, f.credentials), /download failed/);
  f.state.failDownload = false;
  await editVideo(f.input, {}, undefined, f.credentials);
  for (const name of ['create_project', 'autopilot', 'render']) assert.equal(f.calls.filter((call) => call.name === name).length, 1, name);
  assert.equal(f.requests.filter((request) => request.url.includes('/media?')).length, 1);
});

test('failed editor jobs stop the upload flow and expose the editor error', async (t) => {
  const f = await fixture(t, { jobStatus: 'failed', jobError: { message: 'Translation unavailable' } });
  await assert.rejects(editVideo(f.input, {}, undefined, f.credentials), /Translation unavailable/);
  assert.equal(f.calls.some((call) => call.name === 'render'), false);
  assert.equal(fs.existsSync(path.join(f.directory, 'source.edited.mp4')), false);
});

test('unknown submission outcomes block blind duplicate creation and redact credentials', async (t) => {
  const f = await fixture(t, { toolError: 'create_project' });
  await assert.rejects(editVideo(f.input, {}, undefined, f.credentials), /Bad \[redacted\]/);
  f.state.toolError = '';
  await assert.rejects(editVideo(f.input, {}, undefined, f.credentials), /unknown outcome/);
  assert.equal(f.calls.filter((call) => call.name === 'create_project').length, 1);
});

test('changed input or options requires a new job instead of reusing a stale render', async (t) => {
  const f = await fixture(t);
  await editVideo(f.input, {}, undefined, f.credentials);
  await assert.rejects(editVideo(f.input, { quality: 'draft' }, undefined, f.credentials), /settings or input changed/);
});

test('separate jobs for the same library source keep independent checkpoints and output', async (t) => {
  const f = await fixture(t);
  const firstDir = path.join(f.directory, 'job-1');
  const secondDir = path.join(f.directory, 'job-2');
  const first = await editVideo(f.input, {}, undefined, f.credentials, {}, { workDir: firstDir });
  const second = await editVideo(f.input, { mode: 'render' }, undefined, f.credentials, {}, { workDir: secondDir });
  assert.notEqual(first.outputPath, second.outputPath);
  assert.ok(fs.existsSync(path.join(firstDir, 'video-editor.json')));
  assert.ok(fs.existsSync(path.join(secondDir, 'video-editor.json')));
  assert.equal(fs.readFileSync(f.input, 'utf8'), 'source-video');
});

test('removed local processors are rejected with migration instructions', async () => {
  const { validateProcessorChain } = await import('../src/lib/pipeline/registry.js');
  for (const id of ['sceneCut', 'voiceover', 'faceFusion', 'videoContext', 'ocrContext', 'aiEditor']) {
    const validation = validateProcessorChain([id]);
    assert.equal(validation.ok, false);
    assert.match(validation.errors.join(' '), /moved to videoEditor/);
  }
  assert.equal(validateProcessorChain(['videoEditor', 'metadata']).ok, true);
});

test('remote output paths cannot escape the editor render directory', async (t) => {
  const f = await fixture(t, { renderedPath: 'renders/../../secrets.json' });
  await assert.rejects(editVideo(f.input, {}, undefined, f.credentials), /invalid render path/);
  assert.equal(f.requests.some((request) => request.url.includes('/files/')), false);
});

test('canceling a running uploader step cancels its remote editor job', async (t) => {
  const f = await fixture(t, { jobStatus: 'running' });
  await assert.rejects(editVideo(f.input, {}, (_percent, note) => { if (note.startsWith('Video editor:')) throw new Error('Job canceled'); }, f.credentials), /Job canceled/);
  assert.ok(f.calls.some((call) => call.name === 'cancel_job' && call.arguments.jobId === 'job_localize'));
});

test('the uploader worker validates and records the returned video as its publishing asset', async (t) => {
  const f = await fixture(t);
  execFileSync(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=10', '-t', '0.3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', f.input]);
  f.state.media = fs.readFileSync(f.input);
  const { saveConnection } = await import('../src/lib/pipeline/connections.js');
  const { createJob, runNextQueuedJob, listJobs } = await import('../src/lib/pipeline/pipeline.js');
  const previousWork = process.env.VIDEO_WORK_DIR;
  process.env.VIDEO_WORK_DIR = f.directory;
  t.after(() => { if (previousWork === undefined) delete process.env.VIDEO_WORK_DIR; else process.env.VIDEO_WORK_DIR = previousWork; });
  saveConnection('videoEditor', { endpoint: f.credentials.endpoint });
  const previousToken = process.env.VIDEO_EDITOR_MCP_TOKEN;
  process.env.VIDEO_EDITOR_MCP_TOKEN = f.credentials.apiKey;
  t.after(() => { if (previousToken === undefined) delete process.env.VIDEO_EDITOR_MCP_TOKEN; else process.env.VIDEO_EDITOR_MCP_TOKEN = previousToken; });
  const job = createJob({ sourceId: 'localFile', sourceInput: f.input, processorIds: ['videoEditor'], uploaderId: '', options: { videoEditor: { mode: 'render' } } });
  await runNextQueuedJob();
  const finished = listJobs().find((item) => item.id === job.id);
  assert.equal(finished.status, 'done', finished.error);
  assert.ok(finished.assets.some((asset) => asset.kind === 'videoEditor' && asset.meta.validation.output.width === 64));
  assert.ok(fs.existsSync(path.join(f.directory, String(job.id), 'video-editor.json')));
});

const cleanState = () => ({
  providers: { codex: true },
  capabilities: { overlayReconstruction: true, speech: true, screenTextOverlays: true },
  profiles: [{ id: 'prisma-watermark' }],
  results: {
    job_overlay: { motion: 'stationary', regions: [{ id: 'reg_1' }], samples: 55, counts: { present: 55 }, reviewTimesMs: [], maskScaled: false, method: 'removelogo', maskProvenance: { method: 'SAM3_Detect' } },
    job_speech: { cues: 0, speech: { segments: 7, kept: 0, reliable: false, dropped: { noSpeech: 5, hallucination: 2 } }, notes: ['no speech'] },
    job_screen: { intervalMs: 1000, samples: 540, tracks: 4, translated: 3, untranslated: 1, uncertain: 2, excluded: 540, reviewed: false, coverageNote: 'one frame per second' },
  },
});

test('clean mode removes the watermark, skips translation when no speech is reliable, translates on-screen text and reports each part', async (t) => {
  const f = await fixture(t, cleanState());
  const progress = [];
  const result = await editVideo(f.input, { mode: 'clean', overlayProfile: 'prisma-watermark', glossary: [{ source: '蝶', target: 'Vlinder' }], context: 'Delta Force' },
    (percent, note) => progress.push([percent, note]), f.credentials, { title: 'Vlinder' }, { workDir: f.directory });
  const tools = f.calls.map((call) => call.name).filter((name) => !['get_job', 'get_transcript'].includes(name));
  assert.deepEqual(tools, ['get_status', 'list_overlay_profiles', 'create_project', 'update_settings', 'reconstruct_overlay', 'transcribe', 'translate_screen_text', 'render']);
  const settings = f.calls.find((call) => call.name === 'update_settings').arguments;
  assert.deepEqual(settings.glossary, [{ source: '蝶', target: 'Vlinder' }]);
  assert.equal(settings.subtitles.layout, 'target');
  assert.equal(f.calls.find((call) => call.name === 'transcribe').arguments.allowNoSpeech, true);
  assert.equal(f.calls.find((call) => call.name === 'reconstruct_overlay').arguments.profile, 'prisma-watermark');
  assert.ok(progress.some(([, note]) => /^Removing watermark:/.test(note)) && progress.some(([, note]) => /^Translating on-screen text:/.test(note)));
  assert.match(result.metrics.watermark, /stationary; 1 region; found in 55\/55/);
  assert.match(result.metrics.speech, /no reliable speech \(7 Whisper segment/);
  assert.match(result.metrics.onScreenText, /4 line\(s\).*3 translated, 1 untranslated, 2 uncertain; not reviewed/);
  assert.equal(result.artifacts.editorReport.overlay.maskSource, 'SAM3_Detect');
  assert.equal(fs.readFileSync(result.outputPath, 'utf8'), 'finished-video');
});

test('clean mode translates speech only when Whisper kept reliable lines', async (t) => {
  const state = cleanState();
  state.results.job_speech = { cues: 3, speech: { segments: 4, kept: 3, reliable: true } };
  state.results.job_translate = { cues: 3 };
  const f = await fixture(t, state);
  const result = await editVideo(f.input, { mode: 'clean', overlayProfile: 'prisma-watermark' }, () => {}, f.credentials, {}, { workDir: f.directory });
  assert.deepEqual(f.calls.find((call) => call.name === 'translate').arguments, { projectId: 'prj_abcdefghij', scope: 'transcript' });
  assert.match(result.metrics.speech, /3 reliable line\(s\), 3 translated/);
});

test('clean mode stops before sending media when the editor lacks a capability or the overlay profile', async (t) => {
  const state = cleanState();
  state.capabilities.screenTextOverlays = false;
  const f = await fixture(t, state);
  await assert.rejects(editVideo(f.input, { mode: 'clean', overlayProfile: 'prisma-watermark' }, () => {}, f.credentials, {}, { workDir: f.directory }), /missing on-screen text reading/);
  const g = await fixture(t, cleanState());
  await assert.rejects(editVideo(g.input, { mode: 'clean', overlayProfile: 'another-channel' }, () => {}, g.credentials, {}, { workDir: g.directory }), /no overlay profile "another-channel"/);
  assert.equal(f.state.upload, undefined);
  assert.equal(g.state.upload, undefined);
});

test('a failed editor stage is resubmitted on retry while finished stages are reused', async (t) => {
  const state = cleanState();
  const f = await fixture(t, state);
  let failSpeech = true;
  const original = f.state.results.job_speech;
  Object.defineProperty(f.state.results, 'job_speech', { get: () => (failSpeech ? undefined : original), configurable: true });
  f.state.jobStatusFor = (id) => (id === 'job_speech' && failSpeech ? 'failed' : 'done');
  await assert.rejects(editVideo(f.input, { mode: 'clean', overlayProfile: 'prisma-watermark' }, () => {}, f.credentials, {}, { workDir: f.directory }), /job_speech: failed/);
  failSpeech = false;
  await editVideo(f.input, { mode: 'clean', overlayProfile: 'prisma-watermark' }, () => {}, f.credentials, {}, { workDir: f.directory });
  const count = (name) => f.calls.filter((call) => call.name === name).length;
  assert.equal(count('reconstruct_overlay'), 1);
  assert.equal(count('transcribe'), 2);
  assert.equal(count('create_project'), 1);
});
