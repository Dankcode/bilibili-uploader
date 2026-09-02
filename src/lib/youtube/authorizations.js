import { randomUUID } from 'crypto';
import db from '../db/sqlite.js';

const YOUTUBE_UPLOAD_SCOPE = 'https://www.googleapis.com/auth/youtube.upload';
const YOUTUBE_READ_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
const USABLE_STATUSES = new Set(['configured', 'active']);
const ALL_STATUSES = new Set(['configured', 'active', 'reauth_required', 'revoked', 'error']);
const SECRET_FIELDS = new Set([
  'password', 'cookies', 'accessToken', 'access_token', 'refreshToken', 'refresh_token',
  'clientSecret', 'client_secret', 'smsCode', 'sms_code', 'token',
]);

function nowIso() {
  return new Date().toISOString();
}

function cleanText(value, maxLength = 1000) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function parseJson(value, fallback = []) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function assertNoSecrets(input = {}) {
  const supplied = Object.keys(input).find((key) => SECRET_FIELDS.has(key));
  if (supplied) {
    throw new Error('Passwords, cookies, SMS codes, and OAuth tokens are not accepted. Store OAuth credentials in the local secret store and register only its credential reference.');
  }
}

function normalizeEmail(value) {
  const email = cleanText(value, 320).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('A valid Google account email address is required');
  }
  return email;
}

function normalizeChannelId(value) {
  const channelId = cleanText(value, 128);
  if (!/^[A-Za-z0-9_-]{3,128}$/.test(channelId)) {
    throw new Error('A valid YouTube channel ID is required');
  }
  return channelId;
}

export function normalizeLongUploadsStatus(value) {
  const status = cleanText(value || 'unknown', 40).toLowerCase();
  // YouTube currently returns allowed, eligible, disallowed, or unknown. Keep
  // an unfamiliar future value visible but treat it conservatively at queue.
  return status || 'unknown';
}

export function normalizeCredentialRef(value) {
  const credentialRef = cleanText(value, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(credentialRef) || credentialRef.includes('..')) {
    throw new Error('credentialRef must be a simple local credential name without paths');
  }
  return credentialRef;
}

