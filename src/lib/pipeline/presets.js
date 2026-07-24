import { randomUUID } from 'crypto';
import db from '../db/sqlite';

const BUILT_IN_PRESETS = [
  {
    id: 'studio-full-auto',
    name: 'Studio Full Auto',
    template: {
      processorIds: ['voiceover', 'metadata'],
      uploaderId: 'youtube',
      options: {
        voiceover: { burnSubtitles: true },
        metadata: { reviewMetadata: false },
        youtube: { privacyStatus: 'private' },
      },
    },
  },
  {
    id: 'dub-only',
    name: 'Dub only',
    template: {
      processorIds: ['voiceover'],
      uploaderId: '',
      options: { voiceover: { burnSubtitles: false } },
    },
  },
  {
    id: 'upload-only',
    name: 'Upload only',
    template: {
      processorIds: [],
      uploaderId: 'youtube',
      options: { youtube: { privacyStatus: 'private' } },
    },
  },
];

function parseJson(value, fallback = {}) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function publicPreset(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    template: parseJson(row.template_json, {}),
    builtIn: Boolean(row.built_in),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function ensureBuiltInPresets() {
  const now = new Date().toISOString();
  const statement = db.prepare(`
    INSERT INTO pipeline_presets (id, name, template_json, built_in, created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      template_json = excluded.template_json,
      built_in = 1,
      updated_at = excluded.updated_at
  `);
  for (const preset of BUILT_IN_PRESETS) {
    statement.run(preset.id, preset.name, JSON.stringify(preset.template), now, now);
  }
}

export function listPresets() {
  ensureBuiltInPresets();
  return db.prepare('SELECT * FROM pipeline_presets ORDER BY built_in DESC, name ASC').all().map(publicPreset);
}

export function getPreset(id) {
  ensureBuiltInPresets();
  return publicPreset(db.prepare('SELECT * FROM pipeline_presets WHERE id = ?').get(String(id || '')));
}

export function savePreset({ id, name, template }) {
  const presetId = String(id || randomUUID()).trim();
  const presetName = String(name || '').trim();
  if (!/^[a-zA-Z0-9-]{3,80}$/.test(presetId)) throw new Error('Preset ID is invalid.');
  if (!presetName) throw new Error('Preset name is required.');
  if (!template || typeof template !== 'object') throw new Error('Preset template is required.');
  const existing = db.prepare('SELECT built_in FROM pipeline_presets WHERE id = ?').get(presetId);
  if (existing?.built_in) throw new Error('Built-in presets cannot be overwritten.');
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO pipeline_presets (id, name, template_json, built_in, created_at, updated_at)
    VALUES (?, ?, ?, 0, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      template_json = excluded.template_json,
      updated_at = excluded.updated_at
  `).run(presetId, presetName, JSON.stringify(template), now, now);
  return getPreset(presetId);
}

export function deletePreset(id) {
  const row = db.prepare('SELECT built_in FROM pipeline_presets WHERE id = ?').get(String(id || ''));
  if (!row) return false;
  if (row.built_in) throw new Error('Built-in presets cannot be deleted.');
  db.prepare('DELETE FROM pipeline_presets WHERE id = ?').run(String(id));
  return true;
}

export function getAppSetting(key, fallback = null) {
  const row = db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get(String(key));
  return row ? parseJson(row.value_json, fallback) : fallback;
}

export function setAppSetting(key, value) {
  const updatedAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO app_settings (key, value_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
  `).run(String(key), JSON.stringify(value), updatedAt);
  return value;
}
