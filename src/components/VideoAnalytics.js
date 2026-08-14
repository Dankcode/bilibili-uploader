'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Clock3, Eye, MousePointerClick, Plus, RefreshCw, TrendingUp, X } from 'lucide-react';
import styles from '../app/page.module.css';

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

export default function VideoAnalytics({ refreshKey = 0 }) {
  const [data, setData] = useState({ totals: {}, trend: [], videos: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/control/operations/analytics', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not load analytics');
      setData(payload);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);
  const maxViews = Math.max(1, ...(data.trend || []).map((point) => Number(point.views) || 0));
  const watchHours = (Number(data.totals?.watchTimeSeconds) || 0) / 3600;

  async function saveSnapshot(event) {
    event.preventDefault();
    try {
      const response = await fetch('/api/control/operations/analytics', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicationId: editing.publicationId, metrics: editing.metrics }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not save metrics');
      setData(payload.analytics);
      setEditing(null);
    } catch (saveError) {
      setError(saveError.message);
    }
  }

  const kpis = useMemo(() => [
    ['Views', compact.format(data.totals?.views || 0), `${data.totals?.videos || 0} published videos`, Eye],
    ['Watch time', `${compact.format(watchHours)}h`, 'Latest snapshots', Clock3],
    ['Engagement', `${data.totals?.engagementRate || 0}%`, 'Likes, comments, shares', TrendingUp],
    ['Click-through', `${data.totals?.clickThroughRate || 0}%`, `${compact.format(data.totals?.impressions || 0)} impressions`, MousePointerClick],
    ['Conversions', compact.format(data.totals?.conversions || 0), 'Attributed outcomes', BarChart3],
  ], [data, watchHours]);

  return (
    <section className={styles.analyticsView}>
      {error && <div className={styles.inlineError}>{error}</div>}
      <div className={styles.kpiGrid}>
        {kpis.map(([label, value, note, Icon]) => <article className={styles.metricPanel} key={label}><div className={styles.metricTopline}><span>{label}</span><Icon size={15} /></div><strong>{value}</strong><small>{note}</small></article>)}
      </div>
      <div className={styles.analyticsGrid}>
        <section className={styles.opsPanel}>
          <div className={styles.opsPanelHeader}><div><span className={styles.eyebrow}>Last 14 days</span><h2>Audience reach</h2></div><button type="button" className={styles.iconButton} onClick={load} title="Refresh analytics" aria-label="Refresh analytics"><RefreshCw size={16} /></button></div>
          <div className={styles.analyticsChart}>
            {(data.trend || []).map((point) => <div key={point.day}><i style={{ height: `${Math.max(3, ((Number(point.views) || 0) / maxViews) * 100)}%` }} title={`${compact.format(point.views || 0)} views`} /><span>{new Date(`${point.day}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span></div>)}
            {!data.trend?.length && <div className={styles.emptyChart}>{loading ? 'Loading snapshots...' : 'No metric snapshots yet.'}</div>}
          </div>
        </section>
        <section className={styles.opsPanel}>
          <div className={styles.opsPanelHeader}><div><span className={styles.eyebrow}>Conversion view</span><h2>Funnel</h2></div></div>
          <div className={styles.funnelList}>
            {[
              ['Impressions', data.totals?.impressions || 0],
              ['Views', data.totals?.views || 0],
              ['Clicks', data.videos?.reduce((sum, video) => sum + Number(video.clicks || 0), 0) || 0],
              ['Conversions', data.totals?.conversions || 0],
            ].map(([label, value], index, rows) => <div key={label}><span>{label}</span><strong>{compact.format(value)}</strong>{index < rows.length - 1 && <small>{value ? `${(((rows[index + 1][1] || 0) / value) * 100).toFixed(1)}%` : '0%'}</small>}</div>)}
          </div>
        </section>
      </div>

      <section className={styles.opsPanel}>
        <div className={styles.opsPanelHeader}><div><span className={styles.eyebrow}>Latest platform snapshots</span><h2>Video performance</h2></div></div>
        <div className={styles.opsTableWrap}><table className={styles.opsTable}><thead><tr><th>Video</th><th>Platform</th><th>Views</th><th>Engagement</th><th>Watch time</th><th>Conversions</th><th>Captured</th><th /></tr></thead><tbody>
          {(data.videos || []).map((video) => {
            const engagements = Number(video.likes || 0) + Number(video.comments || 0) + Number(video.shares || 0);
            return <tr key={`${video.id}-${video.publicationId}`}><td><strong>{video.title}</strong><span>{video.campaign || 'Unassigned'}</span></td><td>{video.platformId}{video.youtubeAuthorization && <span>{video.youtubeAuthorization.channelTitle || video.youtubeAuthorization.emailAddress}</span>}</td><td>{compact.format(video.views)}</td><td>{video.views ? `${((engagements / video.views) * 100).toFixed(2)}%` : '0%'}</td><td>{compact.format((video.watchTimeSeconds || 0) / 3600)}h</td><td>{compact.format(video.conversions)}</td><td>{video.capturedAt ? new Date(video.capturedAt).toLocaleDateString() : 'No snapshot'}</td><td><button type="button" className={styles.iconButton} onClick={() => setEditing({ publicationId: video.publicationId, title: video.title, metrics: { views: video.views, impressions: video.impressions, watchTimeSeconds: video.watchTimeSeconds, likes: video.likes, comments: video.comments, shares: video.shares, clicks: video.clicks, conversions: video.conversions } })} title="Add metric snapshot" aria-label={`Add metrics for ${video.title}`}><Plus size={15} /></button></td></tr>;
          })}
          {!data.videos?.length && <tr><td colSpan="8"><div className={styles.emptyTable}>{loading ? 'Loading analytics...' : 'Published videos will appear here.'}</div></td></tr>}
        </tbody></table></div>
      </section>

      {editing && <div className={styles.modalOverlay} onMouseDown={(event) => event.target === event.currentTarget && setEditing(null)}><form className={styles.recordModal} onSubmit={saveSnapshot}>
        <div className={styles.modalTitleRow}><div><span className={styles.eyebrow}>Performance snapshot</span><h2>{editing.title}</h2></div><button type="button" className={styles.iconButton} onClick={() => setEditing(null)} title="Close" aria-label="Close"><X size={17} /></button></div>
        <div className={styles.metricsForm}>{['views', 'impressions', 'watchTimeSeconds', 'likes', 'comments', 'shares', 'clicks', 'conversions'].map((key) => <label className={styles.formField} key={key}><span>{key.replace(/([A-Z])/g, ' $1')}</span><input type="number" min="0" step={key === 'watchTimeSeconds' ? '0.1' : '1'} value={editing.metrics[key] || 0} onChange={(event) => setEditing({ ...editing, metrics: { ...editing.metrics, [key]: Number(event.target.value) } })} /></label>)}</div>
        <div className={styles.modalActions}><button type="button" className={styles.buttonSecondary} onClick={() => setEditing(null)}>Cancel</button><button type="submit" className={styles.buttonPrimary}>Save snapshot</button></div>
      </form></div>}
    </section>
  );
}
