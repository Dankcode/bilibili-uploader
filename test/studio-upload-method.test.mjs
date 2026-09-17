import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-method-'));
process.env.VIDEO_SQLITE_PATH = path.join(directory, 'studio.db');
process.env.YOUTUBE_STUDIO_TEMPLATE_DIR = path.join(directory, 'templates');
delete process.env.YOUTUBE_UPLOAD_METHOD;
delete process.env.YOUTUBE_CHANNEL_ID;

// A stand-in for python3: ignores the script and prints what the Studio
// helper would, chosen by STUB_MODE.
const stub = path.join(directory, 'python-stub.sh');
fs.writeFileSync(stub, `#!/bin/sh
case "$STUB_MODE" in
  ok)
    echo 'STUDIO_EVENT {"type": "progress", "stage": "details", "percent": 25, "note": "Filling title and description"}'
    echo 'STUDIO_EVENT {"type": "needs_human", "stage": "open_studio", "gate": "signed_out_marker"}'
    echo 'STUDIO_RESULT {"ok": true, "videoId": "AbCdEfGhIjK", "url": "https://www.youtube.com/watch?v=AbCdEfGhIjK"}'
    echo 'https://www.youtube.com/watch?v=AbCdEfGhIjK'
    exit 0 ;;
  notsent)
    echo 'STUDIO_RESULT {"ok": false, "stage": "open_studio", "sent": false, "error": "Nobody completed signed out marker within 600 s"}'
    exit 1 ;;
  sent)
    echo 'STUDIO_RESULT {"ok": false, "stage": "wait_upload", "sent": true, "error": "Upload did not complete within 60 min"}'
    exit 1 ;;
  limit)
    echo 'STUDIO_RESULT {"ok": false, "stage": "open_upload_dialog", "sent": false, "deferrable": true, "error": "daily upload limit"}'
    exit 4 ;;
  crash)
    echo 'STUDIO_EVENT {"type": "progress", "stage": "choose_file", "percent": 15}'
    echo 'Traceback: boom' >&2
    exit 1 ;;
esac
exit 3
`);
fs.chmodSync(stub, 0o755);
process.env.PYTHON_BIN = stub;

const { default: db } = await import('../src/lib/db/sqlite.js');
const pipeline = await import('../src/lib/pipeline/pipeline.js');
const youtube = await import('../src/lib/pipeline/uploaders/youtube.js');
const uploader = await import('../src/lib/video/uploader.js');
const methods = await import('../src/lib/youtube/uploadMethod.js');
const governor = await import('../src/lib/release/governor.js');

const video = path.join(directory, 'input.mp4');
fs.writeFileSync(video, 'not a real video');

test.after(() => fs.rmSync(directory, { recursive: true, force: true }));

function calibrateAllRequired() {
  const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'scripts/python/studio_templates.manifest.json'), 'utf8'));
  const templateDir = process.env.YOUTUBE_STUDIO_TEMPLATE_DIR;
  fs.mkdirSync(templateDir, { recursive: true });
  const templates = {};
  for (const [name, spec] of Object.entries(manifest.templates)) {
    if (!spec.required) continue;
    fs.writeFileSync(path.join(templateDir, `${name}.png`), 'png');
    templates[name] = { file: `${name}.png` };
  }
  fs.writeFileSync(path.join(templateDir, 'calibration.json'), JSON.stringify({ version: 1, templates }));
}

// ------------------------------------------------------------------ queue time

test('a Studio job needs no OAuth channel and pins its method onto the job', () => {
  const job = pipeline.validateJobInput({
    sourceId: 'localFile', sourceInput: video, processorIds: [], uploaderId: 'youtube', options: { youtube: { uploadMethod: 'studio' } },
  });
  assert.equal(job.youtubeAuthorizationId, '');
  assert.equal(job.options.youtube.uploadMethod, 'studio');

  // The env default is pinned too, so changing the env later cannot re-route queued work.
  process.env.YOUTUBE_UPLOAD_METHOD = 'studio';
  try {
    const pinned = pipeline.validateJobInput({ sourceId: 'localFile', sourceInput: video, processorIds: [], uploaderId: 'youtube' });
    assert.equal(pinned.options.youtube.uploadMethod, 'studio');
  } finally {
    delete process.env.YOUTUBE_UPLOAD_METHOD;
  }
});

