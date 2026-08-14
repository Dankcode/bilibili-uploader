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

export default function ServiceConnections() {
  const [rows, setRows] = useState([]);
  const [drafts, setDrafts] = useState({});
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

  useEffect(() => {
    Promise.all([loadRows(), loadRuntime(), loadYoutubeAuthorizations()]).catch((error) => {
      setRuntimeMessage({ tone: 'error', text: error.message });
    });
  }, []);

  const grouped = useMemo(() => rows.reduce((acc, row) => {
    const key = row.role || 'other';
    acc[key] = acc[key] || [];
    acc[key].push(row);
    return acc;
  }, {}), [rows]);

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

  const saveService = (row) => {
    const credentials = {};
    for (const field of row.credentialFields || []) {
      const value = drafts[row.id]?.[field.key];
      if (field.type === 'secret' && !value) continue;
      if (value !== undefined) credentials[field.key] = value;
    }
    postServiceAction({ action: 'save', serviceId: row.id, credentials });
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
      <section className={styles.runtimeSection}>
        <header className={styles.settingsSectionHeader}>
          <div>
            <span className={styles.settingsEyebrow}>Data plane</span>
            <h2>Runtime connection</h2>
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

      <section className={styles.serviceSection}>
        <header className={styles.settingsSectionHeader}>
          <div>
            <span className={styles.settingsEyebrow}>Publishing identity</span>
            <h2>Authorized YouTube accounts</h2>
          </div>
          <span className={styles.globalStatus}>{youtubeAuthorizations.length} registered</span>
        </header>

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

        {youtubeAuthorizationMessage && (
          <div className={youtubeAuthorizationMessage.tone === 'error' ? styles.settingsMessageError : styles.settingsMessageOk} role="status">
            {youtubeAuthorizationMessage.text}
          </div>
        )}
        <div className={styles.connectionList}>
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

      <section className={styles.serviceSection}>
        <header className={styles.settingsSectionHeader}>
          <div>
            <span className={styles.settingsEyebrow}>Adapters</span>
            <h2>Service connections</h2>
          </div>
          {serviceStatus && <span className={styles.globalStatus}>{serviceStatus}</span>}
        </header>
        <div className={styles.serviceGroups}>
          {Object.entries(grouped).map(([role, services]) => (
            <div key={role} className={styles.connectionGroup}>
              <h3>{ROLE_LABELS[role] || role}</h3>
              <div className={styles.connectionList}>
                {services.map((row) => (
                  <details key={row.id} className={styles.connectionRow}>
                    <summary className={styles.connectionSummary}>
                      <div>
                        <strong>{row.label}</strong>
                        <span className={styles.connectionMeta}>
                          {row.configured ? 'Configured' : 'Needs config'} / {row.status || 'untested'}
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
                                onChange={(event) => updateDraft(row.id, field.key, event.target.value)}
                                autoComplete={field.type === 'secret' ? 'new-password' : 'off'}
                              />
                            </label>
                          ))}
                        </div>
                      )}
                      {row.lastError && <div className={styles.errorText}>{row.lastError}</div>}
                      <div className={styles.operationRow}>
                        <button className={styles.buttonSecondary} type="button" onClick={() => postServiceAction({ action: 'test', serviceId: row.id })}><TestTube2 size={14} /> Test</button>
                        <button className={styles.buttonPrimary} type="button" onClick={() => saveService(row)}><Save size={14} /> Save</button>
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
