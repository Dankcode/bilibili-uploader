import db from '../db/sqlite';
import { SOURCES, PROCESSORS, UPLOADERS, NOTIFIERS } from './registry';
import * as bilibiliSource from './sources/bilibili';
import * as douyinSource from './sources/douyin';
import * as localFileSource from './sources/localFile';
import * as voiceoverProcessor from './processors/voiceover';
import * as aiEditorProcessor from './processors/aiEditor';
import * as sceneCutProcessor from './processors/sceneCut';
import * as faceFusionProcessor from './processors/faceFusion';
import * as metadataProcessor from './processors/metadata';
import * as videoContextProcessor from './processors/videoContext';
import * as ocrContextProcessor from './processors/ocrContext';
import * as youtubeUploader from './uploaders/youtube';
import * as gmailNotifier from './notifiers/gmail';
import { getBilibiliLoginStatus } from '../video/bilibili';
import { decryptSecret, encryptSecret, hasSecretKey, isEncryptedSecret } from '../security/secrets.js';

const SERVICES = [
  ...SOURCES.map((service) => ({ ...service, role: 'source' })),
  ...PROCESSORS.map((service) => ({ ...service, role: 'processor' })),
  ...UPLOADERS.map((service) => ({ ...service, role: 'uploader' })),
  ...NOTIFIERS.map((service) => ({ ...service, role: 'notifier' })),
];

const ADAPTERS = {
  localFile: localFileSource,
  bilibili: bilibiliSource,
  douyin: douyinSource,
  voiceover: voiceoverProcessor,
  aiEditor: aiEditorProcessor,
  sceneCut: sceneCutProcessor,
  faceFusion: faceFusionProcessor,
  metadata: metadataProcessor,
  videoContext: videoContextProcessor,
  ocrContext: ocrContextProcessor,
  youtube: youtubeUploader,
  gmail: gmailNotifier,
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

function decodeCredentials(service, value) {
  const saved = parseJson(value, {});
  const secretKeys = new Set((service.credentialFields || []).filter((field) => field.type === 'secret').map((field) => field.key));
  return Object.fromEntries(Object.entries(saved).map(([key, item]) => [key, secretKeys.has(key) ? decryptSecret(item) : item]));
}

function encodeCredentials(service, credentials) {
  const secretKeys = new Set((service.credentialFields || []).filter((field) => field.type === 'secret').map((field) => field.key));
  return Object.fromEntries(Object.entries(credentials).map(([key, item]) => {
    if (!secretKeys.has(key) || !item || isEncryptedSecret(item)) return [key, item];
    // Existing optional services remain compatible until an operator provides
    // a key. Gmail is stricter because its refresh token is mailbox access.
    if (!hasSecretKey()) {
      if (service.id === 'gmail') throw new Error('Set STUDIO_SECRET_KEY before saving Gmail OAuth credentials.');
      return [key, item];
    }
    return [key, encryptSecret(item)];
  }));
}

function getService(serviceId) {
  const service = SERVICES.find((entry) => entry.id === serviceId);
  if (!service) throw new Error(`Unknown service: ${serviceId}`);
  return service;
}

/**
 * Keep authorization state separate from configuration: a saved credential is
 * not proof that it still works. This predicate is deliberately shared by the
 * worker, connection tests, and diagnostics so all surfaces agree about an
 * expired sign-in.
 */
export function isAuthFailure(error) {
  const text = String(error?.message || error || '').toLowerCase();
  return /invalid_grant|token has been expired|token.*expired|unauthori[sz]ed|\b401\b|\b403\b|sessdata|risk.?control|\b-352\b|\b412\b|login required|authentication failed/.test(text);
}

function authStateFor(error, configured) {
  if (error) return isAuthFailure(error) ? 'expired' : 'unknown';
  return configured ? 'valid' : 'not_configured';
}

function untestedAuthState(configured) {
  return configured ? 'unknown' : 'not_configured';
}

function fieldValidationError(field, value) {
  const text = String(value ?? '').trim();
  if (!text) return field.required === false ? '' : `${field.label} is required.`;
  if (field.pattern && !(new RegExp(field.pattern)).test(text)) {
    return field.hint || `${field.label} has an invalid format.`;
  }
  return '';
}

export function validateCredentials(serviceId, credentials = {}) {
  const service = getService(serviceId);
  const issues = {};
  for (const field of service.credentialFields || []) {
    const error = fieldValidationError(field, credentials[field.key]);
    if (error) issues[field.key] = error;
  }
  return { valid: Object.keys(issues).length === 0, issues };
}

function isConfigured(service, credentials) {
  if (service.id === 'bilibili') return getBilibiliLoginStatus().authenticated;
  const fields = service.credentialFields || [];
  if (fields.length === 0) return true;
  return fields.filter((field) => field.required !== false).every((field) => {
    const value = credentials[field.key];
    return value !== undefined && value !== null && String(value).trim() !== '';
  });
}

function publicRow(row) {
  const service = getService(row.service_id);
  const credentials = decodeCredentials(service, row.credentials_json);
  const preferences = Object.fromEntries((service.credentialFields || [])
    .filter((field) => field.type !== 'secret' && credentials[field.key] !== undefined)
    .map((field) => [field.key, credentials[field.key]]));
  return {
    serviceId: row.service_id,
    label: service.label,
    configured: isConfigured(service, credentials),
    enabled: Boolean(row.enabled),
    status: row.status || 'untested',
    authState: row.auth_state || 'unknown',
    checkedAt: row.checked_at || '',
    lastError: row.last_error || '',
    lastTestedAt: row.last_tested_at || '',
    updatedAt: row.updated_at,
    role: service.role,
    credentialFields: service.credentialFields || [],
    preferences,
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
      label: service.label,
      configured: (service.credentialFields || []).length === 0,
      enabled: false,
      status: 'untested',
      authState: 'unknown',
      checkedAt: '',
      lastError: '',
      lastTestedAt: '',
      updatedAt: '',
      role: service.role,
      credentialFields: service.credentialFields || [],
      preferences: {},
    };
  });
}

