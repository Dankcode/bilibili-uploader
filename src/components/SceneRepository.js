'use client';

import { useEffect, useState } from 'react';
import styles from '../app/page.module.css';

export default function SceneRepository() {
  const [shows, setShows] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [activeShowId, setActiveShowId] = useState('');
  const [newShow, setNewShow] = useState({ titleZh: '', titleEn: '', kind: 'drama', sourceHint: '' });
  const [status, setStatus] = useState('');

  const load = async (showId = activeShowId) => {
    const query = showId ? `?showId=${encodeURIComponent(showId)}` : '';
    const response = await fetch(`/api/scenes${query}`, { cache: 'no-store' });
    const data = await response.json();
    if (response.ok) {
      setShows(data.shows || []);
      setCandidates(data.candidates || []);
      if (!showId && data.shows?.[0]) setActiveShowId(String(data.shows[0].id));
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (activeShowId) load(activeShowId);
  }, [activeShowId]);

  const postAction = async (body) => {
    const response = await fetch('/api/scenes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) {
      setStatus(data.error || 'Scene action failed');
      return;
    }
    setStatus('Updated');
    await load(activeShowId);
  };

  const addShow = async () => {
    if (!newShow.titleZh.trim()) return;
    await postAction({ action: 'add-show', ...newShow });
    setNewShow({ titleZh: '', titleEn: '', kind: 'drama', sourceHint: '' });
  };

  return (
    <section className={styles.tableCard}>
      <div className={styles.cardHeader}>
        <h3>Scene Repository</h3>
        {status && <span className={styles.globalStatus}>{status}</span>}
      </div>
      <div className={styles.panelBody}>
        <div className={styles.formGrid}>
          <input className={styles.input} placeholder="Show title" value={newShow.titleZh} onChange={(event) => setNewShow((prev) => ({ ...prev, titleZh: event.target.value }))} />
          <input className={styles.input} placeholder="English title" value={newShow.titleEn} onChange={(event) => setNewShow((prev) => ({ ...prev, titleEn: event.target.value }))} />
          <select className={styles.select} value={newShow.kind} onChange={(event) => setNewShow((prev) => ({ ...prev, kind: event.target.value }))}>
            <option value="drama">Drama</option>
            <option value="movie">Movie</option>
            <option value="variety">Variety</option>
            <option value="anime">Anime</option>
          </select>
          <input className={styles.input} placeholder="Source hint" value={newShow.sourceHint} onChange={(event) => setNewShow((prev) => ({ ...prev, sourceHint: event.target.value }))} />
        </div>
        <div className={styles.operationRow}>
          <button className={styles.buttonPrimary} onClick={addShow}>Add Show</button>
          <button className={styles.buttonSecondary} onClick={() => postAction({ action: 'scrape', showId: Number(activeShowId) })} disabled={!activeShowId}>Scrape</button>
          <button className={styles.buttonSecondary} onClick={() => postAction({ action: 'analyze', showId: Number(activeShowId) })} disabled={!activeShowId}>Analyze</button>
        </div>
        <div className={styles.formGrid}>
          <select className={styles.select} value={activeShowId} onChange={(event) => setActiveShowId(event.target.value)}>
            <option value="">Select show</option>
            {shows.map((show) => <option key={show.id} value={show.id}>{show.titleZh}</option>)}
          </select>
        </div>
        <div className={styles.jobList}>
          {candidates.map((candidate) => (
            <article key={candidate.id} className={styles.jobRow}>
              <div className={styles.jobTopLine}>
                <strong>{candidate.title}</strong>
                <span className={`${styles.statusLabel} ${styles[candidate.status] || ''}`}>{candidate.status}</span>
              </div>
              <div className={styles.jobSource}>Heat {candidate.heatScore} · {candidate.whyHot}</div>
              <div className={styles.operationRow}>
                <button className={styles.saveBtn} onClick={() => postAction({ action: 'approve', candidateId: candidate.id })}>Approve</button>
                <button className={styles.editBtn} onClick={() => postAction({ action: 'reject', candidateId: candidate.id })}>Reject</button>
              </div>
            </article>
          ))}
          {activeShowId && candidates.length === 0 && <div className={styles.muted}>No candidates saved for this show yet.</div>}
        </div>
      </div>
    </section>
  );
}
