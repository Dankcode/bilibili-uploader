'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import ProcessCanvas from './ProcessCanvas';
import ProcessHeader from './ProcessHeader';
import NodeInspector from './NodeInspector';
import ProcessEditor from './ProcessEditor';
import styles from '../../app/page.module.css';

export default function ProcessDetail({ videoId, embedded = false, onClose = null, onChanged = null }) {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [live, setLive] = useState(true);
  const [selectedId, setSelectedId] = useState('');
  const [updatedAt, setUpdatedAt] = useState(null);
  const [editing, setEditing] = useState(false);
  const [mailEvents, setMailEvents] = useState([]);
  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/control/operations/videos/${videoId}/process`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not load this video process.');
      setData(payload); setError(''); setUpdatedAt(new Date());
      setSelectedId((current) => current || new URLSearchParams(window.location.hash.replace(/^#/, '')).get('node') || payload.graph?.nodes?.[0]?.id || '');
    } catch (loadError) { setError(loadError.message); }
  }, [videoId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch(`/api/control/mail/threads/${videoId}`, { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : { events: [] })
      .then((payload) => setMailEvents(payload.events || []))
      .catch(() => setMailEvents([]));
  }, [videoId]);
  const interval = useMemo(() => data?.graph?.nodes?.some((node) => node.status === 'running') ? 3_000 : 15_000, [data]);
  useEffect(() => {
    if (!live) return undefined;
    const tick = () => { if (!document.hidden) load(); };
    const timer = setInterval(tick, interval);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, [interval, live, load]);
  useEffect(() => {
    const onEscape = (event) => { if (event.key === 'Escape') { if (selectedId) setSelectedId(''); else if (embedded) onClose?.(); else router.back(); } };
    window.addEventListener('keydown', onEscape); return () => window.removeEventListener('keydown', onEscape);
  }, [router, selectedId, embedded, onClose]);
  function select(id) { setSelectedId(id); window.history.replaceState(null, '', `#node=${encodeURIComponent(id)}`); }
  async function action(action) {
    const response = await fetch('/api/control/pipeline/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, jobId: data.job.id }) });
    const payload = await response.json();
    if (!response.ok) setError(payload.error || `Could not ${action} job.`); else load();
  }
  function back() { if (embedded) return onClose?.(); if (window.history.length > 1 && document.referrer.startsWith(window.location.origin)) router.back(); else router.push('/?view=library'); }
  if (error && !data) return <div className={styles.processError}><p>{error}</p><button className={styles.buttonPrimary} type="button" onClick={load}>Retry</button></div>;
  if (!data) return <div className={styles.processLoading}><span /><span /><span /><span /></div>;
  const selected = data.graph?.nodes?.find((node) => node.id === selectedId) || null;
  return <section className={styles.processDetail}><ProcessHeader data={data} live={live} onLive={setLive} onAction={action} onBack={back} onEdit={() => setEditing(true)} /><div className={styles.processContent}><div className={styles.processCanvasPanel}>{data.planned ? <p className={styles.processEmpty}>This video has not run yet — its planned chain is shown below.</p> : null}<ProcessCanvas graph={data.graph} selectedId={selectedId} onSelect={select} /><small className={styles.processUpdated}>{live ? 'Live updates enabled' : 'Updates paused'} · {updatedAt ? `updated ${updatedAt.toLocaleTimeString()}` : ''}</small>{mailEvents.length > 0 && <div className={styles.preflightList}><strong>Mail timeline</strong>{mailEvents.map((event) => <div className={styles.checkItem} key={event.id}><div className={styles.jobTopLine}><strong>{event.subject || event.eventKind}</strong><span>{event.severity || event.direction}</span></div><div className={styles.jobSource}>{event.detail || event.snippet}</div><small>{event.receivedAt || event.sentAt}</small></div>)}</div>}</div>{selected ? <NodeInspector node={selected} videoId={videoId} jobId={data.job?.id} canApproveCorrections={data.capabilities.canApproveCorrections} onClose={() => setSelectedId('')} onRefresh={load} /> : null}</div>{editing ? <ProcessEditor job={data.job} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); onChanged?.(); }} /> : null}{error ? <div className={styles.inlineError}>{error}</div> : null}</section>;
}
