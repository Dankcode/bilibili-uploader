'use client';

import { useEffect, useState } from 'react';
import styles from '../app/page.module.css';

export default function ScraperLogin({ siteId = 'weibo', siteLabel = 'site', onDone }) {
  const [loggedIn, setLoggedIn] = useState(false);
  const [cookieOrState, setCookieOrState] = useState('');
  const [status, setStatus] = useState('');

  const postAction = async (body) => {
    const response = await fetch('/api/control/scenes/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) {
      setStatus(data.error || 'Login action failed');
      return data;
    }
    return data;
  };

  const refresh = async () => {
    const data = await postAction({ action: 'status', siteId });
    setLoggedIn(Boolean(data?.loggedIn));
  };

  useEffect(() => {
    refresh();
  }, [siteId]);

  const importCookie = async () => {
    const data = await postAction({ action: 'import-cookie', siteId, cookieOrState });
    if (data?.ok) {
      setCookieOrState('');
      setStatus('Cookie state imported');
      setLoggedIn(true);
      onDone?.();
    }
  };

  return (
    <section className={styles.tableCard}>
      <div className={styles.cardHeader}>
        <h3>{siteLabel} Login</h3>
        <span className={`${styles.statusLabel} ${loggedIn ? styles.ok : styles.warn}`}>{loggedIn ? 'ready' : 'not logged in'}</span>
      </div>
      <div className={styles.panelBody}>
        <textarea
          className={styles.textarea}
          value={cookieOrState}
          onChange={(event) => setCookieOrState(event.target.value)}
          placeholder="Paste cookie string or storageState JSON"
          rows={5}
        />
        <div className={styles.operationRow}>
          <button className={styles.buttonPrimary} onClick={importCookie}>Import Cookie</button>
          <button className={styles.buttonSecondary} onClick={() => postAction({ action: 'start', siteId })}>Open Login Window</button>
        </div>
        {status && <div className={styles.stepNote}>{status}</div>}
      </div>
    </section>
  );
}
