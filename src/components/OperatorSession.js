'use client';
import { useEffect, useState } from 'react';
import styles from '../app/page.module.css';

export default function OperatorSession({ children }) {
  const [ready, setReady] = useState(false);
  const [required, setRequired] = useState(false);
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    async function restoreSession() {
      try {
        const response = await fetch('/api/auth/session', { cache: 'no-store' });
        if (!response.ok) throw new Error('Unable to check operator session.');
        const data = await response.json();
        if (data.required && !data.authenticated && data.localPairing) {
          const paired = await fetch('/api/auth/session', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'pair-local' }),
          });
          if (!paired.ok) throw new Error('Unable to restore local access. Reload to retry.');
          data.authenticated = true;
        }
        if (!cancelled) { setRequired(data.required && !data.authenticated); setReady(true); }
      } catch (failure) { if (!cancelled) setError(failure.message); }
    }
    restoreSession();
    return () => { cancelled = true; };
  }, []);
  if (ready && !required) return children;
  return <main className={styles.panelBody} style={{ maxWidth: 520, margin: '12vh auto', padding: 24 }}>
    <h1>{required ? 'VideoOps remote access' : 'Opening VideoOps'}</h1>
    {required && <p>Local access connects automatically. For a network connection, enter your operator token once; this browser remembers it for 30 days.</p>}
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
