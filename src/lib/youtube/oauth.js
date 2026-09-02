import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';
import { normalizeCredentialRef, registerYouTubeAuthorization } from './authorizations.js';

const activeAuthorizations = new Map();
const completedAuthorizations = new Map();
const activeWebAuthorizations = new Map();
const WEB_OAUTH_REDIRECT_URI = String(process.env.YOUTUBE_WEB_OAUTH_REDIRECT_URI || 'http://localhost:4455/').trim();
const WEB_OAUTH_TTL_MS = 10 * 60 * 1000;
const YOUTUBE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
];

export function youtubeClientSecretPath(clientRef, root = process.cwd()) {
  return path.join(root, `${normalizeCredentialRef(clientRef)}_client_secret.json`);
}

export function youtubeTokenPath(credentialRef, root = process.cwd()) {
  return path.join(root, `${normalizeCredentialRef(credentialRef)}_token.json`);
}

function parseLocalOAuthClientSecret(value) {
  let payload;
  try {
    payload = JSON.parse(String(value || ''));
  } catch {
    throw new Error('Google OAuth client file must contain valid JSON');
  }
  const installed = payload?.installed;
  const web = payload?.web;
  const kind = installed && typeof installed === 'object' ? 'installed' : web && typeof web === 'object' ? 'web' : '';
  const configuration = kind === 'installed' ? installed : web;
  if (!kind) {
    throw new Error('Use a Google OAuth client JSON file with an "installed" or "web" configuration');
  }
  if (!String(configuration.client_id || '').trim() || !String(configuration.client_secret || '').trim()) {
    throw new Error('Google OAuth client JSON is missing its client ID or client secret');
  }
  const redirectUris = Array.isArray(configuration.redirect_uris) ? configuration.redirect_uris.map((uri) => String(uri)) : [];
  if (kind === 'installed' && !redirectUris.some((uri) => /^http:\/\/localhost(?::\d+)?\/?$/i.test(uri))) {
    throw new Error('Google OAuth Desktop app client must allow a localhost redirect URI');
  }
  if (kind === 'web' && !redirectUris.includes(WEB_OAUTH_REDIRECT_URI)) {
    throw new Error(`Google OAuth web client must authorize the local callback ${WEB_OAUTH_REDIRECT_URI}`);
  }
  return { payload, kind, configuration, redirectUris };
}

function readLocalOAuthClient(clientRef) {
  const clientPath = youtubeClientSecretPath(clientRef);
  return parseLocalOAuthClientSecret(fs.readFileSync(clientPath, 'utf8'));
}

/**
 * Saves only an operator-selected Google Desktop OAuth client locally. The
 * response reports configuration state, never any part of the client secret.
 */
export function saveYouTubeClientSecret(fileContents, clientRef = 'youtube', root = process.cwd()) {
  const content = Buffer.isBuffer(fileContents) ? fileContents.toString('utf8') : String(fileContents || '');
  if (!content || Buffer.byteLength(content, 'utf8') > 64 * 1024) {
    throw new Error('Google OAuth client JSON must be between 1 byte and 64 KB');
  }
  const client = parseLocalOAuthClientSecret(content);
  const destination = youtubeClientSecretPath(clientRef, root);
  fs.writeFileSync(destination, content, { encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(destination, 0o600); } catch { /* best effort on non-POSIX hosts */ }
  return { configured: true, clientRef: normalizeCredentialRef(clientRef), flow: client.kind === 'web' ? 'web-server' : 'local-app' };
}

export function getYouTubeClientStatus(clientRef = 'youtube', root = process.cwd()) {
  const credentialRef = normalizeCredentialRef(clientRef);
  const clientPath = youtubeClientSecretPath(credentialRef, root);
  if (!fs.existsSync(clientPath)) return { configured: false, clientRef: credentialRef };
  try {
    const client = parseLocalOAuthClientSecret(fs.readFileSync(clientPath, 'utf8'));
    return { configured: true, clientRef: credentialRef, flow: client.kind === 'web' ? 'web-server' : 'local-app' };
  } catch {
    return { configured: false, clientRef: credentialRef, invalid: true };
  }
}

export function normalizeExpectedGoogleEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!email) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Google account email must be a valid email address');
  return email;
}