export function saveConnection(serviceId, credentials = {}) {
  const service = getService(serviceId);
  const now = nowIso();
  const existing = db.prepare('SELECT * FROM service_connections WHERE service_id = ?').get(serviceId);
  const previousCredentials = existing ? decodeCredentials(service, existing.credentials_json) : {};
  const nextCredentials = { ...previousCredentials };
  for (const [key, value] of Object.entries(credentials || {})) {
    if ((service.credentialFields || []).some((field) => field.key === key)) {
      nextCredentials[key] = value;
    }
  }
  const validation = validateCredentials(serviceId, nextCredentials);
  if (!validation.valid) throw new Error(Object.values(validation.issues)[0]);
  const configured = isConfigured(service, nextCredentials);
  db.prepare(`
    INSERT INTO service_connections (
      service_id, credentials_json, enabled, status, auth_state, checked_at, last_tested_at, last_error, updated_at, created_at
    )
    VALUES (?, ?, 0, 'untested', ?, '', '', '', ?, ?)
    ON CONFLICT(service_id) DO UPDATE SET
      credentials_json = excluded.credentials_json,
      status = 'untested',
      auth_state = excluded.auth_state,
      checked_at = '',
      last_tested_at = '',
      last_error = '',
      updated_at = excluded.updated_at
  `).run(serviceId, JSON.stringify(encodeCredentials(service, nextCredentials)), untestedAuthState(configured), now, now);
  return { serviceId, configured, status: 'untested' };
}

/** The only writer for connection health outcomes. */
export function recordOutcome(serviceId, { connectionId = '', error = null } = {}) {
  const service = getService(serviceId);
  const now = nowIso();
  const existing = db.prepare('SELECT * FROM service_connections WHERE service_id = ?').get(serviceId);
  const credentials = existing ? decodeCredentials(service, existing.credentials_json) : {};
  const configured = isConfigured(service, credentials);
  const message = error ? String(error?.message || error) : '';
  if (!existing) {
    db.prepare(`
      INSERT INTO service_connections (
        service_id, credentials_json, enabled, status, auth_state, checked_at, last_tested_at, last_error, updated_at, created_at
      ) VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      serviceId,
      JSON.stringify(encodeCredentials(service, credentials)),
      message ? 'failed' : 'ok',
      authStateFor(message, configured),
      now,
      now,
      message,
      now,
      now,
    );
  } else {
    db.prepare(`
      UPDATE service_connections
      SET status = ?, auth_state = ?, checked_at = ?, last_tested_at = ?, last_error = ?,
          enabled = CASE WHEN ? = 'failed' THEN 0 ELSE enabled END, updated_at = ?
      WHERE service_id = ?
    `).run(
      message ? 'failed' : 'ok',
      authStateFor(message, configured),
      now,
      now,
      message,
      message ? 'failed' : 'ok',
      now,
      serviceId,
    );
  }
  return { serviceId, connectionId, configured, status: message ? 'failed' : 'ok', authState: authStateFor(message, configured), checkedAt: now, lastError: message };
}

/**
 * Run one adapter probe and persist its result through recordOutcome. Keeping
 * this beside recordOutcome prevents a new caller from accidentally creating a
 * second connection-health writer.
 */
export async function probeService(serviceId, { credentials = null, context = {}, connectionId = '' } = {}) {
  getService(serviceId);
  const adapter = ADAPTERS[serviceId];
  if (!adapter?.testConnection) throw new Error(`No testConnection adapter for ${serviceId}`);
  const resolvedCredentials = credentials === null ? getCredentials(serviceId) : credentials;
  try {
    const result = await adapter.testConnection(resolvedCredentials, context);
    const outcome = recordOutcome(serviceId, {
      connectionId,
      error: result?.ok ? null : (result?.error || 'Connection test failed'),
    });
    return { result, outcome };
  } catch (error) {
    recordOutcome(serviceId, { connectionId, error });
    throw error;
  }
}

export async function testService(serviceId, credentialsOverride = {}) {
  const service = getService(serviceId);
  const supplied = Object.fromEntries(Object.entries(credentialsOverride || {}).filter(([, value]) => value !== undefined));
  // Testing a newly pasted value must not report a green state that disappears
  // on refresh. Persist the validated draft first; secrets still stay server
  // side and are never returned by the connection endpoint.
  if (Object.keys(supplied).length) saveConnection(serviceId, supplied);
  const credentials = { ...getCredentials(serviceId), ...supplied };
  const validation = validateCredentials(serviceId, credentials);
  if (!validation.valid) throw new Error(Object.values(validation.issues)[0]);
  const { outcome } = await probeService(serviceId, { credentials });
  return {
    serviceId,
    configured: isConfigured(service, credentials),
    status: outcome.status,
    authState: outcome.authState,
    lastError: outcome.lastError,
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
  const saved = row ? decodeCredentials(getService(serviceId), row.credentials_json) : {};
  if (serviceId === 'douyin' && !saved.sidecarUrl) saved.sidecarUrl = process.env.DOUYIN_SIDECAR_URL || 'http://127.0.0.1:8756';
  return saved;
}
