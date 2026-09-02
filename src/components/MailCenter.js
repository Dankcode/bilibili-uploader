'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, RefreshCw } from 'lucide-react';
import styles from '../app/page.module.css';

export default function MailCenter() {
  const [filter, setFilter] = useState('unacknowledged');
  const [events, setEvents] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [message, setMessage] = useState('');
  const load = async () => {
    const query = filter === 'critical' ? '?severity=critical&unacknowledged=1' : filter === 'unmatched' ? '?unmatched=1' : filter === 'all' ? '' : '?unacknowledged=1';
    const [inbox, accountList] = await Promise.all([fetch(`/api/control/mail/inbox${query}`, { cache: 'no-store' }), fetch('/api/control/mail/accounts', { cache: 'no-store' })]);
    const inboxData = await inbox.json(); const accountData = await accountList.json();
    if (!inbox.ok) throw new Error(inboxData.error || 'Could not load mail inbox');
    setEvents(inboxData.events || []); setAccounts(accountData.accounts || []);
  };
  useEffect(() => { load().catch((error) => setMessage(error.message)); }, [filter]);
  async function acknowledge(id) { const response = await fetch(`/api/control/mail/inbox/${id}/ack`, { method: 'POST' }); if (!response.ok) { const data = await response.json(); setMessage(data.error || 'Could not acknowledge mail'); return; } load(); }
  async function sync(accountId) { setMessage('Syncing Gmail…'); const response = await fetch('/api/control/mail/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId }) }); const data = await response.json(); setMessage(response.ok ? `Synced ${data.synced} message(s).` : (data.error || 'Sync failed')); if (response.ok) load(); }
  return <section className={styles.automationView}>
    <div className={styles.opsPanelHeader}><div><span className={styles.eyebrow}>Mailbox evidence</span><h2>Mail inbox</h2></div><button type="button" className={styles.iconButton} onClick={() => load().catch((error) => setMessage(error.message))}><RefreshCw size={16} /></button></div>
    <div className={styles.operationRow}>{[['unacknowledged', 'Unacknowledged'], ['critical', 'Critical'], ['unmatched', 'Unmatched'], ['all', 'All']].map(([id, label]) => <button key={id} type="button" className={filter === id ? styles.buttonPrimary : styles.buttonSecondary} onClick={() => setFilter(id)}>{label}</button>)}{accounts.map((account) => <button key={account.id} type="button" className={styles.buttonSecondary} disabled={!account.enabled} onClick={() => sync(account.id)}>Sync {account.emailAddress}</button>)}</div>
    {message && <div className={styles.inlineNotice}>{message}</div>}
    <div className={styles.opsTableWrap}><table className={styles.opsTable}><thead><tr><th>Severity</th><th>Category</th><th>Video</th><th>Subject</th><th>Received</th><th /></tr></thead><tbody>{events.map((event) => <tr key={event.id}><td><span className={`${styles.statusPill} ${event.severity === 'critical' ? styles.statusDanger : event.severity === 'warn' ? styles.statusRunning : styles.statusOk}`}>{event.severity}</span></td><td>{event.category}</td><td>{event.videoTitle || 'Unmatched'}</td><td><strong>{event.subject || event.title}</strong><span>{event.snippet}</span></td><td>{event.receivedAt ? new Date(event.receivedAt).toLocaleString() : ''}</td><td>{!event.acknowledgedAt && <button type="button" className={styles.iconButton} onClick={() => acknowledge(event.id)} title="Acknowledge"><CheckCircle2 size={15} /></button>}</td></tr>)}{!events.length && <tr><td colSpan="6"><div className={styles.emptyTable}>No matching mail events.</div></td></tr>}</tbody></table></div>
  </section>;
}
