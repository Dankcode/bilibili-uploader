'use client';

/**
 * PUBLISH — minimal release-layer view (phase 0).
 *
 * An invisible governor is worse than no governor: a job that silently waits
 * until midnight Pacific looks exactly like a stuck worker. This view shows the
 * three things the release layer decides — how much budget is left, what is
 * being held and until when, and which upload attempts are unconfirmed.
 *
 * Chips encode state in SHAPE as well as colour: filled = confirmed,
 * outlined = queued, dashed = held for budget, solid red = failed.
 */
import { useCallback, useEffect, useState } from 'react';
import styles from '../app/page.module.css';

function formatWhen(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function relative(value) {
  const ms = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(ms)) return '';
  const minutes = Math.round(Math.abs(ms) / 60000);
  const text = minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  return ms >= 0 ? `in ${text}` : `${text} ago`;
}

const RECEIPT_CHIP = {
  confirmed: [styles.releaseChipFilled, 'Published'],
  sent: [styles.releaseChipAttention, 'Unconfirmed'],
  claimed: [styles.releaseChipAttention, 'Claimed'],
  failed: [styles.releaseChipFailed, 'Refused'],
  abandoned: [styles.releaseChipOutlined, 'Never arrived'],
};

function BudgetMeter({ budget }) {
  const ratio = budget.dailyUnits ? Math.min(1, budget.usedUnits / budget.dailyUnits) : 0;
  return <article className={styles.releaseBudget} aria-label={`${budget.label} budget for ${budget.accountRef}`}>
    <header><strong>{budget.label}</strong><span>{budget.accountRef}</span></header>
    <div className={styles.releaseMeter} role="meter" aria-valuemin={0} aria-valuemax={budget.dailyUnits} aria-valuenow={budget.usedUnits}>
      <i style={{ width: `${Math.round(ratio * 100)}%` }} className={ratio >= 1 ? styles.releaseMeterFull : ''} />
    </div>
    <p>
      <b>{budget.uploadsRemaining ?? '—'}</b> upload{budget.uploadsRemaining === 1 ? '' : 's'} left today
      · {budget.usedUnits.toLocaleString()} / {budget.dailyUnits.toLocaleString()} units
    </p>
    <small>Resets {budget.resetLabel} ({relative(budget.resetAt)})</small>
  </article>;
}

function ReceiptActions({ receipt, busy, onResolve }) {
  const [url, setUrl] = useState('');
  if (!['sent', 'claimed'].includes(receipt.state)) return null;
  return <div className={styles.releaseResolve}>
    <p>This attempt left the machine but was never confirmed. Check the channel, then settle it so a retry does the right thing.</p>
    <div>
      <input type="text" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="Paste the video URL if it is on the channel" aria-label={`Video URL for receipt ${receipt.id}`} />
      <button type="button" className={styles.buttonSecondary} disabled={busy || !url.trim()} title={url.trim() ? '' : 'Paste the video URL first'} onClick={() => onResolve(receipt.id, 'confirm', url)}>It uploaded</button>
      <button type="button" className={styles.buttonSecondary} disabled={busy} onClick={() => onResolve(receipt.id, 'abandon')}>It never arrived</button>
    </div>
  </div>;
}

function StudioCard({ status }) {
  return <article className={styles.releaseBudget} aria-label="Studio screen uploader">
    <header><strong>Studio screen uploader</strong><span className={status.ok ? styles.releaseChipFilled : styles.releaseChipOutlined}>{status.ok ? 'Calibrated' : 'Not calibrated'}</span></header>
    <p>
      {status.ok
        ? `${status.ready.length} screen templates captured${status.channelCheck ? ', channel check on.' : '. Capture channel_badge so uploads refuse the wrong channel.'}`
        : `Capture ${status.missingRequired.length} more screen template${status.missingRequired.length === 1 ? '' : 's'} on the upload machine before using the Studio method.`}
    </p>
    {!status.ok && status.missingRequired.length > 0 && <small>Missing: {status.missingRequired.join(', ')}</small>}
    <small>Capture or re-capture: <code>{status.calibrateCommand}</code></small>
  </article>;
}

