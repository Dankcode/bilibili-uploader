'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import styles from '../../app/page.module.css';

const PROCESSORS = [['videoEditor', 'Video Editor MCP'], ['metadata', 'Marketing metadata']];

function localTime(value) {
  return value ? String(value).slice(0, 16) : '';
}

export default function ProcessEditor({ job, onClose, onSaved }) {
  const [processorIds, setProcessorIds] = useState(job.processorIds || []);
  const [publish, setPublish] = useState(job.uploaderId === 'youtube');
  // Each queued upload already carries its account: Studio uploads go to the
  // channel signed in on the upload machine (no OAuth binding exists for them),
  // API uploads to the channel bound when the job was queued. The editor shows
  // that account instead of forcing a choice from a list that may be empty.
  const [uploadMethod, setUploadMethod] = useState(job.options?.youtube?.uploadMethod || (job.youtubeAuthorization?.id ? 'api' : 'studio'));
  const [authorizationId, setAuthorizationId] = useState(job.youtubeAuthorization?.id || '');
  const [priority, setPriority] = useState(job.priority || 0);
  const [scheduledFor, setScheduledFor] = useState(localTime(job.scheduledFor));
  const [authorizations, setAuthorizations] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/control/operations/youtube-authorizations', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('Could not load YouTube channels.')))
      .then((payload) => setAuthorizations(payload.authorizations || []))
      .catch((loadError) => setError(loadError.message));
  }, []);

  const usable = authorizations.filter((item) => item.enabled && ['configured', 'active'].includes(item.status));
  const needsChannel = publish && uploadMethod === 'api';
  // Keep the job's own channel; with exactly one usable channel, use it.
  useEffect(() => {
    if (needsChannel && !authorizationId && usable.length === 1) setAuthorizationId(usable[0].id);
  }, [needsChannel, authorizationId, usable.length]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleProcessor(id) {
    setProcessorIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  async function save(event) {
    event.preventDefault();
    setError('');
    if (needsChannel && !authorizationId) return setError(usable.length ? 'Choose the YouTube channel for this API upload.' : 'No authorized channel for API uploads. Use YouTube Studio (the signed-in browser on the upload machine) instead.');
    setSaving(true);
    try {
      const response = await fetch('/api/control/pipeline/jobs', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(job.updatedAt ? { 'If-Match': job.updatedAt } : {}) },
        body: JSON.stringify({
          action: 'update', jobId: job.id,
          patch: {
            processorIds,
            uploaderId: publish ? 'youtube' : '',
            youtubeAuthorizationId: needsChannel ? authorizationId : '',
            ...(publish ? { options: { youtube: { ...(job.options?.youtube || {}), uploadMethod } } } : {}),
            priority: Number(priority) || 0,
            scheduledFor: scheduledFor ? new Date(scheduledFor).toISOString() : '',
          },
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not update this process.');
      onSaved();
    } catch (saveError) { setError(saveError.message); } finally { setSaving(false); }
  }

  return <div className={styles.modalOverlay} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <form className={styles.recordModal} onSubmit={save}>
      <div className={styles.modalTitleRow}><div><span className={styles.eyebrow}>Queued workflow</span><h2>Edit process</h2></div><button type="button" className={styles.iconButton} onClick={onClose} title="Close editor" aria-label="Close editor"><X size={17} /></button></div>
      <div className={styles.processEditSteps}>{PROCESSORS.map(([id, label]) => <label key={id}><input type="checkbox" checked={processorIds.includes(id)} onChange={() => toggleProcessor(id)} /> <span>{label}</span></label>)}</div>
      <label className={styles.formField}><span>Publishing</span><select value={publish ? 'youtube' : ''} onChange={(event) => setPublish(event.target.value === 'youtube')}><option value="">Do not upload</option><option value="youtube">Upload to YouTube</option></select></label>
      {publish && <label className={styles.formField}><span>Upload account</span><select value={uploadMethod} onChange={(event) => setUploadMethod(event.target.value)}><option value="studio">YouTube Studio — signed-in browser on the upload machine</option>{(usable.length > 0 || uploadMethod === 'api') && <option value="api">YouTube API — authorized channel</option>}</select>{uploadMethod !== 'api' && <small className={styles.fieldHint}>Uploads to the channel already signed in to YouTube Studio on the upload machine. Nothing to select.</small>}</label>}
      {needsChannel && <label className={styles.formField}><span>YouTube channel</span><select value={authorizationId} onChange={(event) => setAuthorizationId(event.target.value)}>{!authorizationId && <option value="">{usable.length ? 'Choose a channel' : 'No authorized channels'}</option>}{usable.map((item) => <option key={item.id} value={item.id}>{item.channelTitle || item.channelId} · {item.emailAddress}</option>)}{authorizationId && !usable.some((item) => item.id === authorizationId) && <option value={authorizationId}>{job.youtubeAuthorization?.channelTitle || 'Linked channel'}</option>}</select>{!usable.length && <small className={styles.fieldHint}>No authorized channels — switch the upload account to YouTube Studio, or authorize one in Connections.</small>}</label>}
      <div className={styles.formGridTwo}><label className={styles.formField}><span>Priority</span><input type="number" min="-100" max="100" value={priority} onChange={(event) => setPriority(event.target.value)} /></label><label className={styles.formField}><span>Scheduled start</span><input type="datetime-local" value={scheduledFor} onChange={(event) => setScheduledFor(event.target.value)} /></label></div>
      {error ? <div className={styles.inlineError}>{error}</div> : null}
      <div className={styles.modalActions}><button type="button" className={styles.buttonSecondary} onClick={onClose}>Cancel</button><button type="submit" className={styles.buttonPrimary} disabled={saving}>{saving ? 'Saving…' : 'Save process'}</button></div>
    </form>
  </div>;
}