test('the API method still requires a channel, and Studio refuses an OAuth binding or an unknown method', () => {
  assert.throws(
    () => pipeline.validateJobInput({ sourceId: 'localFile', sourceInput: video, processorIds: [], uploaderId: 'youtube' }),
    /Choose an authorized YouTube channel/,
  );
  assert.throws(
    () => pipeline.validateJobInput({
      sourceId: 'localFile', sourceInput: video, processorIds: [], uploaderId: 'youtube',
      youtubeAuthorizationId: 'auth-1', options: { youtube: { uploadMethod: 'studio' } },
    }),
    /cannot be bound to an OAuth channel/,
  );
  assert.throws(
    () => pipeline.validateJobInput({ sourceId: 'localFile', sourceInput: video, processorIds: [], uploaderId: 'youtube', options: { youtube: { uploadMethod: 'selenium' } } }),
    /Unknown YouTube upload method/,
  );
});

test('Studio readiness names the templates still to capture, then reports ready once calibrated', async () => {
  const before = await youtube.testConnection({}, { uploadMethod: 'studio' });
  assert.equal(before.ok, false);
  assert.match(before.error, /create_button/);
  assert.match(before.error, /--calibrate/);
  calibrateAllRequired();
  const after = await youtube.testConnection({}, { uploadMethod: 'studio' });
  assert.equal(after.ok, true, after.error);
  assert.match(after.detail, /no channel check/);
  assert.equal(methods.studioCalibrationStatus().ok, true);
});

// ------------------------------------------------------------ helper protocol

test('a successful Studio run returns the URL and relays progress and sign-in prompts', async () => {
  process.env.STUB_MODE = 'ok';
  const notes = [];
  const result = await youtube.upload(video, { title: 'T', uploadMethod: 'studio', tags: ['a b', 'c'] }, (percent, note) => notes.push(note));
  assert.equal(result.remoteId, 'AbCdEfGhIjK');
  assert.equal(result.uploadMethod, 'studio');
  assert.ok(notes.includes('Filling title and description'));
  assert.ok(notes.some((note) => /Needs you/.test(note)));
});

test('Studio failures map onto the release layer: clean, maybe-sent, deferrable, crash', async () => {
  process.env.STUB_MODE = 'notsent';
  await assert.rejects(uploader.uploadWithStudio({ videoPath: video, title: 'T' }), (error) => error.notSent === true && /open_studio/.test(error.message));

  process.env.STUB_MODE = 'sent';
  await assert.rejects(uploader.uploadWithStudio({ videoPath: video, title: 'T' }), (error) => !error.notSent && /wait_upload/.test(error.message));

  process.env.STUB_MODE = 'limit';
  await assert.rejects(uploader.uploadWithStudio({ videoPath: video, title: 'T' }), (error) => error.notSent === true && Boolean(error.deferUntil));

  process.env.STUB_MODE = 'crash';
  await assert.rejects(uploader.uploadWithStudio({ videoPath: video, title: 'T' }), (error) => !error.notSent && /stopped without reporting/.test(error.message));
});

test('Studio uploads are unbudgeted and cannot be reconciled automatically', async () => {
  assert.equal(youtube.isBudgeted({ uploadMethod: 'studio' }), false);
  assert.equal(youtube.isBudgeted({ uploadMethod: 'api' }), true);
  assert.equal(await youtube.reconcile({ title: 'T' }, { uploadMethod: 'studio' }), null);
});

// ---------------------------------------------------------------- end to end

test('a queued Studio job publishes through the pipeline without spending API quota', async () => {
  process.env.STUB_MODE = 'ok';
  db.prepare("UPDATE video_jobs SET status = 'done' WHERE status IN ('queued', 'running')").run();
  const created = pipeline.createJob({
    sourceId: 'localFile', sourceInput: video, processorIds: [], uploaderId: 'youtube', title: 'Studio end to end',
    options: { youtube: { uploadMethod: 'studio', privacyStatus: 'private' } },
  });
  const source = db.prepare("SELECT id FROM video_job_steps WHERE job_id = ? AND step LIKE 'source:%'").get(created.id);
  db.prepare("UPDATE video_job_steps SET status = 'ok' WHERE id = ?").run(source.id);
  db.prepare("INSERT INTO video_assets (job_id, kind, file_path, meta_json, created_at) VALUES (?, 'original', ?, '{}', ?)").run(created.id, video, new Date().toISOString());

  await pipeline.runNextQueuedJob();

  const job = db.prepare('SELECT status, error FROM video_jobs WHERE id = ?').get(created.id);
  assert.equal(job.status, 'done', job.error);
  const publication = db.prepare('SELECT remote_id, url FROM video_publications WHERE job_id = ?').get(created.id);
  assert.equal(publication.remote_id, 'AbCdEfGhIjK');
  const receipt = db.prepare('SELECT state, units FROM upload_receipts WHERE job_id = ?').get(created.id);
  assert.deepEqual({ ...receipt }, { state: 'confirmed', units: 0 });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM destination_budgets').get().n, 0);
  assert.ok(governor.getBudget('youtube', 'default').remainingUnits > 0);
});
