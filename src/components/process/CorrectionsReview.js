'use client';

import { useEffect, useState } from 'react';
import styles from '../../app/page.module.css';

export default function CorrectionsReview({ node, jobId, onApproved }) {
  const [corrections, setCorrections] = useState([]);
  const [accepted, setAccepted] = useState(new Set());
  const [error, setError] = useState('');
  useEffect(() => {
    const asset = node?.assets?.find((item) => item.kind === 'corrections');
    if (!asset) return;
    fetch(asset.href, { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('Could not load corrections.')))
      .then((items) => { setCorrections(items); setAccepted(new Set(items.map((item) => Number(item.index)))); })
      .catch((loadError) => setError(loadError.message));
  }, [node]);
  async function approve() {
    try {
      const response = await fetch('/api/control/pipeline/jobs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approveCorrections', jobId, corrections: { acceptedIndexes: [...accepted] } }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not approve corrections.');
      onApproved();
    } catch (submitError) { setError(submitError.message); }
  }
  if (!corrections.length && !error) return null;
  return <section className={styles.correctionsReview}><span className={styles.eyebrow}>Correction review</span>{error ? <p className={styles.rowError}>{error}</p> : corrections.map((item) => <label key={item.index}><input type="checkbox" checked={accepted.has(Number(item.index))} onChange={() => setAccepted((current) => { const next = new Set(current); if (next.has(Number(item.index))) next.delete(Number(item.index)); else next.add(Number(item.index)); return next; })} /><span><del>{item.before}</del><strong>{item.after}</strong></span></label>)}<button type="button" className={styles.buttonPrimary} onClick={approve}>Apply selected corrections</button></section>;
}
