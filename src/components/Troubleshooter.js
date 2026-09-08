'use client';

import { useEffect, useState } from 'react';
import styles from '../app/page.module.css';

export default function Troubleshooter({ onNavigate = () => {} }) {
  const [checks, setChecks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadChecks = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/control/pipeline/diagnostics', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Diagnostics failed');
      setChecks(data.checks || []);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadChecks();
  }, []);

  const refreshConnectionHealth = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/control/pipeline/diagnostics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'refresh' }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not refresh connection health');
      setChecks(data.checks || []);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className={styles.tableCard}>
      <div className={styles.cardHeader}>
        <h3>Troubleshooter</h3>
        <button className={styles.buttonSecondary} onClick={refreshConnectionHealth} disabled={loading}>
          {loading ? 'Checking...' : 'Refresh connections'}
        </button>
      </div>
      <div className={styles.panelBody}>
        {error && <div className={styles.errorText}>{error}</div>}
        <div className={styles.jobList}>
          {checks.map((check) => (
            <article key={check.id} className={styles.checkItem}>
              <div className={styles.jobTopLine}>
                <strong>
                  <span className={`${styles.checkDot} ${styles[`check_${check.status}`]}`} />
                  {check.label}
                </strong>
                <span className={`${styles.statusLabel} ${styles[check.status] || ''}`}>{check.status}</span>
              </div>
              <div className={styles.jobSource}>{check.detail}</div>
              {(check.nextStep || check.fixHint) && <div className={styles.stepNote}>{check.nextStep || check.fixHint}</div>}
              {check.action?.type === 'goto' && <button type="button" className={styles.buttonSecondary} onClick={() => onNavigate(check.action.view, check.action.target)}>{check.category === 'authorization_expired' ? 'Fix authorization' : 'Open fix'}</button>}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
