'use client';

import { useEffect, useState } from 'react';

import {
  Activity, AlertTriangle, ArrowRight, CheckCircle2, CircleDashed,
  Clock3, Film, PlayCircle, RefreshCw, ShieldCheck,
} from 'lucide-react';
import styles from '../app/page.module.css';

const number = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

function statusTone(status) {
  if (['ok', 'passed', 'completed', 'published', 'done'].includes(status)) return styles.statusOk;
  if (['failed', 'canceled'].includes(status)) return styles.statusDanger;
  if (['running', 'processing', 'queued'].includes(status)) return styles.statusRunning;
  return styles.statusMuted;
}

function StatusIcon({ status }) {
  if (['ok', 'passed'].includes(status)) return <CheckCircle2 size={15} />;
  if (status === 'failed') return <AlertTriangle size={15} />;
  return <CircleDashed size={15} />;
}

export default function OperationsOverview({ payload, loading, error, onRefresh, onNavigate, onOpenProcess }) {
  const overview = payload?.overview;
  const counts = overview?.counts || {};
  const throughput = overview?.throughput || [];
  const recent = overview?.recentVideos || [];
  const maxThroughput = Math.max(1, ...throughput.flatMap((day) => [day.completed || 0, day.failed || 0]));
  const [retention, setRetention] = useState(null);
  const [retentionError, setRetentionError] = useState('');
  const [cleaning, setCleaning] = useState(false);

  const loadRetention = () => fetch('/api/control/operations/media-retention', { cache: 'no-store' })
    .then((response) => response.ok ? response.json() : Promise.reject(new Error('Could not load local media cleanup.')))
    .then((data) => { setRetention(data); setRetentionError(''); })
    .catch((loadError) => setRetentionError(loadError.message));
  useEffect(() => { loadRetention(); }, []);

  async function updateRetention(enabled) {
    try {
      const response = await fetch('/api/control/operations/media-retention', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'settings', enabled, retentionDays: retention?.retentionDays || 7 }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not update cleanup settings.');
      setRetention(data);
    } catch (updateError) { setRetentionError(updateError.message); }
  }

  async function cleanReviewedMedia() {
    const candidates = retention?.preview?.candidates || [];
    if (!candidates.length || !window.confirm(`Remove ${candidates.length} reviewed local media file(s)? Video records and upload history will remain.`)) return;
    setCleaning(true);
    try {
      const response = await fetch('/api/control/operations/media-retention', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cleanup', assetIds: candidates.map((candidate) => candidate.assetId) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not remove local media.');
      await loadRetention();
    } catch (cleanupError) { setRetentionError(cleanupError.message); } finally { setCleaning(false); }
  }

  if (loading && !overview) {
    return <div className={styles.loadingSurface}><RefreshCw size={18} className={styles.spin} /> Loading operations</div>;
  }

  return (
    <div className={styles.opsOverview}>
      {error && <div className={styles.inlineError}>{error}</div>}

      <section className={styles.kpiGrid} aria-label="Operations summary">
        {[
          ['Video catalog', counts.total || 0, 'All tracked assets', Film],
          ['Active queue', counts.active || 0, `${counts.processing || 0} rendering`, Activity],
          ['Needs review', counts.needsReview || 0, 'Failed or held', AlertTriangle],
          ['Published', counts.published || 0, 'Live destinations', PlayCircle],
          ['Success rate', `${counts.successRate ?? 100}%`, 'Completed attempts', ShieldCheck],
        ].map(([label, value, note, MetricIcon]) => (
          <article className={styles.metricPanel} key={label}>
            <div className={styles.metricTopline}><span>{label}</span><MetricIcon size={15} /></div>
            <strong>{typeof value === 'number' ? number.format(value) : value}</strong>
            <small>{note}</small>
          </article>
        ))}
      </section>

      <div className={styles.overviewGrid}>
        <div className={styles.overviewPrimary}>
          <section className={styles.opsPanel}>
            <div className={styles.opsPanelHeader}>
              <div>
                <span className={styles.eyebrow}>Last 7 days</span>
                <h2>Pipeline throughput</h2>
              </div>
              <button type="button" className={styles.iconButton} onClick={onRefresh} title="Refresh operations" aria-label="Refresh operations">
                <RefreshCw size={16} />
              </button>
            </div>
            <div className={styles.throughputChart}>
              {throughput.map((day) => (
                <div className={styles.chartColumn} key={day.day}>
                  <div className={styles.chartBars}>
                    <i className={styles.chartBarComplete} style={{ height: `${Math.max(3, ((day.completed || 0) / maxThroughput) * 100)}%` }} title={`${day.completed || 0} completed`} />
                    <i className={styles.chartBarFailed} style={{ height: `${Math.max(2, ((day.failed || 0) / maxThroughput) * 100)}%` }} title={`${day.failed || 0} failed`} />
                  </div>
                  <span>{new Date(`${day.day}T00:00:00`).toLocaleDateString([], { weekday: 'short' })}</span>
                </div>
              ))}
            </div>
            <div className={styles.chartLegend}><span><i className={styles.legendComplete} /> Completed</span><span><i className={styles.legendFailed} /> Failed</span></div>
          </section>

          <section className={styles.opsPanel}>
            <div className={styles.opsPanelHeader}>
              <div>
                <span className={styles.eyebrow}>Catalog activity</span>
                <h2>Video operations</h2>
              </div>
              <button type="button" className={styles.textButton} onClick={() => onNavigate('library')}>Open library <ArrowRight size={14} /></button>
            </div>
            <div className={styles.opsTableWrap}>
              <table className={styles.opsTable}>
                <thead><tr><th>Scraped source</th><th>Delivery record</th><th>Workflow</th><th>Stage</th><th>Schedule</th><th>Views</th></tr></thead>
                <tbody>
                  {recent.map((video) => (
                    <tr key={video.id} className={styles.overviewVideoRow} onClick={() => onOpenProcess?.(video.id)}>
                      <td><strong>{video.content?.sourceTitle || video.title}</strong><span>{video.content?.sourceUrl ? 'Bilibili source linked' : (video.campaign || video.sourceType)}</span></td>
                      <td><strong>{video.content?.deliveryTitle || video.title}</strong><span>{video.content?.deliveryUrl ? 'YouTube delivery linked' : 'Awaiting delivery'}</span></td>
                      <td>{video.job?.processorIds?.length ? video.job.processorIds.join(' / ') : 'Source only'}</td>
                      <td><span className={`${styles.statusPill} ${statusTone(video.job?.status || video.status)}`}>{video.job?.status || video.status}</span></td>
                      <td>{video.scheduledAt ? new Date(video.scheduledAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Immediate'}</td>
                      <td>{number.format(video.metrics?.views || 0)}</td>
                    </tr>
                  ))}
                  {!recent.length && <tr><td colSpan="6"><div className={styles.emptyTable}>No videos have entered the operations catalog.</div></td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <aside className={styles.overviewRail}>
          <section className={styles.opsPanel}>
            <div className={styles.opsPanelHeader}>
              <div><span className={styles.eyebrow}>Live checks</span><h2>Automation health</h2></div>
            </div>
            <div className={styles.healthList}>
              {(payload?.health || []).map((item) => (
                <button type="button" className={styles.healthRow} key={item.id} onClick={() => onNavigate(item.id === 'faceFusion' ? 'automation' : 'connections', item.id === 'faceFusion' ? 'proof' : '')}>
                  <span className={`${styles.healthIcon} ${statusTone(item.status)}`}><StatusIcon status={item.status} /></span>
                  <span><strong>{item.label}</strong><small>{item.detail}</small></span>
                  <ArrowRight size={14} />
                </button>
              ))}
            </div>
          </section>

          <section className={styles.opsPanel}>
            <div className={styles.opsPanelHeader}>
              <div><span className={styles.eyebrow}>Priority order</span><h2>Next up</h2></div>
            </div>
            <div className={styles.nextList}>
              {(overview?.nextUp || []).map((video, index) => (
                <button type="button" className={styles.nextRow} key={video.id} onClick={() => onOpenProcess?.(video.id)}>
                  <span className={styles.queueNumber}>{String(index + 1).padStart(2, '0')}</span>
                  <span><strong>{video.title}</strong><small><Clock3 size={12} /> {video.job?.currentStep || video.status}</small></span>
                </button>
              ))}
              {!overview?.nextUp?.length && <div className={styles.emptyRail}>Queue is clear.</div>}
            </div>
            <button type="button" className={styles.railAction} onClick={() => onNavigate('automation')}>Plan a batch <ArrowRight size={14} /></button>
          </section>
          <section className={styles.opsPanel}>
            <div className={styles.opsPanelHeader}><div><span className={styles.eyebrow}>Local storage</span><h2>Weekly media cleanup</h2></div></div>
            <div className={styles.retentionPanel}>
              <label><input type="checkbox" checked={Boolean(retention?.enabled)} onChange={(event) => updateRetention(event.target.checked)} /> Enable weekly scan</label>
              <small>Scans terminal files in <code>video-work</code> after 7 days. Deletion always requires this review button.</small>
              <strong>{retention?.preview?.candidates?.length || 0} file(s) eligible now</strong>
              <button type="button" className={styles.toolbarButton} disabled={!retention?.preview?.candidates?.length || cleaning} onClick={cleanReviewedMedia}>{cleaning ? 'Removing…' : 'Review and remove local files'}</button>
              {retentionError ? <span className={styles.rowError}>{retentionError}</span> : null}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
