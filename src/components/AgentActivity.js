'use client';
import { useCallback, useEffect, useState } from 'react';
import styles from '../app/page.module.css';
export default function AgentActivity() {
  const [items, setItems] = useState([]); const [next, setNext] = useState(null);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [enabled, setEnabled] = useState(false);
  const load = useCallback(async (cursor = '') => {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/control/operations/agent-actions?cursor=${cursor || '0'}`, { cache: 'no-store' });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Unable to load activity');
      setItems((previous) => cursor ? [...previous, ...data.items] : data.items); setNext(data.nextCursor); setEnabled(data.enabled);
    } catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  return <section aria-label="MCP agent activity" className={styles.panelBody} style={{ maxWidth: 1000 }}>
    <div className={styles.cardHeader}><h2>MCP agent activity</h2><button className={styles.buttonSecondary} onClick={() => load()} disabled={busy}>Refresh activity</button></div>
    <p>{enabled ? 'Bridge configured. Agents stage work; operators approve publishing.' : 'Bridge not configured. Run npm run mcp:setup on the backend, then connect your MCP client.'}</p>
    {error && <p role="alert">{error}</p>}
    {!items.length && !busy && <p>No agent changes recorded yet.</p>}
    {items.map((item) => <article key={item.id} style={{ borderBottom: '1px solid var(--border)', padding: '12px 0' }}>
      <strong>{item.tool}</strong> · <time>{new Date(item.createdAt).toLocaleString()}</time> · {item.principal}
      <details><summary>Arguments and result</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify({ arguments: item.arguments, result: item.result }, null, 2)}</pre></details>
    </article>)}
    {next && <button className={styles.buttonSecondary} disabled={busy} onClick={() => load(next)}>Load older activity</button>}
  </section>;
}