function rowToAuthorization(row) {
  if (!row) return null;
  return {
    id: row.id,
    googleSubject: row.google_subject || '',
    emailAddress: row.email_address,
    channelId: row.channel_id,
    channelTitle: row.channel_title || '',
    clientRef: row.client_ref || row.credential_ref,
    credentialRef: row.credential_ref,
    longUploadsStatus: normalizeLongUploadsStatus(row.long_uploads_status),
    scopes: parseJson(row.scopes_json, []),
    status: row.status,
    enabled: Boolean(row.enabled),
    authorizedAt: row.authorized_at || '',
    verifiedAt: row.verified_at || '',
    lastError: row.last_error || '',
    publicationCount: Number(row.publication_count) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function publicYouTubeAuthorization(authorization) {
  if (!authorization) return null;
  const { clientRef: _clientRef, credentialRef: _credentialRef, ...publicFields } = authorization;
  return {
    ...publicFields,
    credentialConfigured: Boolean(authorization.clientRef && authorization.credentialRef),
  };
}

export function listYouTubeAuthorizations() {
  return db.prepare(`
    SELECT ya.*, COUNT(yub.publication_id) AS publication_count
    FROM youtube_authorizations ya
    LEFT JOIN youtube_upload_bindings yub ON yub.authorization_id = ya.id
    GROUP BY ya.id
    ORDER BY ya.enabled DESC, ya.channel_title COLLATE NOCASE, ya.email_address COLLATE NOCASE
  `).all().map(rowToAuthorization).map(publicYouTubeAuthorization);
}

export function getYouTubeAuthorization(id, { requireUsable = false } = {}) {
  const authorization = rowToAuthorization(db.prepare(`
    SELECT ya.*, COUNT(yub.publication_id) AS publication_count
    FROM youtube_authorizations ya
    LEFT JOIN youtube_upload_bindings yub ON yub.authorization_id = ya.id
    WHERE ya.id = ?
    GROUP BY ya.id
  `).get(cleanText(id, 128)));
  if (!authorization) throw new Error(`YouTube authorization not found: ${id}`);
  if (requireUsable && (!authorization.enabled || !USABLE_STATUSES.has(authorization.status))) {
    throw new Error(`YouTube authorization is not usable: ${authorization.status}`);
  }
  return authorization;
}

export function registerYouTubeAuthorization(input = {}) {
  assertNoSecrets(input);
  const emailAddress = normalizeEmail(input.emailAddress || input.email);
  const channelId = normalizeChannelId(input.channelId);
  const credentialRef = normalizeCredentialRef(input.credentialRef);
  const clientRef = normalizeCredentialRef(input.clientRef || credentialRef);
  const longUploadsStatus = normalizeLongUploadsStatus(input.longUploadsStatus);
  const currentTime = nowIso();
  const existing = db.prepare(`
    SELECT id FROM youtube_authorizations WHERE email_address = ? AND channel_id = ?
  `).get(emailAddress, channelId);
  const id = existing?.id || randomUUID();
  try {
    db.prepare(`
      INSERT INTO youtube_authorizations (
        id, google_subject, email_address, channel_id, channel_title, credential_ref, client_ref, long_uploads_status,
        scopes_json, status, enabled, authorized_at, verified_at, last_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'configured', 1, ?, '', '', ?, ?)
      ON CONFLICT(email_address, channel_id) DO UPDATE SET
        google_subject = excluded.google_subject,
        channel_title = excluded.channel_title,
        credential_ref = excluded.credential_ref,
        client_ref = excluded.client_ref,
        long_uploads_status = excluded.long_uploads_status,
        scopes_json = excluded.scopes_json,
        status = CASE WHEN youtube_authorizations.status = 'active' THEN 'active' ELSE 'configured' END,
        enabled = 1,
        last_error = '',
        updated_at = excluded.updated_at
    `).run(
      id,
      cleanText(input.googleSubject, 255),
      emailAddress,
      channelId,
      cleanText(input.channelTitle || input.displayName, 240),
      credentialRef,
      clientRef,
      longUploadsStatus,
      JSON.stringify([YOUTUBE_UPLOAD_SCOPE, YOUTUBE_READ_SCOPE]),
      cleanText(input.authorizedAt, 80) || currentTime,
      currentTime,
      currentTime,
    );
  } catch (error) {
    if (/credential_ref/i.test(error.message) || /UNIQUE constraint failed/i.test(error.message)) {
      throw new Error('That OAuth credential reference is already assigned to another YouTube authorization');
    }
    throw error;
  }
  return publicYouTubeAuthorization(getYouTubeAuthorization(id));
}

export function updateYouTubeAuthorization(id, patch = {}) {
  assertNoSecrets(patch);
  const previous = getYouTubeAuthorization(id);
  const enabled = patch.enabled === undefined ? previous.enabled : Boolean(patch.enabled);
  let status = cleanText(patch.status || previous.status, 40);
  if (!ALL_STATUSES.has(status)) throw new Error(`Unsupported YouTube authorization status: ${status}`);
  if (!enabled) status = status === 'revoked' ? 'revoked' : 'reauth_required';
  if (enabled && !USABLE_STATUSES.has(status)) status = 'configured';
  db.prepare(`
    UPDATE youtube_authorizations
    SET google_subject = ?, email_address = ?, channel_id = ?, channel_title = ?,
        credential_ref = ?, client_ref = ?, long_uploads_status = ?, status = ?, enabled = ?, last_error = ?, updated_at = ?
    WHERE id = ?
  `).run(
    cleanText(patch.googleSubject ?? previous.googleSubject, 255),
    patch.emailAddress === undefined ? previous.emailAddress : normalizeEmail(patch.emailAddress),
    patch.channelId === undefined ? previous.channelId : normalizeChannelId(patch.channelId),
    cleanText(patch.channelTitle ?? previous.channelTitle, 240),
    patch.credentialRef === undefined ? previous.credentialRef : normalizeCredentialRef(patch.credentialRef),
    patch.clientRef === undefined ? previous.clientRef : normalizeCredentialRef(patch.clientRef),
    patch.longUploadsStatus === undefined ? previous.longUploadsStatus : normalizeLongUploadsStatus(patch.longUploadsStatus),
    status,
    enabled ? 1 : 0,
    cleanText(patch.lastError ?? previous.lastError, 2000),
    nowIso(),
    previous.id,
  );
  return publicYouTubeAuthorization(getYouTubeAuthorization(previous.id));
}

export function bindJobToYouTubeAuthorization(jobId, authorizationId) {
  const authorization = getYouTubeAuthorization(authorizationId, { requireUsable: true });
  const existing = db.prepare('SELECT authorization_id FROM youtube_upload_bindings WHERE job_id = ?').get(jobId);
  if (existing) {
    if (existing.authorization_id !== authorization.id) {
      throw new Error('A YouTube upload job cannot be rebound to another authorization');
    }
    return authorization;
  }
  const currentTime = nowIso();
  db.prepare(`
    INSERT INTO youtube_upload_bindings (job_id, authorization_id, publication_id, created_at, updated_at)
    VALUES (?, ?, NULL, ?, ?)
  `).run(jobId, authorization.id, currentTime, currentTime);
  return authorization;
}

export function getJobYouTubeAuthorization(jobId, { requireUsable = false } = {}) {
  const binding = db.prepare('SELECT authorization_id FROM youtube_upload_bindings WHERE job_id = ?').get(jobId);
  if (!binding) return null;
  return getYouTubeAuthorization(binding.authorization_id, { requireUsable });
}

export function attachPublicationToYouTubeBinding(jobId, publicationId) {
  const binding = db.prepare(`
    SELECT publication_id FROM youtube_upload_bindings WHERE job_id = ?
  `).get(jobId);
  if (!binding) return null;
  if (binding.publication_id && Number(binding.publication_id) !== Number(publicationId)) {
    throw new Error('YouTube upload binding already points to another publication');
  }
  db.prepare(`
    UPDATE youtube_upload_bindings SET publication_id = ?, updated_at = ? WHERE job_id = ?
  `).run(publicationId, nowIso(), jobId);
  return Number(publicationId);
}

export function markYouTubeAuthorizationVerified(id) {
  const currentTime = nowIso();
  db.prepare(`
    UPDATE youtube_authorizations
    SET status = 'active', enabled = 1, verified_at = ?, last_error = '', updated_at = ?
    WHERE id = ?
  `).run(currentTime, currentTime, id);
}
