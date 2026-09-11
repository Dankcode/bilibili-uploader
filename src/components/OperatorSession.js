'use client';
import { useEffect, useState } from 'react';
import styles from '../app/page.module.css';

export default function OperatorSession({ children }) {
  const [ready, setReady] = useState(false);
  const [required, setRequired] = useState(false);
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    fetch('/api/auth/session', { cache: 'no-store' }).then((response) => response.json()).then((data) => {
      setRequired(data.required && !data.authenticated); setReady(true);
    }).catch(() => setError('Unable to check operator session. Reload to retry.'));
  }, []);
  if (ready && !required) return children;
  return <main className={styles.panelBody} style={{ maxWidth: 520, margin: '12vh auto', padding: 24 }}>
    <h1>VideoOps operator sign-in</h1>
    <p>The MCP bridge uses a separate agent credential. Use your operator token to manage tasks and approve publishing.</p>
    {required && <form onSubmit={async (event) => {
      event.preventDefault(); setError('');
      try {
        const response = await fetch('/api/auth/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
        if (!response.ok) throw new Error((await response.json()).error || 'Unable to sign in');
        setToken(''); setRequired(false);
      } catch (failure) { setError(failure.message); }
    }}><label className={styles.formField}><span>Operator token</span><input type="password" autoComplete="current-password" required value={token} onChange={(event) => setToken(event.target.value)} /></label><button className={styles.buttonPrimary} type="submit" style={{ marginTop: 12 }}>Sign in</button></form>}
    {!ready && !error && <p>Checking session…</p>}
    {error && <p role="alert">{error}</p>}
  </main>;
}
