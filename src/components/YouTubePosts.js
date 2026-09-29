'use client';
import { useCallback, useEffect, useState } from 'react';
import styles from '../app/page.module.css';

const empty = { channelId: '', videoId: '', text: '', scheduledFor: '' };
export default function YouTubePosts() {
  const [posts, setPosts] = useState([]);
  const [videos, setVideos] = useState([]);
  const [draft, setDraft] = useState(empty);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const response = await fetch('/api/control/youtube/posts'); const data = await response.json();
    if (!response.ok) throw new Error(data.error); setPosts(data.posts);
  }, []);
  useEffect(() => {
    load().catch((e) => setError(e.message));
    fetch('/api/control/operations/videos?limit=100').then((r) => r.json()).then((p) => setVideos(p.videos || [])).catch(() => {});
  }, [load]);
  async function action(input) {
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/control/youtube/posts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      if (input.action === 'generate') setDraft((d) => ({ ...d, text: data.text }));
      else { setDraft(empty); await load(); setMessage(input.action === 'approve' ? 'Ready for an agent with computer-use MCP to post or schedule.' : 'Draft saved.'); }
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <section className={styles.opsPanel} aria-label="YouTube posts">
    <div className={styles.cardHeader}><h3>YouTube posts</h3><button type="button" className={styles.buttonSecondary} onClick={() => load().catch((e) => setError(e.message))}>Refresh posts</button></div>
    <p>Write a text post or generate one from a saved video. Approve the exact draft for GUI posting through your agent.</p>
    <form onSubmit={(e) => { e.preventDefault(); action({ ...draft, action: 'save', ifMatch: draft.updatedAt, scheduledFor: draft.scheduledFor ? new Date(draft.scheduledFor).toISOString() : '' }); }}>
      <div className={styles.formGridTwo}>
        <label className={styles.formField}><span>YouTube channel ID</span><input required pattern="UC[A-Za-z0-9_-]{22}" placeholder="UC…" value={draft.channelId} onChange={(e) => setDraft({ ...draft, channelId: e.target.value })} /></label>
        <label className={styles.formField}><span>Saved video (optional)</span><select value={draft.videoId || ''} onChange={(e) => setDraft({ ...draft, videoId: e.target.value })}><option value="">Standalone post</option>{videos.map((v) => <option key={v.id} value={v.id}>{v.title}</option>)}</select></label>
      </div>
      {!draft.videoId && <label className={styles.formField}><span>Source notes for generation</span><textarea rows="2" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>}
      <label className={styles.formField}><span>Post text</span><textarea required maxLength={1500} rows="5" value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} /><small>{draft.text.length}/1500</small></label>
      <label className={styles.formField}><span>Schedule in YouTube (optional, local time)</span><input type="datetime-local" value={draft.scheduledFor || ''} onChange={(e) => setDraft({ ...draft, scheduledFor: e.target.value })} /></label>
      <div className={styles.modalActions}><button type="button" className={styles.buttonSecondary} disabled={busy || (!draft.videoId && !notes.trim())} onClick={() => action({ action: 'generate', videoId: draft.videoId, referenceMaterial: notes })}>Generate post</button><button className={styles.buttonPrimary} disabled={busy}>Save draft</button>{draft.id && <button type="button" onClick={() => setDraft(empty)}>New draft</button>}</div>
    </form>
    {error && <p role="alert" className={styles.inlineError}>{error}</p>}{message && <p role="status">{message}</p>}
    <ul className={styles.releaseList}>{posts.map((post) => <li key={post.id}><span className={styles.releaseChipOutlined}>{post.status}</span><div>
      <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{post.text}</p><small>{post.channelId}{post.scheduledFor ? ` · ${new Date(post.scheduledFor).toLocaleString()}` : ''}</small>
      {post.status === 'draft' && <div className={styles.modalActions}><button type="button" className={styles.buttonSecondary} disabled={busy} onClick={() => setDraft({ ...post, scheduledFor: post.scheduledFor ? new Date(new Date(post.scheduledFor).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0,16) : '' })}>Edit</button><button type="button" className={styles.buttonPrimary} disabled={busy} onClick={() => action({ action: 'approve', id: post.id, ifMatch: post.updatedAt })}>Approve GUI posting</button></div>}
      {post.status === 'ready' && <p>Ask your agent: <code>Use the YouTube post skill to deliver approved post {post.id}.</code></p>}
      {post.status === 'posting' && <p>Claimed by an agent. If interrupted, inspect YouTube before attempting another submission.</p>}
      {post.url && <a href={post.url} target="_blank" rel="noreferrer">Open saved post</a>}
    </div></li>)}</ul>
  </section>;
}
