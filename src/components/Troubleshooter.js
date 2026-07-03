'use client';

import { useEffect, useState } from 'react';
import styles from '../app/page.module.css';

export default function Troubleshooter() {
  const [checks, setChecks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const runChecks = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/pipeline/diagnostics', { cache: 'no-store' });
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
    runChecks();
  }, []);

  return (
    <section className={styles.tableCard}>
      <div className={styles.cardHeader}>
        <h3>Troubleshooter</h3>
        <button className={styles.buttonSecondary} onClick={runChecks} disabled={loading}>
          {loading ? 'Checking...' : 'Re-run Checks'}
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
              {check.fixHint && <div className={styles.stepNote}>{check.fixHint}</div>}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
