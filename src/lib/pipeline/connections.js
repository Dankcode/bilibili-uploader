import db from '../db/sqlite';
import { SOURCES, PROCESSORS, UPLOADERS } from './registry';
import * as bilibiliSource from './sources/bilibili';
import * as douyinSource from './sources/douyin';
import * as voiceoverProcessor from './processors/voiceover';
import * as aiEditorProcessor from './processors/aiEditor';
import * as sceneCutProcessor from './processors/sceneCut';
import * as faceFusionProcessor from './processors/faceFusion';
import * as youtubeUploader from './uploaders/youtube';

const SERVICES = [
  ...SOURCES.map((service) => ({ ...service, role: 'source' })),
  ...PROCESSORS.map((service) => ({ ...service, role: 'processor' })),
  ...UPLOADERS.map((service) => ({ ...service, role: 'uploader' })),
];

const ADAPTERS = {
  bilibili: bilibiliSource,
  douyin: douyinSource,
  voiceover: voiceoverProcessor,
  aiEditor: aiEditorProcessor,
  sceneCut: sceneCutProcessor,
  faceFusion: faceFusionProcessor,
  youtube: youtubeUploader,
};

function nowIso() {
  return new Date().toISOString();
}

function parseJson(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function getService(serviceId) {
  const service = SERVICES.find((entry) => entry.id === serviceId);
  if (!service) throw new Error(`Unknown service: ${serviceId}`);
  return service;
}

function isConfigured(service, credentials) {
  const fields = service.credentialFields || [];
  if (fields.length === 0) return true;
  return fields.filter((field) => field.required !== false).every((field) => {
    const value = credentials[field.key];
    return value !== undefined && value !== null && String(value).trim() !== '';
  });
}

function publicRow(row) {
  const service = getService(row.service_id);
  const credentials = parseJson(row.credentials_json, {});
  return {
    serviceId: row.service_id,
    configured: isConfigured(service, credentials),
    enabled: Boolean(row.enabled),
    status: row.status || 'untested',
    lastError: row.last_error || '',
    lastTestedAt: row.last_tested_at || '',
    updatedAt: row.updated_at,
    role: service.role,
    credentialFields: service.credentialFields || [],
  };
}

export function listConnections() {
  const rows = db.prepare('SELECT * FROM service_connections ORDER BY service_id ASC').all();
  const byId = new Map(rows.map((row) => [row.service_id, row]));
  return SERVICES.map((service) => {
    const existing = byId.get(service.id);
    if (existing) return publicRow(existing);
    return {
      serviceId: service.id,
      configured: (service.credentialFields || []).length === 0,
      enabled: false,
      status: 'untested',
      lastError: '',
      lastTestedAt: '',
      updatedAt: '',
      role: service.role,
      credentialFields: service.credentialFields || [],
    };
  });
}

export function saveConnection(serviceId, credentials = {}) {
  const service = getService(serviceId);
  const now = nowIso();
  const existing = db.prepare('SELECT * FROM service_connections WHERE service_id = ?').get(serviceId);
  const previousCredentials = parseJson(existing?.credentials_json, {});
  const nextCredentials = { ...previousCredentials };
  for (const [key, value] of Object.entries(credentials || {})) {
    if ((service.credentialFields || []).some((field) => field.key === key)) {
      nextCredentials[key] = value;
    }
  }
  const configured = isConfigured(service, nextCredentials);
  db.prepare(`
    INSERT INTO service_connections (
      service_id, credentials_json, enabled, status, last_tested_at, last_error, updated_at, created_at
    )
    VALUES (?, ?, 0, 'untested', '', '', ?, ?)
    ON CONFLICT(service_id) DO UPDATE SET
      credentials_json = excluded.credentials_json,
      status = 'untested',
      last_error = '',
      updated_at = excluded.updated_at
  `).run(serviceId, JSON.stringify(nextCredentials), now, now);
  return { serviceId, configured, status: 'untested' };
}

export async function testService(serviceId) {
  const service = getService(serviceId);
  const adapter = ADAPTERS[serviceId];
  if (!adapter?.testConnection) throw new Error(`No testConnection adapter for ${serviceId}`);
  const credentials = getCredentials(serviceId);
  const result = await adapter.testConnection(credentials);
  const ok = Boolean(result?.ok);
  const now = nowIso();
  db.prepare(`
    INSERT INTO service_connections (
      service_id, credentials_json, enabled, status, last_tested_at, last_error, updated_at, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(service_id) DO UPDATE SET
      status = excluded.status,
      last_tested_at = excluded.last_tested_at,
      last_error = excluded.last_error,
      updated_at = excluded.updated_at,
      enabled = CASE WHEN excluded.status = 'ok' THEN service_connections.enabled ELSE 0 END
  `).run(
    serviceId,
    JSON.stringify(credentials),
    0,
    ok ? 'ok' : 'failed',
    now,
    ok ? '' : (result?.error || 'Connection test failed'),
    now,
    now
  );
  return {
    serviceId,
    configured: isConfigured(service, credentials),
    status: ok ? 'ok' : 'failed',
    lastError: ok ? '' : (result?.error || 'Connection test failed'),
  };
}

export function setConnectionEnabled(serviceId, enabled) {
  getService(serviceId);
  const row = db.prepare('SELECT * FROM service_connections WHERE service_id = ?').get(serviceId);
  if (!row) throw new Error('Save and test this service before enabling it');
  if (enabled && row.status !== 'ok') throw new Error('Only services with a passing test can be enabled');
  db.prepare('UPDATE service_connections SET enabled = ?, updated_at = ? WHERE service_id = ?').run(enabled ? 1 : 0, nowIso(), serviceId);
  return { serviceId, enabled: Boolean(enabled) };
}

export function getCredentials(serviceId) {
  getService(serviceId);
  const row = db.prepare('SELECT credentials_json FROM service_connections WHERE service_id = ?').get(serviceId);
  const saved = parseJson(row?.credentials_json, {});
  if (serviceId === 'douyin' && !saved.sidecarUrl) saved.sidecarUrl = process.env.DOUYIN_SIDECAR_URL || 'http://127.0.0.1:8756';
  return saved;
}