function refs(input, legacyExpectedEmail = '') {
  const values = typeof input === 'object' && input !== null ? input : { credentialRef: input, expectedEmail: legacyExpectedEmail };
  const credentialRef = normalizeCredentialRef(values.credentialRef);
  return { credentialRef, clientRef: normalizeCredentialRef(values.clientRef || credentialRef), expectedEmail: normalizeExpectedGoogleEmail(values.expectedEmail) };
}

/**
 * The normal operator path deliberately has no token-name form field.  A
 * temporary local ref is used while Google is open, then the accepted channel
 * gets the predictable `youtube-<channel-id>_token.json` name.  The token
 * itself remains an owner-only local file; Settings and API responses expose
 * only the safe reference.
 */
export function defaultYouTubeTokenRef(channelId) {
  const normalized = String(channelId || '').trim();
  if (!/^[A-Za-z0-9_-]{3,110}$/.test(normalized)) {
    throw new Error('A valid YouTube channel ID is required for the token reference');
  }
  return `youtube-${normalized}`;
}

function pendingYouTubeTokenRef() {
  return `youtube-pending-${randomUUID().replaceAll('-', '').slice(0, 20)}`;
}

function publicStatus(credentialRef) {
  const ref = normalizeCredentialRef(credentialRef);
  const active = activeAuthorizations.get(ref);
  if (active) return { credentialRef: ref, clientRef: active.clientRef, state: 'waiting', message: 'Complete Google sign-in and consent in the browser window, then check sign-in.' };
  return completedAuthorizations.get(ref) || { credentialRef: ref, state: 'idle', message: 'Ready to open Google sign-in.' };
}

function parseResult(output) {
  const line = String(output || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean).reverse().find((item) => item.startsWith('{') && item.endsWith('}'));
  if (!line) return null;
  try {
    const parsed = JSON.parse(line);
    return parsed?.emailAddress && Array.isArray(parsed?.channels) ? parsed : null;
  } catch { return null; }
}

function publicWaitingStatus(credentialRef, clientRef, authorizationUrl) {
  return {
    credentialRef: normalizeCredentialRef(credentialRef),
    clientRef: normalizeCredentialRef(clientRef),
    state: 'redirect',
    message: 'Continue in Google, then return to this app to choose the YouTube channel.',
    authorizationUrl,
  };
}

function webOAuthClient(client) {
  return new google.auth.OAuth2(client.configuration.client_id, client.configuration.client_secret, WEB_OAUTH_REDIRECT_URI);
}