export default function PublishCenter() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/control/pipeline/release', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not load the release layer');
      setData(payload);
      setError('');
    } catch (failure) {
      setError(failure.message);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, [load]);

  async function resolve(receiptId, resolution, url = '') {
    setBusy(true);
    try {
      const response = await fetch('/api/control/pipeline/release', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'resolveReceipt', receiptId, resolution, url }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not resolve the receipt');
      await load();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  const held = (data?.queue || []).filter((item) => item.held);
  const waiting = (data?.queue || []).filter((item) => !item.held);

  return <section className={styles.releaseView} aria-label="Publish">
    <div className={styles.cardHeader}>
      <h2>Publish</h2>
      <button type="button" className={styles.buttonSecondary} onClick={load}>Refresh</button>
    </div>
    {error && <p role="alert" className={styles.releaseError}>{error}</p>}
    {!data && !error && <p>Loading release state…</p>}

    {data && <>
      <h3 className={styles.releaseHeading}>Budget</h3>
      <div className={styles.releaseBudgets}>
        {data.budgets.length
          ? data.budgets.map((budget) => <BudgetMeter key={`${budget.destinationId}:${budget.accountRef}`} budget={budget} />)
          : <p>No budgeted destinations. The guided Studio uploader does not use API quota.</p>}
      </div>

      {data.studio && <StudioCard status={data.studio} />}

      <h3 className={styles.releaseHeading}>Release queue <span>{held.length} held · {waiting.length} waiting</span></h3>
      {!data.queue.length && <p>No upload steps are waiting.</p>}
      <ul className={styles.releaseList}>
        {[...held, ...waiting].map((item) => <li key={item.stepId}>
          <span className={item.held ? styles.releaseChipHeld : styles.releaseChipOutlined}>{item.held ? 'Held' : item.status === 'review' ? 'In review' : 'Queued'}</span>
          <div>
            <strong>{item.title || `Job ${item.jobId}`}</strong>
            <small>Job {item.jobId} · {item.destinationId} · attempt {item.attempt}</small>
            {item.held && <small>{item.deferReason} Next eligible {formatWhen(item.nextEligibleAt)} ({relative(item.nextEligibleAt)}).</small>}
          </div>
        </li>)}
      </ul>

      <h3 className={styles.releaseHeading}>Receipts {data.needsAttention > 0 && <span className={styles.releaseChipAttention}>{data.needsAttention} need you</span>}</h3>
      {!data.receipts.length && <p>No upload attempts recorded yet.</p>}
      <ul className={styles.releaseList}>
        {data.receipts.map((receipt) => {
          const [chipClass, chipLabel] = RECEIPT_CHIP[receipt.state] || [styles.releaseChipOutlined, receipt.state];
          return <li key={receipt.id}>
            <span className={chipClass}>{chipLabel}</span>
            <div>
              <strong>{receipt.title || receipt.videoTitle || `Job ${receipt.jobId}`}</strong>
              <small>
                Receipt #{receipt.id} · job {receipt.jobId} · {receipt.destinationId} · {receipt.units ? `${receipt.units} units · ` : ''}
                {receipt.sentAt ? `sent ${formatWhen(receipt.sentAt)}` : `created ${formatWhen(receipt.createdAt)}`}
                {receipt.resolvedBy ? ` · settled by ${receipt.resolvedBy}` : ''}
              </small>
              {receipt.url && <small><a href={receipt.url} target="_blank" rel="noreferrer">{receipt.url}</a></small>}
              {receipt.lastError && <small className={styles.releaseError}>{receipt.lastError.slice(0, 300)}</small>}
              <ReceiptActions receipt={receipt} busy={busy} onResolve={resolve} />
            </div>
          </li>;
        })}
      </ul>
    </>}
  </section>;
}
