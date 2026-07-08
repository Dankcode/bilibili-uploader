'use client';

import { useEffect, useMemo, useState } from 'react';
import styles from '../app/page.module.css';
import ProgressTree from './ProgressTree';

const FILTERS = ['all', 'queued', 'running', 'failed', 'done', 'canceled'];

export default function PipelineDashboard() {
  const [jobs, setJobs] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadJobs = async () => {
    try {
      const query = filter === 'all' ? '' : `?status=${encodeURIComponent(filter)}`;
      const response = await fetch(`/api/pipeline/jobs${query}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to load jobs');
      setJobs(data.jobs || []);
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
    await fetch('/api/pipeline/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, jobId }),
    });
    loadJobs();
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
              {job.error && <div className={styles.errorText}>{job.error}</div>}
              <div className={styles.operationRow}>
                {job.status === 'failed' && <button className={styles.saveBtn} onClick={() => postAction('retry', job.id)}>Retry</button>}
                {(job.status === 'queued' || job.status === 'running') && <button className={styles.editBtn} onClick={() => postAction('cancel', job.id)}>Cancel</button>}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
