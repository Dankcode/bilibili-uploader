'use client';

import { useEffect, useMemo, useState } from 'react';
import styles from '../app/page.module.css';
import ProgressTree from './ProgressTree';

const FILTERS = ['all', 'queued', 'running', 'review', 'failed', 'done', 'canceled'];

function MetadataReview({ job, onApprove }) {
  const asset = (job.assets || []).slice().reverse().find((item) => item.kind === 'metadata');
  const metadata = asset?.meta || {};
  const [titleEn, setTitleEn] = useState(metadata.titleEn || '');
  const [descriptionEn, setDescriptionEn] = useState(metadata.descriptionEn || '');
  const [tags, setTags] = useState((metadata.tags || []).join(', '));
  const [saving, setSaving] = useState(false);
  const [reviewError, setReviewError] = useState('');

  const approve = async () => {
    setSaving(true);
    setReviewError('');
    try {
      await onApprove(job.id, {
        titleEn,
        descriptionEn,
        tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      });
    } catch (error) {
      setReviewError(error.message);
    } finally {
      setSaving(false);
    }
  };

  if (!asset) return <div className={styles.errorText}>Metadata review data is missing.</div>;
  return (
    <div className={styles.metadataReview}>
      <label><span>Title</span><input className={styles.input} value={titleEn} onChange={(event) => setTitleEn(event.target.value)} /></label>
      <label><span>Description</span><textarea className={styles.textarea} value={descriptionEn} onChange={(event) => setDescriptionEn(event.target.value)} /></label>
      <label><span>Tags</span><input className={styles.input} value={tags} onChange={(event) => setTags(event.target.value)} /></label>
      {reviewError && <div className={styles.errorText}>{reviewError}</div>}
      <button className={styles.saveBtn} onClick={approve}
        disabled={saving || !titleEn.trim() || !descriptionEn.trim() || !tags.trim()}>{saving ? 'Approving...' : 'Approve and resume'}</button>
    </div>
  );
}

export default function PipelineDashboard() {
  const [jobs, setJobs] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [usage, setUsage] = useState([]);

  const loadJobs = async () => {
    try {
      const query = filter === 'all' ? '' : `?status=${encodeURIComponent(filter)}`;
      const [response, usageResponse] = await Promise.all([
        fetch(`/api/control/pipeline/jobs${query}`, { cache: 'no-store' }),
        fetch('/api/control/pipeline/usage', { cache: 'no-store' }),
      ]);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to load jobs');
      const usageData = await usageResponse.json().catch(() => ({}));
      setJobs(data.jobs || []);
      if (usageResponse.ok) setUsage(usageData.usage || []);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadJobs();
    const interval = setInterval(() => {
      if (!document.hidden) loadJobs();
    }, 3000);
    return () => clearInterval(interval);
  }, [filter]);

  const counts = useMemo(() => jobs.reduce((acc, job) => {
    acc[job.status] = (acc[job.status] || 0) + 1;
    return acc;
  }, {}), [jobs]);

  const postAction = async (action, jobId) => {
    const response = await fetch('/api/control/pipeline/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, jobId }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) setError(data.error || 'Pipeline action failed');
    loadJobs();
  };

  const approveMetadata = async (jobId, metadata) => {
    const response = await fetch('/api/control/pipeline/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approveMetadata', jobId, metadata }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Could not approve metadata');
    await loadJobs();
  };

  return (
    <section className={styles.tableCard}>
      <div className={styles.cardHeader}>
        <h3>Pipeline Jobs</h3>
        <div className={styles.filterBar}>
          {FILTERS.map((item) => (
            <button
              key={item}
              className={`${styles.filterChip} ${filter === item ? styles.activeFilterChip : ''}`}
              onClick={() => setFilter(item)}
            >
              {item} {counts[item] ? `(${counts[item]})` : ''}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.panelBody}>
        {!!usage.length && (
          <div className={styles.usageGrid}>
            {usage.map((row) => (
              <div key={`${row.service}-${row.keyHash}`} className={styles.usageItem}>
                <div><strong>{row.service}</strong><span>{Math.round(row.seconds / 60)} / {Math.round(row.maxDailySeconds / 60)} min</span></div>
                <div className={styles.progressTrack}><div className={styles.progressFill} style={{ width: `${Math.min(100, row.ratio * 100)}%` }} /></div>
              </div>
            ))}
          </div>
        )}
        {loading && <div className={styles.muted}>Loading jobs...</div>}
        {error && <div className={styles.errorText}>{error}</div>}
        {!loading && jobs.length === 0 && <div className={styles.muted}>No pipeline jobs yet.</div>}
        <div className={styles.jobList}>
          {jobs.map((job) => (
            <article key={job.id} className={styles.jobRow}>
              <div className={styles.jobTopLine}>
                <div>
                  <strong>#{job.id}</strong> {job.sourceId}
                  {job.processorIds.length ? ` -> ${job.processorIds.join(' -> ')}` : ''}
                  {job.uploaderId ? ` -> ${job.uploaderId}` : ' -> download only'}
                </div>
                <span className={`${styles.statusLabel} ${styles[job.status] || ''}`}>{job.status}</span>
              </div>
              <div className={styles.jobSource}>{job.sourceInput}</div>
              <ProgressTree job={job} />
              {job.status === 'review' && <MetadataReview job={job} onApprove={approveMetadata} />}
              {!!job.assets?.length && (
                <div className={styles.assetList}>
                  {job.assets.map((asset) => (
                    <a
                      key={asset.id}
                      className={styles.assetChip}
                      href={`/api/control/pipeline/assets/${asset.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {asset.kind} #{asset.id}
                    </a>
                  ))}
                </div>
              )}
              {job.error && <div className={styles.errorText}>{job.error}</div>}
              <div className={styles.operationRow}>
                {job.status === 'failed' && <button className={styles.saveBtn} onClick={() => postAction('retry', job.id)}>Retry</button>}
                {(job.status === 'queued' || job.status === 'running' || job.status === 'review') && <button className={styles.editBtn} onClick={() => postAction('cancel', job.id)}>Cancel</button>}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
