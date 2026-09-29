'use client';
import { useEffect, useState } from 'react';
import PublishTarget from './PublishTarget';
import styles from '../app/page.module.css';

export default function LibraryUpload({ videoIds, onClose, onQueued }) {
  const [personality, setPersonality] = useState('natural');
  const [context, setContext] = useState('');
  const [metadataMode, setMetadataMode] = useState('generate');
  const [method, setMethod] = useState('studio');
  const [channels, setChannels] = useState([]);
  const [channel, setChannel] = useState('');
  const [privacy, setPrivacy] = useState('private');
  const [review, setReview] = useState(true);
  const [start, setStart] = useState('');
  const [spacing, setSpacing] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { fetch('/api/control/operations/youtube-authorizations').then((r) => r.json()).then((p) => setChannels(p.authorizations || [])).catch(() => {}); }, []);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch('/api/control/operations/library-upload', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoIds, personality, context, metadataMode, uploadMethod: method, youtubeAuthorizationId: method === 'api' ? channel : '',
          privacyStatus: privacy, reviewMetadata: review, startAt: start ? new Date(start).toISOString() : '', spacingMinutes: Number(spacing) }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error);
      onQueued(payload.batch);
    } catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  return <div className={styles.modalOverlay}><form className={styles.recordModal} style={{ maxHeight: 'calc(100dvh - 32px)' }} onSubmit={submit} aria-label="Upload library videos">
    <h2>Upload {videoIds.length} saved video{videoIds.length === 1 ? '' : 's'}</h2>
    <p>Use saved media when available. Generate natural titles, descriptions and relevant tags from source material, without em dashes.</p>
    <label className={styles.formField}><span>Upload method</span><select value={method} onChange={(e) => setMethod(e.target.value)}><option value="studio">YouTube Studio GUI</option><option value="api">YouTube API</option></select></label>
    {method === 'api' ? <PublishTarget authorizations={channels} value={channel} onChange={setChannel} /> : <p>The upload machine uses the signed-in channel and its trained channel reference. Studio finishes processing in the background.</p>}
    <label className={styles.formField}><span>Visibility</span><select value={privacy} onChange={(e) => setPrivacy(e.target.value)}>{['private','unlisted','public'].map((v) => <option key={v}>{v}</option>)}</select></label>
    <label className={styles.formField}><span>Title, description and tags</span><select value={metadataMode} onChange={(e) => setMetadataMode(e.target.value)}><option value="generate">Generate and save to the database</option><option value="saved">Use metadata already saved in the database</option></select></label>
    <label className={styles.formField}><span>Creator personality</span><input value={personality} maxLength={1000} onChange={(e) => setPersonality(e.target.value)} placeholder="Calm and warm, curious teacher, witty storyteller…" /></label>
    <label className={styles.formField}><span>Context for titles and descriptions</span><textarea value={context} maxLength={5000} rows={4} onChange={(e) => setContext(e.target.value)} placeholder="Describe your audience, tone, title style, words to avoid, and how descriptions should be structured." /></label>
    <p>These directions are saved with each SQL video record. The generator stays grounded in the source material and avoids em dashes. Source links are checked for earlier uploads before queuing.</p>
    <label><input type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} /> Review generated metadata before uploading</label>
    <div className={styles.formGridTwo}>
      <label className={styles.formField}><span>Start at (optional)</span><input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></label>
      <label className={styles.formField}><span>Minutes between videos</span><input type="number" min="0" max="525600" value={spacing} onChange={(e) => setSpacing(e.target.value)} /></label>
    </div>
    {error && <p role="alert">{error}</p>}
    <div className={styles.modalActions}><button type="button" className={styles.buttonSecondary} onClick={onClose} disabled={busy}>Cancel</button><button className={styles.buttonPrimary} disabled={busy || (method === 'api' && !channel)}>{busy ? 'Queuing…' : 'Queue uploads'}</button></div>
  </form></div>;
}
