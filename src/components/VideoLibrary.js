'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft, ChevronRight, Edit3, ExternalLink,
  RefreshCw, RotateCcw, Search, StopCircle, X,
} from 'lucide-react';
import styles from '../app/page.module.css';

const number = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

function tone(status) {
  if (['published', 'completed', 'done'].includes(status)) return styles.statusOk;
  if (['failed', 'canceled'].includes(status)) return styles.statusDanger;
  if (['queued', 'processing', 'running', 'scheduled'].includes(status)) return styles.statusRunning;
  if (status === 'review') return styles.statusWarn;
  return styles.statusMuted;
}

export default function VideoLibrary({ externalQuery = '', refreshKey = 0 }) {
  const [query, setQuery] = useState(externalQuery);
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState({ videos: [], total: 0, limit: 50, offset: 0 });
  const [selected, setSelected] = useState(new Set());
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => setQuery(externalQuery), [externalQuery]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ query, status, limit: '50', offset: String(offset) });
      const response = await fetch(`/api/control/operations/videos?${params}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not load video catalog');
      setData(payload);
      setSelected(new Set());
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, [offset, query, status]);

  useEffect(() => {
    const timer = setTimeout(load, 180);
    return () => clearTimeout(timer);
  }, [load, refreshKey]);

  const selectedJobs = useMemo(() => data.videos.filter((video) => selected.has(video.id) && video.job?.id).map((video) => video.job.id), [data.videos, selected]);
  const allSelected = data.videos.length > 0 && data.videos.every((video) => selected.has(video.id));

  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(data.videos.map((video) => video.id)));
  const toggleOne = (id) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  async function bulkAction(action) {
    if (!selectedJobs.length) return;
    setNotice('');
    setError('');
    try {
      const response = await fetch('/api/control/pipeline/jobs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, jobIds: selectedJobs }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Bulk operation failed');
      const failed = payload.results.filter((result) => !result.ok).length;
      setNotice(`${payload.results.length - failed} jobs updated${failed ? `, ${failed} skipped` : ''}.`);
      await load();
    } catch (actionError) {
      setError(actionError.message);
    }
  }

  async function saveEdit(event) {
    event.preventDefault();
    try {
      const response = await fetch('/api/control/operations/videos', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId: editing.id,
          patch: {
            title: editing.title,
            campaign: editing.campaign,
            priority: editing.priority,
            status: editing.status,
            scheduledAt: editing.scheduledAt ? new Date(editing.scheduledAt).toISOString() : '',
          },
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not update video');
      setEditing(null);
      setNotice('Video record updated.');
      await load();
    } catch (saveError) {
      setError(saveError.message);
    }
  }

  return (
    <section className={styles.libraryView}>
      <div className={styles.viewToolbar}>
        <label className={styles.searchField}>
          <Search size={15} />
          <input value={query} onChange={(event) => { setQuery(event.target.value); setOffset(0); }} placeholder="Search title, campaign, or source" />
          {query && <button type="button" onClick={() => setQuery('')} title="Clear search" aria-label="Clear search"><X size={14} /></button>}
        </label>
        <select className={styles.compactSelect} value={status} onChange={(event) => { setStatus(event.target.value); setOffset(0); }} aria-label="Filter by status">
          <option value="">All stages</option>
          {['draft', 'queued', 'processing', 'review', 'scheduled', 'published', 'completed', 'failed', 'canceled'].map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <button type="button" className={styles.iconButton} onClick={load} title="Refresh library" aria-label="Refresh library"><RefreshCw size={16} /></button>
        <div className={styles.toolbarDivider} />
        <span className={styles.selectionCount}>{selected.size} selected</span>
        <button type="button" className={styles.toolbarButton} disabled={!selectedJobs.length} onClick={() => bulkAction('bulkRetry')}><RotateCcw size={14} /> Retry</button>
        <button type="button" className={styles.toolbarButton} disabled={!selectedJobs.length} onClick={() => bulkAction('bulkCancel')}><StopCircle size={14} /> Cancel</button>
      </div>

      {(notice || error) && <div className={error ? styles.inlineError : styles.inlineNotice}>{error || notice}</div>}

      <div className={styles.opsPanel}>
        <div className={styles.catalogHeader}>
          <div><span className={styles.eyebrow}>SQL catalog</span><h2>{number.format(data.total)} videos</h2></div>
          <span>{loading ? 'Updating' : `${data.offset + 1}-${Math.min(data.offset + data.limit, data.total || 0)}`}</span>
        </div>
        <div className={styles.opsTableWrap}>
          <table className={`${styles.opsTable} ${styles.libraryTable}`}>
            <thead><tr>
              <th className={styles.checkboxCell}><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all visible videos" /></th>
              <th>Video</th><th>Campaign</th><th>Stage</th><th>Workflow</th><th>Schedule</th><th>Views</th><th aria-label="Actions" />
            </tr></thead>
            <tbody>
              {data.videos.map((video) => (
                <tr key={video.id}>
                  <td className={styles.checkboxCell}><input type="checkbox" checked={selected.has(video.id)} onChange={() => toggleOne(video.id)} aria-label={`Select ${video.title}`} /></td>
                  <td><strong>{video.title}</strong><span>{video.sourceType} · {video.language || 'source language'}{video.publication?.youtubeAuthorization ? ` · ${video.publication.youtubeAuthorization.channelTitle || video.publication.youtubeAuthorization.emailAddress}` : ''}</span></td>
                  <td>{video.campaign || 'Unassigned'}</td>
                  <td><span className={`${styles.statusPill} ${tone(video.job?.status || video.status)}`}>{video.job?.status || video.status}</span>{video.job?.error && <small className={styles.rowError}>{video.job.error}</small>}</td>
                  <td>{video.job?.processorIds?.length ? video.job.processorIds.join(' / ') : 'Source only'}</td>
                  <td>{video.scheduledAt ? new Date(video.scheduledAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Immediate'}</td>
                  <td>{number.format(video.metrics?.views || 0)}</td>
                  <td className={styles.rowActions}>
                    {video.publication?.url && <a className={styles.iconButton} href={video.publication.url} target="_blank" rel="noreferrer" title="Open publication" aria-label="Open publication"><ExternalLink size={15} /></a>}
                    <button type="button" className={styles.iconButton} onClick={() => setEditing({ ...video, scheduledAt: video.scheduledAt ? video.scheduledAt.slice(0, 16) : '' })} title="Edit video record" aria-label={`Edit ${video.title}`}><Edit3 size={15} /></button>
                  </td>
                </tr>
              ))}
              {!data.videos.length && <tr><td colSpan="8"><div className={styles.emptyTable}>{loading ? 'Loading catalog...' : 'No videos match this view.'}</div></td></tr>}
            </tbody>
          </table>
        </div>
        <div className={styles.paginationBar}>
          <button type="button" className={styles.iconButton} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - data.limit))} title="Previous page" aria-label="Previous page"><ChevronLeft size={16} /></button>
          <span>Page {Math.floor(offset / data.limit) + 1} of {Math.max(1, Math.ceil(data.total / data.limit))}</span>
          <button type="button" className={styles.iconButton} disabled={offset + data.limit >= data.total} onClick={() => setOffset(offset + data.limit)} title="Next page" aria-label="Next page"><ChevronRight size={16} /></button>
        </div>
      </div>

      {editing && <div className={styles.modalOverlay} onMouseDown={(event) => event.target === event.currentTarget && setEditing(null)}>
        <form className={styles.recordModal} onSubmit={saveEdit}>
          <div className={styles.modalTitleRow}><div><span className={styles.eyebrow}>Video record</span><h2>Edit catalog details</h2></div><button type="button" className={styles.iconButton} onClick={() => setEditing(null)} title="Close" aria-label="Close"><X size={17} /></button></div>
          <label className={styles.formField}><span>Title</span><input value={editing.title} onChange={(event) => setEditing({ ...editing, title: event.target.value })} required /></label>
          <label className={styles.formField}><span>Campaign</span><input value={editing.campaign || ''} onChange={(event) => setEditing({ ...editing, campaign: event.target.value })} /></label>
          <div className={styles.formGridTwo}>
            <label className={styles.formField}><span>Stage</span><select value={editing.status} onChange={(event) => setEditing({ ...editing, status: event.target.value })}>{['draft', 'queued', 'processing', 'review', 'scheduled', 'published', 'completed', 'failed', 'canceled'].map((value) => <option key={value}>{value}</option>)}</select></label>
            <label className={styles.formField}><span>Priority</span><input type="number" min="-100" max="100" value={editing.priority} onChange={(event) => setEditing({ ...editing, priority: event.target.value })} /></label>
          </div>
          <label className={styles.formField}><span>Scheduled start</span><input type="datetime-local" value={editing.scheduledAt || ''} onChange={(event) => setEditing({ ...editing, scheduledAt: event.target.value })} /></label>
          <div className={styles.modalActions}><button type="button" className={styles.buttonSecondary} onClick={() => setEditing(null)}>Cancel</button><button type="submit" className={styles.buttonPrimary}>Save record</button></div>
        </form>
      </div>}
    </section>
  );
}
