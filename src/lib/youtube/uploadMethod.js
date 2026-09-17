/**
 * YouTube upload METHODS — how a video reaches YouTube, chosen per job.
 *
 *   api     YouTube Data API v3 with a per-channel OAuth authorization.
 *           Budgeted by the release governor (1,601 units per upload).
 *   studio  Image-driven YouTube Studio automation: pyautogui finds each
 *           control by matching calibrated screenshots and clicks it in a
 *           browser already signed into the channel. No API, no OAuth, no
 *           quota. Publishes to whichever channel that browser is signed in to.
 *   pygui   The older guided uploader: fills title/description by fixed
 *           points and waits for a person to finish in Studio.
 *
 * The method is pinned onto options.youtube.uploadMethod when a job is
 * queued, so changing YOUTUBE_UPLOAD_METHOD later never re-routes a job that
 * is already in the queue.
 */
import fs from 'fs';
import path from 'path';

export const UPLOAD_METHODS = {
  api: { label: 'YouTube API', needsAuthorization: true, budgeted: true },
  studio: { label: 'YouTube Studio screen automation', needsAuthorization: false, budgeted: false },
  pygui: { label: 'Guided Studio (manual finish)', needsAuthorization: false, budgeted: false },
};

export function defaultUploadMethod() {
  const value = String(globalThis.process?.env?.YOUTUBE_UPLOAD_METHOD || 'api').trim().toLowerCase();
  return UPLOAD_METHODS[value] ? value : 'api';
}

export function normalizeUploadMethod(value) {
  const method = String(value || '').trim().toLowerCase();
  if (!method) return defaultUploadMethod();
  if (!UPLOAD_METHODS[method]) {
    throw new Error(`Unknown YouTube upload method "${value}". Use one of: ${Object.keys(UPLOAD_METHODS).join(', ')}`);
  }
  return method;
}

/** The method for an upload's meta/options object, falling back to the env default. */
export function resolveUploadMethod(meta = {}) {
  return normalizeUploadMethod(meta?.uploadMethod || meta?.youtube?.uploadMethod || '');
}

export function methodNeedsAuthorization(method) {
  return Boolean(UPLOAD_METHODS[method]?.needsAuthorization);
}

export function methodIsBudgeted(method) {
  return Boolean(UPLOAD_METHODS[method]?.budgeted);
}

// ----------------------------------------------------------------- Studio templates

export function studioTemplateDir() {
  const configured = globalThis.process?.env?.YOUTUBE_STUDIO_TEMPLATE_DIR || 'config/studio_templates/default';
  return path.resolve(process.cwd(), configured);
}

export function studioScriptPath() {
  return path.join(process.cwd(), 'scripts', 'python', 'youtube_studio_vision_uploader.py');
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/**
 * Which Studio templates are captured on this machine — the JS mirror of
 * studio_vision.calibration_status(), read straight from disk so readiness
 * checks never spawn Python.
 */
export function studioCalibrationStatus() {
  const manifestPath = path.join(process.cwd(), 'scripts', 'python', 'studio_templates.manifest.json');
  const manifest = readJson(manifestPath, null);
  const directory = studioTemplateDir();
  if (!manifest?.templates) {
    return { ok: false, templateDir: directory, ready: [], missingRequired: [], missingOptional: [], error: 'Studio template manifest is missing' };
  }
  const calibration = readJson(path.join(directory, 'calibration.json'), { templates: {} });
  const ready = [];
  const missingRequired = [];
  const missingOptional = [];
  for (const [name, spec] of Object.entries(manifest.templates)) {
    const record = calibration.templates?.[name];
    const present = Boolean(record) && fs.existsSync(path.join(directory, record.file || `${name}.png`));
    if (present) ready.push(name);
    else if (spec.required) missingRequired.push(name);
    else missingOptional.push(name);
  }
  return {
    ok: missingRequired.length === 0,
    templateDir: directory,
    ready,
    missingRequired,
    missingOptional,
    channelCheck: ready.includes('channel_badge'),
    calibrateCommand: 'python3 scripts/python/youtube_studio_vision_uploader.py --calibrate',
  };
}