function writeOwnerOnly(pathname, value) {
  fs.writeFileSync(pathname, value, { encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(pathname, 0o600); } catch { /* best effort on non-POSIX hosts */ }
}

function finishAsError(credentialRef, clientRef, message) {
  const result = { credentialRef, clientRef, state: 'error', message };
  completedAuthorizations.set(credentialRef, result);
  return result;
}

function startWebYouTubeAuthorization({ credentialRef, clientRef, expectedEmail, client, autoNameToken = false }) {
  const state = randomUUID();
  const oauth = webOAuthClient(client);
  const authorizationUrl = oauth.generateAuthUrl({
    access_type: 'offline',
    include_granted_scopes: true,
    prompt: 'consent',
    scope: YOUTUBE_SCOPES,
    state,
    login_hint: expectedEmail || undefined,
  });
  activeWebAuthorizations.set(state, {
    credentialRef,
    clientRef,
    expectedEmail,
    client,
    autoNameToken,
    createdAt: Date.now(),
  });
  const status = publicWaitingStatus(credentialRef, clientRef, authorizationUrl);
  completedAuthorizations.set(credentialRef, { ...status, authorizationUrl: undefined });
  return status;
}

/** Completes only a state-bound local web callback; credentials never leave this process. */
export async function completeWebYouTubeAuthorization({ state, code, error } = {}) {
  const stateKey = String(state || '').trim();
  const pending = activeWebAuthorizations.get(stateKey);
  if (!pending || Date.now() - pending.createdAt > WEB_OAUTH_TTL_MS) {
    activeWebAuthorizations.delete(stateKey);
    throw new Error('Google sign-in has expired. Start the connection again from Connections.');
  }
  activeWebAuthorizations.delete(stateKey);
  const { credentialRef, clientRef, expectedEmail, client, autoNameToken } = pending;
  if (error) return finishAsError(credentialRef, clientRef, 'Google sign-in was canceled or access was not granted.');
  if (!code) return finishAsError(credentialRef, clientRef, 'Google did not return an authorization code.');
  try {
    const oauth = webOAuthClient(client);
    const { tokens } = await oauth.getToken(String(code));
    if (!tokens?.refresh_token) throw new Error('Google did not return a refresh token');
    oauth.setCredentials(tokens);
    const [identityResponse, channelResponse] = await Promise.all([
      google.oauth2({ version: 'v2', auth: oauth }).userinfo.get(),
      google.youtube({ version: 'v3', auth: oauth }).channels.list({ part: 'id,snippet,status', mine: true }),
    ]);
    const emailAddress = String(identityResponse.data.email || '').trim().toLowerCase();
    if (!emailAddress) throw new Error('Google did not return the account email');
    if (expectedEmail && emailAddress !== expectedEmail) {
      return finishAsError(credentialRef, clientRef, `The selected Google account did not match ${expectedEmail}. No upload authorization was saved.`);
    }
    const channels = (channelResponse.data.items || []).map((channel) => ({
      channelId: String(channel.id || ''),
      channelTitle: String(channel.snippet?.title || ''),
      longUploadsStatus: String(channel.status?.longUploadsStatus || 'unknown'),
    })).filter((channel) => channel.channelId);
    if (!channels.length) throw new Error('Authorized Google account has no YouTube channel');
    writeOwnerOnly(youtubeTokenPath(credentialRef), JSON.stringify(tokens));
    const result = {
      credentialRef,
      clientRef,
      state: 'confirm',
      message: 'Choose and confirm the YouTube channel returned by Google before enabling uploads.',
      candidate: { emailAddress, googleSubject: String(identityResponse.data.id || ''), channels },
      autoNameToken,
    };
    completedAuthorizations.set(credentialRef, result);
    return result;
  } catch {
    try { fs.unlinkSync(youtubeTokenPath(credentialRef)); } catch { /* no token to remove */ }
    return finishAsError(credentialRef, clientRef, 'Google/YouTube authorization did not complete. Check consent, enabled YouTube APIs, and local OAuth client configuration.');
  }
}

/** Starts OAuth but defers persistence until the operator confirms the channel. */
export function startYouTubeAuthorization(input, legacyExpectedEmail = '') {
  const { credentialRef, clientRef, expectedEmail } = refs(input, legacyExpectedEmail);
  if (activeAuthorizations.has(credentialRef)) return publicStatus(credentialRef);
  if (!fs.existsSync(youtubeClientSecretPath(clientRef))) throw new Error(`Missing local OAuth client file: ${clientRef}_client_secret.json`);
  const client = readLocalOAuthClient(clientRef);
  if (client.kind === 'web') return startWebYouTubeAuthorization({ credentialRef, clientRef, expectedEmail, client, autoNameToken: Boolean(input?.autoNameToken) });
  const scriptPath = path.join(process.cwd(), 'scripts', 'python', 'authorize_youtube.py');
  if (!fs.existsSync(scriptPath)) throw new Error('Missing local Google/YouTube authorization helper.');
  const child = spawn('python3', [scriptPath, clientRef, credentialRef, expectedEmail], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
  const state = { child, clientRef, expectedEmail, output: '', errorOutput: '' };
  activeAuthorizations.set(credentialRef, state);
  child.stdout.on('data', (chunk) => { state.output = `${state.output}${chunk}`.slice(-65536); });
  child.stderr.on('data', (chunk) => { state.errorOutput = `${state.errorOutput}${chunk}`.slice(-65536); });
  child.on('error', () => {
    activeAuthorizations.delete(credentialRef);
    completedAuthorizations.set(credentialRef, { credentialRef, clientRef, state: 'error', message: 'Could not start the local Google authorization helper.' });
  });
  child.on('close', (code) => {
    activeAuthorizations.delete(credentialRef);
    const result = code === 0 ? parseResult(state.output) : null;
    if (!result) {
      completedAuthorizations.set(credentialRef, { credentialRef, clientRef, state: 'error', message: 'Google/YouTube authorization did not complete. Check the browser window and local OAuth client configuration.' });
      return;
    }
    if (state.expectedEmail && String(result.emailAddress).toLowerCase() !== state.expectedEmail) {
      try { fs.unlinkSync(youtubeTokenPath(credentialRef)); } catch { /* token was not written */ }
      completedAuthorizations.set(credentialRef, { credentialRef, clientRef, state: 'error', message: `The selected Google account did not match ${state.expectedEmail}. No upload authorization was saved.` });
      return;
    }
    const channels = result.channels.map((channel) => ({
      channelId: String(channel.channelId || ''), channelTitle: String(channel.channelTitle || ''), longUploadsStatus: String(channel.longUploadsStatus || 'unknown'),
    })).filter((channel) => channel.channelId);
    if (!channels.length) {
      completedAuthorizations.set(credentialRef, { credentialRef, clientRef, state: 'error', message: 'OAuth authorization did not expose a YouTube channel.' });
      return;
    }
    completedAuthorizations.set(credentialRef, {
      credentialRef, clientRef, state: 'confirm', message: 'Choose and confirm the YouTube channel returned by Google before enabling uploads.',
      candidate: { emailAddress: result.emailAddress, googleSubject: result.googleSubject || '', channels },
      autoNameToken: Boolean(state.autoNameToken),
    });
  });
  return publicStatus(credentialRef);
}

/** Open Google's installed-app OAuth flow with the conventional local client. */
export function startDefaultYouTubeAuthorization({ expectedEmail = '' } = {}) {
  const credentialRef = pendingYouTubeTokenRef();
  const result = startYouTubeAuthorization({
    clientRef: 'youtube',
    credentialRef,
    expectedEmail,
    autoNameToken: true,
  });
  const active = activeAuthorizations.get(credentialRef);
  if (active) active.autoNameToken = true;
  return result;
}

export function confirmYouTubeAuthorization({ credentialRef, channelId } = {}) {
  const ref = normalizeCredentialRef(credentialRef);
  const status = completedAuthorizations.get(ref);
  if (status?.state !== 'confirm' || !status.candidate) throw new Error('Complete Google sign-in before confirming a YouTube channel.');
  const selected = status.candidate.channels.find((channel) => channel.channelId === String(channelId || '').trim());
  if (!selected) throw new Error('Choose one of the channels returned by Google before confirming.');
  let tokenRef = ref;
  if (status.autoNameToken) {
    tokenRef = defaultYouTubeTokenRef(selected.channelId);
    const sourceTokenPath = youtubeTokenPath(ref);
    const destinationTokenPath = youtubeTokenPath(tokenRef);
    if (!fs.existsSync(sourceTokenPath)) throw new Error('Google sign-in completed without creating the local token file. Try Connect Google account again.');
    if (sourceTokenPath !== destinationTokenPath && fs.existsSync(destinationTokenPath)) {
      throw new Error(`A token for ${selected.channelId} already exists. Select that authorized channel instead of replacing its token.`);
    }
    if (sourceTokenPath !== destinationTokenPath) fs.renameSync(sourceTokenPath, destinationTokenPath);
  }
  const authorization = registerYouTubeAuthorization({ emailAddress: status.candidate.emailAddress, googleSubject: status.candidate.googleSubject, credentialRef: tokenRef, clientRef: status.clientRef, ...selected });
  const connected = { credentialRef: tokenRef, clientRef: status.clientRef, state: 'connected', message: `Connected ${authorization.emailAddress} to ${authorization.channelTitle || authorization.channelId}. Token saved locally as ${tokenRef}_token.json.`, authorization };
  completedAuthorizations.set(ref, connected);
  return connected;
}

export function getYouTubeAuthorizationStatus(credentialRef) { return publicStatus(credentialRef); }
