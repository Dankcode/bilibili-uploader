import fs from 'fs';
import path from 'path';
import db from '../db/sqlite';

const WORK_ROOT = path.resolve(process.cwd(), process.env.VIDEO_WORK_DIR || 'video-work');
const STUDIO_ROOT = path.join(WORK_ROOT, 'studio');

function parseJson(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function validateId(id) {
  const value = String(id || '');
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(value)) throw new Error('Invalid Studio project ID.');
  return value;
}

function fromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    videoPath: row.video_path,
    transcriptMd: row.transcript_md || '',
    subtitleText: row.subtitle_text || '',
    format: row.format || 'ass',
    chatHistory: parseJson(row.chat_history_json, []),
    frameManifest: parseJson(row.frame_manifest_json, []),
    contextMd: row.context_md || '',
    contextManifest: parseJson(row.context_manifest_json, []),
    contextSettings: parseJson(row.context_settings_json, {}),
    stageStatus: parseJson(row.stage_status_json, {}),
    analysis: parseJson(row.analysis_json, {}),
    sourceLang: row.source_lang || 'zh',
    targetLang: row.target_lang || 'en',
    quality: row.quality || 'fast',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function studioRoot() {
  fs.mkdirSync(STUDIO_ROOT, { recursive: true });
  return STUDIO_ROOT;
}

export function projectDirectory(id) {
  return path.join(studioRoot(), validateId(id));
}

export function ensureProjectDirectory(id) {
  const directory = projectDirectory(id);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

export function assertProjectFile(id, candidate) {
  const root = projectDirectory(id);
  const resolved = path.resolve(candidate || '');
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Requested file is outside the Studio project directory.');
  }
  return resolved;
}

export function createStudioProject({
  id, name, videoPath, sourceLang = 'zh', targetLang = 'en', quality = 'fast', stageStatus = {},
}) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO studio_projects (
      id, name, video_path, source_lang, target_lang, quality,
      stage_status_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(validateId(id), name, videoPath, sourceLang, targetLang, quality, JSON.stringify(stageStatus), now, now);
  return getStudioProject(id);
}

export function getStudioProject(id) {
  return fromRow(db.prepare('SELECT * FROM studio_projects WHERE id = ?').get(validateId(id)));
}

export function listStudioProjects(limit = 50) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  return db.prepare('SELECT * FROM studio_projects ORDER BY updated_at DESC LIMIT ?').all(safeLimit).map(fromRow);
}

export function updateStudioProject(id, patch = {}) {
  const current = getStudioProject(id);
  if (!current) throw new Error(`Studio project not found: ${id}`);
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  db.prepare(`
    UPDATE studio_projects SET
      name = ?, video_path = ?, transcript_md = ?, subtitle_text = ?, format = ?,
      chat_history_json = ?, frame_manifest_json = ?, context_md = ?,
      context_manifest_json = ?, context_settings_json = ?, stage_status_json = ?,
      analysis_json = ?, source_lang = ?, target_lang = ?, quality = ?, updated_at = ?
    WHERE id = ?
  `).run(
    next.name, next.videoPath, next.transcriptMd || '', next.subtitleText || '', next.format || 'ass',
    JSON.stringify(next.chatHistory || []), JSON.stringify(next.frameManifest || []), next.contextMd || '',
    JSON.stringify(next.contextManifest || []), JSON.stringify(next.contextSettings || {}),
    JSON.stringify(next.stageStatus || {}),
    JSON.stringify(next.analysis || {}),
    next.sourceLang || 'zh', next.targetLang || 'en', next.quality || 'fast', next.updatedAt, current.id,
  );
  return getStudioProject(id);
}

export function updateStudioStage(id, stage, status, detail = '') {
  const project = getStudioProject(id);
  if (!project) throw new Error(`Studio project not found: ${id}`);
  return updateStudioProject(id, {
    stageStatus: {
      ...project.stageStatus,
      [stage]: { status, detail, updatedAt: new Date().toISOString() },
    },
  });
}

export function deleteStudioProject(id) {
  const project = getStudioProject(id);
  if (!project) return false;
  db.prepare('DELETE FROM studio_projects WHERE id = ?').run(project.id);
  fs.rmSync(projectDirectory(project.id), { recursive: true, force: true });
  return true;
}

export function publicStudioProject(project) {
  if (!project) return null;
  const { videoPath, ...safe } = project;
  return {
    ...safe,
    videoName: path.basename(videoPath),
    hasVideo: fs.existsSync(videoPath),
    mediaUrl: `/api/studio/media/${project.id}`,
  };
}

export function studioProjectSummary(project) {
  const safe = publicStudioProject(project);
  return {
    id: safe.id,
    name: safe.name,
    videoName: safe.videoName,
    sourceLang: safe.sourceLang,
    targetLang: safe.targetLang,
    quality: safe.quality,
    stageStatus: safe.stageStatus,
    hasTranscript: Boolean(safe.transcriptMd),
    hasSubtitles: Boolean(safe.subtitleText),
    hasAnalysis: Boolean(safe.analysis?.generatedAt),
    hasContext: Boolean(safe.contextMd),
    frameCount: safe.frameManifest.length,
    contextCount: safe.contextManifest.length,
    createdAt: safe.createdAt,
    updatedAt: safe.updatedAt,
  };
}
