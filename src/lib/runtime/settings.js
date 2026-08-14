import fs from 'fs';
import path from 'path';

export const CONNECTION_MODES = Object.freeze({
  SERVER: 'server',
  LOCAL: 'local',
  REMOTE: 'remote',
});

export const REMOTE_TRANSPORTS = Object.freeze({
  TAILSCALE: 'tailscale',
  LAN: 'lan',
});

const DEFAULT_SQLITE_PATH = path.join('config', 'bilibili.db');
const REMOTE_FALLBACK_PATH = path.join('config', 'frontend-state.db');

export const DEFAULT_RUNTIME_SETTINGS = Object.freeze({
  connectionMode: CONNECTION_MODES.SERVER,
  sqlitePath: DEFAULT_SQLITE_PATH,
  remoteTransport: REMOTE_TRANSPORTS.TAILSCALE,
  remoteUrl: '',
  remoteAuthToken: '',
  serverApiToken: '',
  workerEnabled: true,
  workerPollSeconds: 5,
  schedulerPollSeconds: 60,
  updatedAt: '',
});

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function normalizeMode(value) {
  return Object.values(CONNECTION_MODES).includes(value) ? value : CONNECTION_MODES.SERVER;
}

function normalizeTransport(value) {
  return Object.values(REMOTE_TRANSPORTS).includes(value) ? value : REMOTE_TRANSPORTS.TAILSCALE;
}

export function normalizeRemoteUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
  const parsed = new URL(candidate);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Backend URL must use http:// or https://');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Put credentials in the access token field, not in the backend URL');
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

export function normalizeRuntimeSettings(input = {}, previous = DEFAULT_RUNTIME_SETTINGS) {
  const mode = normalizeMode(input.connectionMode ?? previous.connectionMode);
  const sqlitePath = String(input.sqlitePath ?? previous.sqlitePath ?? DEFAULT_SQLITE_PATH).trim() || DEFAULT_SQLITE_PATH;
  const remoteUrl = input.remoteUrl === undefined
    ? String(previous.remoteUrl || '')
    : normalizeRemoteUrl(input.remoteUrl);

  return {
    connectionMode: mode,
    sqlitePath,
    remoteTransport: normalizeTransport(input.remoteTransport ?? previous.remoteTransport),
    remoteUrl,
    remoteAuthToken: String(input.remoteAuthToken ?? previous.remoteAuthToken ?? ''),
    serverApiToken: String(input.serverApiToken ?? previous.serverApiToken ?? ''),
    workerEnabled: input.workerEnabled === undefined ? previous.workerEnabled !== false : Boolean(input.workerEnabled),
    workerPollSeconds: clampInteger(input.workerPollSeconds, previous.workerPollSeconds || 5, 1, 300),
    schedulerPollSeconds: clampInteger(input.schedulerPollSeconds, previous.schedulerPollSeconds || 60, 5, 3600),
    updatedAt: String(input.updatedAt ?? previous.updatedAt ?? ''),
  };
}

export function getRuntimeSettingsPath() {
  const configured = String(process.env.VIDEO_RUNTIME_SETTINGS_PATH || '').trim();
  return path.resolve(configured || path.join(process.cwd(), 'config', 'runtime-settings.json'));
}

export function readRuntimeSettings() {
  const settingsPath = getRuntimeSettingsPath();
  try {
    const stored = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    return normalizeRuntimeSettings(stored, DEFAULT_RUNTIME_SETTINGS);
  } catch (error) {
    if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    return { ...DEFAULT_RUNTIME_SETTINGS };
  }
}

export function writeRuntimeSettings(input = {}) {
  const previous = readRuntimeSettings();
  const settings = normalizeRuntimeSettings({
    ...input,
    remoteAuthToken: input.clearRemoteAuthToken
      ? ''
      : (String(input.remoteAuthToken || '').trim() || previous.remoteAuthToken),
    serverApiToken: input.clearServerApiToken
      ? ''
      : (String(input.serverApiToken || '').trim() || previous.serverApiToken),
    updatedAt: new Date().toISOString(),
  }, previous);
  const settingsPath = getRuntimeSettingsPath();
  const directory = path.dirname(settingsPath);
  const tempPath = `${settingsPath}.${process.pid}.tmp`;
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(tempPath, `${JSON.stringify(settings, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tempPath, settingsPath);
  try {
    fs.chmodSync(settingsPath, 0o600);
  } catch {
    // Some mounted filesystems do not expose POSIX permissions.
  }
  return settings;
}

export function publicRuntimeSettings(settings = readRuntimeSettings()) {
  return {
    connectionMode: settings.connectionMode,
    sqlitePath: settings.sqlitePath,
    remoteTransport: settings.remoteTransport,
    remoteUrl: settings.remoteUrl,
    hasRemoteAuthToken: Boolean(settings.remoteAuthToken),
    hasServerApiToken: Boolean(process.env.VIDEO_SERVER_API_TOKEN || settings.serverApiToken),
    workerEnabled: settings.workerEnabled,
    workerPollSeconds: settings.workerPollSeconds,
    schedulerPollSeconds: settings.schedulerPollSeconds,
    updatedAt: settings.updatedAt,
  };
}

export function resolveDatabasePath(settings = readRuntimeSettings()) {
  const environmentPath = String(process.env.VIDEO_SQLITE_PATH || '').trim();
  if (environmentPath) return path.resolve(environmentPath);
  if (settings.connectionMode === CONNECTION_MODES.REMOTE) {
    return path.resolve(process.cwd(), REMOTE_FALLBACK_PATH);
  }
  return path.resolve(process.cwd(), settings.sqlitePath || DEFAULT_SQLITE_PATH);
}

export function getServerApiToken(settings = readRuntimeSettings()) {
  return String(process.env.VIDEO_SERVER_API_TOKEN || settings.serverApiToken || '');
}

export function assertRuntimeSettings(settings) {
  if (settings.connectionMode === CONNECTION_MODES.REMOTE) {
    if (!settings.remoteUrl) throw new Error('Backend URL is required for a remote connection');
    if (!settings.remoteAuthToken) throw new Error('Backend access token is required for a remote connection');
  }
  if (settings.connectionMode !== CONNECTION_MODES.REMOTE && !String(settings.sqlitePath || '').trim()) {
    throw new Error('SQLite database path is required');
  }
  return settings;
}
