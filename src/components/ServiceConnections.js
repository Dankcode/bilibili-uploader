'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  Database,
  HardDrive,
  KeyRound,
  Laptop,
  LoaderCircle,
  Network,
  RefreshCw,
  Save,
  Server,
  ShieldCheck,
  TestTube2,
  WifiOff,
} from 'lucide-react';
import styles from '../app/page.module.css';

const ROLE_LABELS = {
  source: 'Sources',
  processor: 'Processors',
  uploader: 'Uploaders',
  notifier: 'Notifications',
};

const CONNECTION_MODES = [
  { id: 'server', label: 'Server SQLite', detail: 'Database beside the backend', icon: Server },
  { id: 'local', label: 'This machine', detail: 'Custom SQLite path', icon: Laptop },
  { id: 'remote', label: 'Tailscale / LAN', detail: 'Connect to another backend', icon: Network },
];

const EMPTY_RUNTIME = {
  connectionMode: 'server',
  sqlitePath: 'config/bilibili.db',
  remoteTransport: 'tailscale',
  remoteUrl: '',
  remoteAuthToken: '',
  serverApiToken: '',
  workerEnabled: true,
  workerPollSeconds: 5,
  schedulerPollSeconds: 60,
};

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function generateToken() {
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function runtimeDatabase(status) {
  return status?.database || status?.remote?.database || null;
}

function runtimeWorker(status) {
  return status?.remote?.worker || runtimeDatabase(status)?.workers?.find((worker) => worker.online) || null;
}

function fieldLabel(field) {
  return `${field.label}${field.required === false && !/\(optional\)/i.test(field.label) ? ' (optional)' : ''}`;
}

function connectionHealthLabel(row) {
  const checked = row.checkedAt ? ` / checked ${new Date(row.checkedAt).toLocaleString()}` : ' / not checked yet';
  return `${row.configured ? 'Configured' : 'Needs config'} / ${row.status || 'untested'} / auth: ${row.authState || 'unknown'}${checked}`;
}

function validateField(field, value) {
  const text = String(value ?? '').trim();
  if (!text) return field.required === false ? '' : `${field.label} is required.`;
  try {
    if (field.pattern && !(new RegExp(field.pattern)).test(text)) return field.hint || `${field.label} has an invalid format.`;
  } catch {
    return 'This field has an invalid validation rule.';
  }
  return '';
}

export default function ServiceConnections({ section = 'accounts' }) {
  const [rows, setRows] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [fieldErrors, setFieldErrors] = useState({});
  const [serviceStatus, setServiceStatus] = useState('');
  const [runtimeForm, setRuntimeForm] = useState(EMPTY_RUNTIME);
  const [runtimeSaved, setRuntimeSaved] = useState({});
  const [runtimeStatus, setRuntimeStatus] = useState(null);
  const [runtimeMessage, setRuntimeMessage] = useState(null);
  const [runtimeBusy, setRuntimeBusy] = useState('');
  const [youtubeAuthorizations, setYoutubeAuthorizations] = useState([]);
  const [youtubeAuthorizationDraft, setYoutubeAuthorizationDraft] = useState({
    emailAddress: '',
    channelId: '',
    channelTitle: '',
    credentialRef: '',
  });
  const [youtubeAuthorizationMessage, setYoutubeAuthorizationMessage] = useState(null);
  const [youtubeAuthorizationBusy, setYoutubeAuthorizationBusy] = useState('');
  const [bilibiliLoginMessage, setBilibiliLoginMessage] = useState(null);
  const [bilibiliLoginBusy, setBilibiliLoginBusy] = useState('');
  const [youtubeLoginCredentialRef, setYoutubeLoginCredentialRef] = useState('youtube-ops');
  const [youtubeLoginClientRef, setYoutubeLoginClientRef] = useState('youtube');
  const [youtubeLoginEmail, setYoutubeLoginEmail] = useState('');
  const [youtubeLoginMessage, setYoutubeLoginMessage] = useState(null);
  const [youtubeLoginStatus, setYoutubeLoginStatus] = useState(null);
  const [youtubeLoginBusy, setYoutubeLoginBusy] = useState('');
  const [youtubeClientStatus, setYoutubeClientStatus] = useState(null);
  const [youtubeClientBusy, setYoutubeClientBusy] = useState(false);

  const activeYoutubeCredentialRef = youtubeLoginStatus?.credentialRef || youtubeLoginCredentialRef;

  const loadRows = async () => {
    const response = await fetch('/api/control/settings/connections', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load service connections');
    const checklist = data.checklist || [];
    setRows(checklist);
    setDrafts((previous) => {
      const next = { ...previous };
      for (const row of checklist) {
        next[row.id] = { ...(next[row.id] || {}) };
        for (const field of row.credentialFields || []) {
          if (field.type !== 'secret' && next[row.id][field.key] === undefined && row.defaults?.[field.key] !== undefined) {
            next[row.id][field.key] = row.defaults[field.key];
          }
        }
      }
      return next;
    });
  };

  const loadRuntime = async () => {
    const response = await fetch('/api/runtime/settings', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load runtime settings');
    const settings = data.settings || EMPTY_RUNTIME;
    setRuntimeSaved(settings);
    setRuntimeForm({ ...EMPTY_RUNTIME, ...settings, remoteAuthToken: '', serverApiToken: '' });
    setRuntimeStatus(data.status || null);
  };

  const loadYoutubeAuthorizations = async () => {
    const response = await fetch('/api/control/operations/youtube-authorizations', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load YouTube authorizations');
    setYoutubeAuthorizations(data.authorizations || []);
  };

  const loadYoutubeClient = async () => {
    const response = await fetch('/api/control/settings/youtube-client', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load Google OAuth client status');
    setYoutubeClientStatus(data.client || null);
  };

  useEffect(() => {
    Promise.all([loadRows(), loadRuntime(), loadYoutubeAuthorizations(), loadYoutubeClient()]).catch((error) => {
      setRuntimeMessage({ tone: 'error', text: error.message });
    });
  }, []);

  useEffect(() => {
    if (section !== 'accounts') return undefined;
    const params = new URLSearchParams(window.location.search);
    const state = params.get('state');
    const code = params.get('code');
    const oauthError = params.get('error');
    if (!state || (!code && !oauthError)) return undefined;
    let cancelled = false;
    setYoutubeLoginBusy('youtube-login-callback');
    setYoutubeLoginMessage({ tone: 'info', text: 'Finishing Google sign-in…' });
    fetch('/api/control/settings/youtube-oauth/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state, code, error: oauthError }),
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not complete Google sign-in');
        return data.youtubeAuthorization;
      })
      .then(async (status) => {
        if (cancelled) return;
        setYoutubeLoginStatus(status);
        setYoutubeLoginMessage({ tone: status.state === 'error' ? 'error' : 'info', text: status.message });
        if (status.state === 'connected') await loadYoutubeAuthorizations();
      })
      .catch((error) => {
        if (!cancelled) setYoutubeLoginMessage({ tone: 'error', text: error.message });
      })
      .finally(() => {
        if (!cancelled) setYoutubeLoginBusy('');
      });
    window.history.replaceState({}, '', window.location.pathname);
    return () => { cancelled = true; };
  }, [section]);

  // Advance from the native Google browser window to channel confirmation
  // without making the operator manually press "Check sign-in".
  useEffect(() => {
    if (youtubeLoginStatus?.state !== 'waiting' || !youtubeLoginStatus?.credentialRef) return undefined;
    const timer = window.setInterval(() => { runYoutubeLogin('youtube-login-status'); }, 2000);
    return () => window.clearInterval(timer);
  }, [youtubeLoginStatus?.state, youtubeLoginStatus?.credentialRef]);

  const grouped = useMemo(() => rows.reduce((acc, row) => {
    const key = row.role || 'other';
    acc[key] = acc[key] || [];
    acc[key].push(row);
    return acc;
  }, {}), [rows]);
  const configurableGroups = useMemo(() => Object.fromEntries(
    Object.entries(grouped)
      .map(([role, services]) => [role, services.filter((row) => row.id === 'gmail' || row.credentialFields?.length)])
      .filter(([, services]) => services.length),
  ), [grouped]);

  const database = runtimeDatabase(runtimeStatus);
  const worker = runtimeWorker(runtimeStatus);
  const runtimeOnline = runtimeStatus?.connection === 'online';

  const updateRuntime = (key, value) => {
    setRuntimeForm((previous) => ({ ...previous, [key]: value }));
    setRuntimeMessage(null);
  };

  const runRuntimeAction = async (action) => {
    setRuntimeBusy(action);
    setRuntimeMessage(null);
    try {
      const response = await fetch('/api/runtime/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, settings: runtimeForm }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Could not ${action} connection`);
      if (action === 'save') {
        const settings = data.settings || {};
        setRuntimeSaved(settings);
        setRuntimeForm((previous) => ({ ...previous, ...settings, remoteAuthToken: '', serverApiToken: '' }));
        setRuntimeStatus(data.status || null);
        if (data.status?.connection === 'online') await loadRows();
        else setRows([]);
      }
      setRuntimeMessage({
        tone: action === 'save' && data.status?.connection === 'offline' ? 'error' : 'ok',
        text: action === 'save'
          ? (data.status?.connection === 'offline' ? `Settings saved; ${data.status.error || 'backend is offline'}` : 'Connection settings saved')
          : 'Connection test passed',
      });
    } catch (error) {
      setRuntimeMessage({ tone: 'error', text: error.message });
    } finally {
      setRuntimeBusy('');
    }
  };

  const updateDraft = (serviceId, key, value) => {
    setDrafts((previous) => ({
      ...previous,
      [serviceId]: { ...(previous[serviceId] || {}), [key]: value },
    }));
  };

  const validateDraftField = (serviceId, field, value = drafts[serviceId]?.[field.key]) => {
    const message = validateField(field, value);
    setFieldErrors((previous) => ({
      ...previous,
      [serviceId]: { ...(previous[serviceId] || {}), [field.key]: message },
    }));
    return message;
  };

  const draftCredentials = (row) => {
    const credentials = {};
    for (const field of row.credentialFields || []) {
      const value = drafts[row.id]?.[field.key];
      if (field.type === 'secret' && !value) continue;
      if (value !== undefined) credentials[field.key] = value;
    }
    return credentials;
  };

  const validateServiceDraft = (row) => (row.credentialFields || []).map((field) => {
    const value = drafts[row.id]?.[field.key];
    // Secrets are intentionally never returned to the browser. A configured
    // service may therefore test its saved secret without displaying it again.
    if (row.configured && !String(value ?? '').trim()) return '';
    return validateDraftField(row.id, field, value);
  }).filter(Boolean);

  const postServiceAction = async (body) => {
    setServiceStatus(body.action === 'test' ? 'Testing...' : 'Saving...');
    try {
      const response = await fetch('/api/control/settings/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Connection action failed');
      setServiceStatus('Updated');
      await loadRows();
    } catch (error) {
      setServiceStatus(error.message);
    }
  };

  const startGmailAuthorization = async () => {
    setServiceStatus('Opening Google authorization…');
    try {
      const response = await fetch('/api/control/mail/oauth/start', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not start Gmail authorization');
      window.location.assign(data.url);
    } catch (error) { setServiceStatus(error.message); }
  };

  const saveService = (row) => {
    const errors = validateServiceDraft(row);
    if (errors.length) {
      setServiceStatus(errors[0]);
      return;
    }
    postServiceAction({ action: 'save', serviceId: row.id, credentials: draftCredentials(row) });
  };

  const testService = (row) => {
    const errors = validateServiceDraft(row);
    if (errors.length) {
      setServiceStatus(errors[0]);
      return;
    }
    postServiceAction({ action: 'test', serviceId: row.id, credentials: draftCredentials(row) });
  };

  const runBilibiliLogin = async (action) => {
    setBilibiliLoginBusy(action);
    setBilibiliLoginMessage(null);
    try {
      const response = await fetch('/api/control/settings/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not open Bilibili login');
      const status = data.bilibiliLogin;
      setBilibiliLoginMessage({ tone: status.authenticated ? 'ok' : 'info', text: status.message });
      await loadRows();
    } catch (error) {
      setBilibiliLoginMessage({ tone: 'error', text: error.message });
    } finally {
      setBilibiliLoginBusy('');
    }
  };

  const saveYoutubeClient = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setYoutubeClientBusy(true);
    setYoutubeLoginMessage(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const response = await fetch('/api/control/settings/youtube-client', { method: 'POST', body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not save Google OAuth client configuration');
      setYoutubeClientStatus(data.client || null);
      setYoutubeLoginMessage({ tone: 'ok', text: data.client?.flow === 'web-server' ? 'Google web client saved locally. You can now connect a Google account.' : 'Google Desktop client saved locally. You can now connect a Google account.' });
    } catch (error) {
      setYoutubeLoginMessage({ tone: 'error', text: error.message });
    } finally {
      setYoutubeClientBusy(false);
    }
  };

  const runYoutubeLogin = async (action, channelId = '') => {
    const credentialRef = activeYoutubeCredentialRef.trim();
    const expectedEmail = youtubeLoginEmail.trim();
    if (action !== 'youtube-login-start-default' && !credentialRef) {
      setYoutubeLoginMessage({ tone: 'error', text: 'Enter a local OAuth credential reference first.' });
      return;
    }
    setYoutubeLoginBusy(action);
    setYoutubeLoginMessage(null);
    try {
      const response = await fetch('/api/control/settings/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, credentialRef, clientRef: youtubeLoginClientRef.trim(), expectedEmail, channelId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not open Google/YouTube sign-in');
      const status = data.youtubeAuthorization;
      setYoutubeLoginStatus(status);
      setYoutubeLoginMessage({ tone: status.state === 'error' ? 'error' : (status.state === 'connected' ? 'ok' : 'info'), text: status.message });
      if (status.authorizationUrl) {
        window.location.assign(status.authorizationUrl);
        return;
      }
      if (status.state === 'connected') await loadYoutubeAuthorizations();
    } catch (error) {
      setYoutubeLoginMessage({ tone: 'error', text: error.message });
    } finally {
      setYoutubeLoginBusy('');
    }
  };

  const confirmYoutubeLogin = async (channelId) => {
    await runYoutubeLogin('youtube-login-confirm', channelId);
  };

  const registerYoutubeAuthorization = async (event) => {
    event.preventDefault();
    setYoutubeAuthorizationBusy('register');
    setYoutubeAuthorizationMessage(null);
    try {
      const response = await fetch('/api/control/operations/youtube-authorizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(youtubeAuthorizationDraft),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not register YouTube authorization');
      setYoutubeAuthorizationDraft({ emailAddress: '', channelId: '', channelTitle: '', credentialRef: '' });
      setYoutubeAuthorizationMessage({ tone: 'ok', text: 'Authorized account registered for upload tracking.' });
      await loadYoutubeAuthorizations();
    } catch (error) {
      setYoutubeAuthorizationMessage({ tone: 'error', text: error.message });
    } finally {
      setYoutubeAuthorizationBusy('');
    }
  };

  const setYoutubeAuthorizationEnabled = async (authorization, enabled) => {
    setYoutubeAuthorizationBusy(authorization.id);
    setYoutubeAuthorizationMessage(null);
    try {
      const response = await fetch('/api/control/operations/youtube-authorizations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: authorization.id, enabled }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not update YouTube authorization');
      await loadYoutubeAuthorizations();
    } catch (error) {
      setYoutubeAuthorizationMessage({ tone: 'error', text: error.message });
    } finally {
      setYoutubeAuthorizationBusy('');
    }
  };

  return (
    <div className={styles.settingsWorkspace}>
      <section className={styles.runtimeSection} hidden={section !== 'runtime'}>
        <header className={styles.settingsSectionHeader}>
          <div>
            <span className={styles.settingsEyebrow}>Data plane</span>
            <h2>Database & API runtime</h2>
            <span className={styles.connectionMeta}>Keep SQLite beside the worker. Use the remote option only for an authenticated backend reachable over LAN or Tailscale.</span>
          </div>
          <div className={`${styles.runtimeBadge} ${runtimeOnline ? styles.runtimeBadgeOnline : styles.runtimeBadgeOffline}`}>
            {runtimeOnline ? <CheckCircle2 size={14} /> : <WifiOff size={14} />}
            {runtimeOnline ? 'Connected' : 'Offline'}
          </div>
        </header>

        <div className={styles.connectionModes} role="tablist" aria-label="Runtime connection method">
          {CONNECTION_MODES.map(({ id, label, detail, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={runtimeForm.connectionMode === id}
              className={runtimeForm.connectionMode === id ? styles.connectionModeActive : ''}
              onClick={() => updateRuntime('connectionMode', id)}
            >
              <Icon size={18} />
              <span><strong>{label}</strong><small>{detail}</small></span>
            </button>
          ))}
        </div>

        <div className={styles.runtimeForm}>
          {runtimeForm.connectionMode !== 'remote' ? (
            <>
              <label className={styles.settingsFieldWide}>
                <span><Database size={14} />SQLite database path</span>
                <input
                  className={styles.input}
                  value={runtimeForm.sqlitePath}
                  onChange={(event) => updateRuntime('sqlitePath', event.target.value)}
                  placeholder={runtimeForm.connectionMode === 'local' ? '/Users/name/video-ops/bilibili.db' : 'config/bilibili.db'}
                  spellCheck="false"
                />
              </label>
              <label className={styles.settingsFieldWide}>
                <span><ShieldCheck size={14} />Backend access token</span>
                <div className={styles.secretInputRow}>
                  <input
                    className={styles.input}
                    type="password"
                    value={runtimeForm.serverApiToken}
                    onChange={(event) => updateRuntime('serverApiToken', event.target.value)}
                    placeholder={runtimeSaved.hasServerApiToken ? 'Saved token (leave blank to keep)' : 'Required for Tailscale or LAN access'}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className={styles.iconButton}
                    onClick={() => updateRuntime('serverApiToken', generateToken())}
                    title="Generate access token"
                    aria-label="Generate access token"
                  ><KeyRound size={16} /></button>
                </div>
              </label>
              <label className={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={Boolean(runtimeForm.workerEnabled)}
                  onChange={(event) => updateRuntime('workerEnabled', event.target.checked)}
                />
                Run processing and upload worker
              </label>
              <label className={styles.settingsField}>
                <span>Queue poll (seconds)</span>
                <input
                  className={styles.input}
                  type="number"
                  min="1"
                  max="300"
                  value={runtimeForm.workerPollSeconds}
                  onChange={(event) => updateRuntime('workerPollSeconds', event.target.value)}
                />
              </label>
              <label className={styles.settingsField}>
                <span>Schedule poll (seconds)</span>
                <input
                  className={styles.input}
                  type="number"
                  min="5"
                  max="3600"
                  value={runtimeForm.schedulerPollSeconds}
                  onChange={(event) => updateRuntime('schedulerPollSeconds', event.target.value)}
                />
              </label>
            </>
          ) : (
            <>
              <label className={styles.settingsField}>
                <span><Network size={14} />Transport</span>
                <select className={styles.select} value={runtimeForm.remoteTransport} onChange={(event) => updateRuntime('remoteTransport', event.target.value)}>
                  <option value="tailscale">Tailscale</option>
                  <option value="lan">Local network</option>
                </select>
              </label>
              <label className={styles.settingsFieldWide}>
                <span><Server size={14} />Backend URL</span>
                <input
                  className={styles.input}
                  type="url"
                  value={runtimeForm.remoteUrl}
                  onChange={(event) => updateRuntime('remoteUrl', event.target.value)}
                  placeholder={runtimeForm.remoteTransport === 'tailscale' ? 'http://100.x.x.x:4455' : 'http://192.168.1.20:4455'}
                  spellCheck="false"
                />
              </label>
              <label className={styles.settingsFieldWide}>
                <span><ShieldCheck size={14} />Backend access token</span>
                <input
                  className={styles.input}
                  type="password"
                  value={runtimeForm.remoteAuthToken}
                  onChange={(event) => updateRuntime('remoteAuthToken', event.target.value)}
                  placeholder={runtimeSaved.hasRemoteAuthToken ? 'Saved token (leave blank to keep)' : 'Access token from the backend machine'}
                  autoComplete="new-password"
                />
              </label>
            </>
          )}
        </div>

        <div className={styles.runtimeStatusGrid}>
          <div><HardDrive size={15} /><span>Database<strong title={database?.path || ''}>{database?.path || 'Unavailable'}</strong></span></div>
          <div><Database size={15} /><span>Storage<strong>{database ? formatBytes(database.bytes) : '--'}</strong></span></div>
          <div><RefreshCw size={15} /><span>Worker<strong>{worker?.status === 'paused' ? 'Paused' : worker?.online ? `${worker.host || 'server'} online` : 'Not running'}</strong></span></div>
        </div>

        <footer className={styles.runtimeActions}>
          <div className={runtimeMessage?.tone === 'error' ? styles.settingsMessageError : styles.settingsMessageOk} role="status">
            {runtimeMessage?.text || runtimeStatus?.error || ''}
          </div>
          <button type="button" className={styles.buttonSecondary} disabled={Boolean(runtimeBusy)} onClick={() => runRuntimeAction('test')}>
            {runtimeBusy === 'test' ? <LoaderCircle className={styles.spin} size={15} /> : <TestTube2 size={15} />} Test
          </button>
          <button type="button" className={styles.buttonPrimary} disabled={Boolean(runtimeBusy)} onClick={() => runRuntimeAction('save')}>
            {runtimeBusy === 'save' ? <LoaderCircle className={styles.spin} size={15} /> : <Save size={15} />} Save settings
          </button>
        </footer>
      </section>

      <section className={styles.serviceSection} hidden={section !== 'accounts'}>
        <header className={styles.settingsSectionHeader}>
          <div>
            <span className={styles.settingsEyebrow}>Required accounts</span>
            <h2>Sign in for automated delivery</h2>
          </div>
          <span className={styles.connectionMeta}>Browser sign-in only</span>
        </header>
        <div className={styles.connectionList}>
          <div className={styles.connectionRow}>
            <div className={styles.connectionDetails}>
              <strong>Bilibili source</strong>
              <span className={styles.connectionMeta}>Sign in in the visible Playwright window. SESSDATA stays in the local browser storage file and is never shown in Settings.</span>
              {bilibiliLoginMessage && (
                <div className={bilibiliLoginMessage.tone === 'error' ? styles.settingsMessageError : styles.settingsMessageOk} role="status">
                  {bilibiliLoginMessage.text}
                </div>
              )}
              <div className={styles.operationRow}>
                <button className={styles.buttonSecondary} type="button" disabled={Boolean(bilibiliLoginBusy)} onClick={() => runBilibiliLogin('bilibili-login-start')}>
                  {bilibiliLoginBusy === 'bilibili-login-start' ? <LoaderCircle className={styles.spin} size={14} /> : <KeyRound size={14} />} Open Bilibili login
                </button>
                <button className={styles.buttonSecondary} type="button" disabled={Boolean(bilibiliLoginBusy)} onClick={() => runBilibiliLogin('bilibili-login-status')}>
                  {bilibiliLoginBusy === 'bilibili-login-status' ? <LoaderCircle className={styles.spin} size={14} /> : <RefreshCw size={14} />} Check sign-in
                </button>
              </div>
            </div>
          </div>
          <div className={styles.connectionRow}>
            <div className={styles.connectionDetails}>
              <strong>Google / YouTube upload</strong>
              <span className={styles.connectionMeta}>Connect once with Google, choose the returned channel, and the app saves its local token as <code>youtube-&lt;channel-id&gt;_token.json</code>. Tokens are never displayed or sent to the browser.</span>
              <label className={styles.settingsField}>
                <span>Google OAuth client JSON</span>
                <input className={styles.input} type="file" accept="application/json,.json" disabled={youtubeClientBusy} onChange={saveYoutubeClient} />
                <small className={styles.connectionMeta}>{youtubeClientBusy ? 'Saving client configuration…' : youtubeClientStatus?.configured ? (youtubeClientStatus.flow === 'web-server' ? 'Web client configured for the local Google callback.' : 'Desktop client configured locally.') : 'Select a Google Desktop client, or a Web client authorized for http://localhost:4455/.'}</small>
              </label>
              <label className={styles.settingsField}>
                <span>Google account email (optional check)</span>
                <input className={styles.input} type="email" value={youtubeLoginEmail} onChange={(event) => setYoutubeLoginEmail(event.target.value)} placeholder="name@gmail.com" autoComplete="username" />
              </label>
              {youtubeLoginMessage && (
                <div className={youtubeLoginMessage.tone === 'error' ? styles.settingsMessageError : styles.settingsMessageOk} role="status">
                  {youtubeLoginMessage.text}
                </div>
              )}
              <div className={styles.operationRow}>
                <button className={styles.buttonPrimary} type="button" disabled={Boolean(youtubeLoginBusy) || youtubeClientBusy || !youtubeClientStatus?.configured || youtubeLoginStatus?.state === 'waiting'} onClick={() => runYoutubeLogin('youtube-login-start-default')}>
                  {youtubeLoginBusy === 'youtube-login-start-default' ? <LoaderCircle className={styles.spin} size={14} /> : <KeyRound size={14} />} Connect Google account
                </button>
                {youtubeLoginStatus?.state === 'waiting' && <button className={styles.buttonSecondary} type="button" disabled={Boolean(youtubeLoginBusy)} onClick={() => runYoutubeLogin('youtube-login-status')}>
                  {youtubeLoginBusy === 'youtube-login-status' ? <LoaderCircle className={styles.spin} size={14} /> : <RefreshCw size={14} />} Check sign-in
                </button>}
              </div>
              {youtubeLoginStatus?.state === 'confirm' && <div className={styles.operationRow}>
                <span className={styles.connectionMeta}>Confirm the channel that will receive uploads:</span>
                {youtubeLoginStatus.candidate?.channels?.map((channel) => <button key={channel.channelId} className={styles.buttonPrimary} type="button" disabled={Boolean(youtubeLoginBusy)} onClick={() => confirmYoutubeLogin(channel.channelId)}>{channel.channelTitle || channel.channelId}{channel.longUploadsStatus !== 'allowed' ? ' · 15 min limit' : ''}</button>)}
              </div>}
              <details>
                <summary>Use a different local OAuth client</summary>
                <label className={styles.settingsField}><span>OAuth client reference</span><input className={styles.input} value={youtubeLoginClientRef} onChange={(event) => setYoutubeLoginClientRef(event.target.value)} placeholder="youtube" autoComplete="off" /></label>
                <label className={styles.settingsField}><span>Per-channel token reference</span><input className={styles.input} value={youtubeLoginCredentialRef} onChange={(event) => setYoutubeLoginCredentialRef(event.target.value)} placeholder="youtube-channel" autoComplete="off" /></label>
                <button className={styles.buttonSecondary} type="button" disabled={Boolean(youtubeLoginBusy)} onClick={() => runYoutubeLogin('youtube-login-start')}>Open custom Google sign-in</button>
              </details>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.serviceSection} hidden={section !== 'accounts'}>
        <header className={styles.settingsSectionHeader}>
          <div>
            <span className={styles.settingsEyebrow}>Publishing identity</span>
            <h2>Authorized YouTube accounts</h2>
          </div>
          <span className={styles.globalStatus}>{youtubeAuthorizations.length} registered</span>
        </header>

        <details className={styles.connectionRow}>
          <summary className={styles.connectionSummary}><div><strong>Manual existing-token registration</strong><span className={styles.connectionMeta}>Only for a pre-existing local OAuth token; normal setup above creates this automatically.</span></div><ChevronDown size={16} /></summary>
          <form className={styles.runtimeForm} onSubmit={registerYoutubeAuthorization}>
          <label className={styles.settingsField}>
            <span>Google account email</span>
            <input className={styles.input} type="email" required value={youtubeAuthorizationDraft.emailAddress}
              onChange={(event) => setYoutubeAuthorizationDraft((current) => ({ ...current, emailAddress: event.target.value }))}
              placeholder="owner@example.com" autoComplete="off" />
          </label>
          <label className={styles.settingsField}>
            <span>YouTube channel ID</span>
            <input className={styles.input} required value={youtubeAuthorizationDraft.channelId}
              onChange={(event) => setYoutubeAuthorizationDraft((current) => ({ ...current, channelId: event.target.value }))}
              placeholder="UC…" autoComplete="off" />
          </label>
          <label className={styles.settingsField}>
            <span>Channel title</span>
            <input className={styles.input} value={youtubeAuthorizationDraft.channelTitle}
              onChange={(event) => setYoutubeAuthorizationDraft((current) => ({ ...current, channelTitle: event.target.value }))}
              placeholder="Operations channel" autoComplete="off" />
          </label>
          <label className={styles.settingsField}>
            <span>OAuth credential reference</span>
            <input className={styles.input} required value={youtubeAuthorizationDraft.credentialRef}
              onChange={(event) => setYoutubeAuthorizationDraft((current) => ({ ...current, credentialRef: event.target.value }))}
              placeholder="youtube-ops" autoComplete="off" />
          </label>
          <div className={styles.operationRow}>
            <span className={styles.connectionMeta}>References local OAuth files only. Passwords, cookies, SMS codes, and tokens are never accepted here.</span>
            <button className={styles.buttonPrimary} type="submit" disabled={Boolean(youtubeAuthorizationBusy)}>
              {youtubeAuthorizationBusy === 'register' ? <LoaderCircle className={styles.spin} size={14} /> : <KeyRound size={14} />} Register account
            </button>
          </div>
          </form>
        </details>

        {youtubeAuthorizationMessage && (
          <div className={youtubeAuthorizationMessage.tone === 'error' ? styles.settingsMessageError : styles.settingsMessageOk} role="status">
            {youtubeAuthorizationMessage.text}
          </div>
        )}
        <div className={styles.connectionList}>
          {!youtubeAuthorizations.length && <small className={styles.connectionMeta}>No channel is authorized yet. Complete the Google steps above; the selected channel will appear here automatically.</small>}
          {youtubeAuthorizations.map((authorization) => (
            <div key={authorization.id} className={styles.connectionRow}>
              <div className={styles.connectionDetails}>
                <div className={styles.connectionSummary}>
                  <div>
                    <strong>{authorization.channelTitle || authorization.channelId}</strong>
                    <span className={styles.connectionMeta}>{authorization.emailAddress} / {authorization.status} / {authorization.publicationCount} publications</span>
                  </div>
                  <label className={styles.checkRow}>
                    <input type="checkbox" checked={authorization.enabled}
                      disabled={youtubeAuthorizationBusy === authorization.id}
                      onChange={(event) => setYoutubeAuthorizationEnabled(authorization, event.target.checked)} />
                    Enabled
                  </label>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.serviceSection} hidden={section !== 'accounts'}>
        <header className={styles.settingsSectionHeader}>
          <div>
            <span className={styles.settingsEyebrow}>Advanced</span>
            <h2>Provider configuration</h2>
          </div>
          {serviceStatus && <span className={styles.globalStatus}>{serviceStatus}</span>}
        </header>
        <div className={styles.serviceGroups}>
          {Object.entries(configurableGroups).map(([role, services]) => (
            <div key={role} className={styles.connectionGroup}>
              <h3>{ROLE_LABELS[role] || role}</h3>
              <div className={styles.connectionList}>
                {services.map((row) => (
                  <details key={row.id} className={styles.connectionRow}>
                    <summary className={styles.connectionSummary}>
                      <div>
                        <strong>{row.label}</strong>
                        <span className={styles.connectionMeta}>
                          {connectionHealthLabel(row)}
                        </span>
                      </div>
                      <ChevronDown size={16} />
                    </summary>
                    <div className={styles.connectionDetails}>
                      <label className={styles.checkRow}>
                        <input
                          type="checkbox"
                          checked={Boolean(row.enabled)}
                          disabled={row.status !== 'ok'}
                          onChange={(event) => postServiceAction({ action: 'enable', serviceId: row.id, enabled: event.target.checked })}
                        />
                        Enabled
                      </label>
                      {!!row.credentialFields?.length && (
                        <div className={styles.formGrid}>
                          {row.credentialFields.map((field) => (
                            <label key={field.key} className={styles.settingsField}>
                              <span>{fieldLabel(field)}</span>
                              <input
                                className={styles.input}
                                type={field.type === 'secret' ? 'password' : 'text'}
                                placeholder={field.type === 'secret' && row.configured ? 'Saved value' : (field.placeholder || field.label)}
                                value={drafts[row.id]?.[field.key] || ''}
                                onChange={(event) => {
                                  updateDraft(row.id, field.key, event.target.value);
                                  if (fieldErrors[row.id]?.[field.key]) validateDraftField(row.id, field, event.target.value);
                                }}
                                onBlur={(event) => {
                                  if (!(row.configured && !event.target.value.trim())) validateDraftField(row.id, field, event.target.value);
                                }}
                                autoComplete={field.type === 'secret' ? 'new-password' : 'off'}
                              />
                              {field.example && <small className={styles.connectionMeta}>Example: <code>{field.example}</code></small>}
                              {fieldErrors[row.id]?.[field.key] && <small className={styles.errorText}>{fieldErrors[row.id][field.key]}</small>}
                            </label>
                          ))}
                        </div>
                      )}
                      {row.lastError && <div className={styles.errorText}>{row.lastError}</div>}
                      <div className={styles.operationRow}>
                        {row.id === 'gmail' && <button className={styles.buttonSecondary} type="button" onClick={startGmailAuthorization}><KeyRound size={14} /> Authorize with Google</button>}
                        {!!row.credentialFields?.length && <button className={styles.buttonPrimary} type="button" onClick={() => testService(row)}><TestTube2 size={14} /> Test connection</button>}
                        {!!row.credentialFields?.length && <button className={styles.buttonSecondary} type="button" onClick={() => saveService(row)}><Save size={14} /> Save</button>}
                      </div>
                    </div>
                  </details>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
