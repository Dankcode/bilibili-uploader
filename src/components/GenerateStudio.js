'use client';

/**
 * GenerateStudio — one-click "Generate" for the full automated pipeline.
 * Builds a preset job (source → voiceover → faceFusion → youtube, private-first)
 * and shows a live n8n-style ProgressTree of the run. Minimal interference:
 * per-step options come from the saved connection defaults, so a single click
 * runs the whole chain.
 */

import { useEffect, useMemo, useState } from 'react';
import styles from '../app/page.module.css';
import ProgressTree from './ProgressTree';

const SOURCES = [
  { id: 'bilibili', label: 'Bilibili' },
  { id: 'douyin', label: 'Douyin' },
];

const STATUS_COLOR = {
  done: 'var(--ok)', ok: 'var(--ok)',
  running: 'var(--running)', queued: 'var(--idle)',
  failed: 'var(--danger)', canceled: 'var(--idle)', skipped: 'var(--idle)',
};

// The optional, ordered processor chain for a generate run.
const CHAIN = [
  { id: 'voiceover', label: 'AI Voiceover', hint: 'transcribe → translate → Kimi re-script → TTS' },
  { id: 'faceFusion', label: 'Face Fusion', hint: 'automated targeted face swap' },
];

export default function GenerateStudio({ defaultSourceInput = '' }) {
  const [connections, setConnections] = useState([]);
  const [sourceId, setSourceId] = useState('bilibili');
  const [sourceInput, setSourceInput] = useState(defaultSourceInput);
  const [steps, setSteps] = useState({ voiceover: true, faceFusion: true });
  const [publish, setPublish] = useState(true);
  const [jobs, setJobs] = useState([]);
  const [activeJobId, setActiveJobId] = useState(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [preflight, setPreflight] = useState(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => { setSourceInput((v) => v || defaultSourceInput); }, [defaultSourceInput]);

  const loadConnections = async () => {
    const res = await fetch('/api/settings/connections', { cache: 'no-store' });
    const data = await res.json();
    if (res.ok) setConnections(data.checklist || []);
  };

  const loadJobs = async () => {
    const res = await fetch('/api/pipeline/jobs?limit=20', { cache: 'no-store' });
    const data = await res.json();
    if (res.ok) {
      setJobs(data.jobs || []);
      // Follow the newest job if we haven't pinned one.
      setActiveJobId((cur) => cur ?? (data.jobs?.[0]?.id ?? null));
    }
  };

  useEffect(() => {
    loadConnections();
    loadJobs();
    const t = setInterval(() => { if (!document.hidden) loadJobs(); }, 2000);
    return () => clearInterval(t);
  }, []);

  const statusOf = (id) => connections.find((c) => c.id === id) || {};
  const activeJob = useMemo(() => jobs.find((j) => j.id === activeJobId) || jobs[0] || null, [jobs, activeJobId]);

  const plannedSteps = () => ({
    sourceId,
    processorIds: CHAIN.filter((c) => steps[c.id]).map((c) => c.id),
    uploaderId: publish ? 'youtube' : '',
  });

  const runPreflight = async () => {
    setError('');
    setChecking(true);
    try {
      const res = await fetch('/api/pipeline/diagnostics', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ steps: plannedSteps() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Preflight failed');
      setPreflight(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setChecking(false);
    }
  };

  // Re-checking is required whenever the chain changes.
  useEffect(() => { setPreflight(null); }, [sourceId, steps.voiceover, steps.faceFusion, publish]);

  const generate = async () => {
    setError('');
    if (!sourceInput.trim()) { setError('Enter a source video URL or ID first.'); return; }
    const processorIds = CHAIN.filter((c) => steps[c.id]).map((c) => c.id);
    const body = {
      action: 'create',
      sourceId,
      sourceInput: sourceInput.trim(),
      processorIds,
      uploaderId: publish ? 'youtube' : '',
      // Private-first publish; all other per-step options fall back to saved
      // connection defaults so this stays one-click.
      options: publish ? { youtube: { privacyStatus: 'private' } } : {},
    };
    setSubmitting(true);
    try {
      const res = await fetch('/api/pipeline/jobs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create job');
      setActiveJobId(data.job.id);
      await loadJobs();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const jobAction = async (action, jobId) => {
    await fetch('/api/pipeline/jobs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, jobId }),
    });
    loadJobs();
  };

  return (
    <div className={styles.generateGrid}>
      {/* ---- Left: the one-click console ---- */}
      <section className={styles.tableCard}>
        <div className={styles.cardHeader}><h3>Generate</h3></div>
        <div className={styles.panelBody}>
          <div className={styles.formStack}>
            <label className={styles.fieldLabel}>Source</label>
            <div className={styles.filterBar}>
              {SOURCES.map((s) => (
                <button key={s.id}
                  className={`${styles.filterChip} ${sourceId === s.id ? styles.activeFilterChip : ''}`}
                  onClick={() => setSourceId(s.id)}>{s.label}</button>
              ))}
            </div>

            <label className={styles.fieldLabel}>Video URL or ID</label>
            <input className={styles.input} value={sourceInput} placeholder="Paste a video URL / space ID"
              onChange={(e) => setSourceInput(e.target.value)} />

            <label className={styles.fieldLabel}>Pipeline steps</label>
            <div className={styles.stepToggles}>
              {CHAIN.map((c) => {
                const st = statusOf(c.id);
                return (
                  <label key={c.id} className={styles.toggleRow}>
                    <input type="checkbox" checked={steps[c.id]}
                      onChange={(e) => setSteps((p) => ({ ...p, [c.id]: e.target.checked }))} />
                    <span className={styles.toggleMain}>
                      <strong>{c.label}</strong>
                      <span className={styles.muted}>{c.hint}</span>
                    </span>
                    <span className={`${styles.pillState} ${st.enabled ? styles.pillOk : st.configured ? styles.pillWarn : styles.pillOff}`}>
                      {st.enabled ? 'ready' : st.configured ? 'not tested' : 'not configured'}
                    </span>
                  </label>
                );
              })}
              <label className={styles.toggleRow}>
                <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} />
                <span className={styles.toggleMain}>
                  <strong>Publish to YouTube</strong>
                  <span className={styles.muted}>uploaded private-first for review</span>
                </span>
              </label>
            </div>

            {/* Preflight — inspect & test every step before full automation */}
            <div className={styles.preflightHead}>
              <span className={styles.fieldLabel}>Preflight</span>
              <button className={styles.editBtn} onClick={runPreflight} disabled={checking}>
                {checking ? 'Checking…' : 'Check steps'}
              </button>
            </div>
            {preflight && (
              <div className={styles.preflightList}>
                <div className={`${styles.preflightBanner} ${preflight.ready ? styles.pfReady : styles.pfBlocked}`}>
                  {preflight.ready ? '✓ All steps ready — safe to automate' : '✕ Some steps need attention before automation'}
                </div>
                {preflight.steps.map((c, i) => (
                  <div key={`${c.id}-${i}`} className={styles.checkItem}>
                    <div className={styles.jobTopLine}>
                      <strong>
                        <span className={`${styles.checkDot} ${styles[`check_${c.status}`] || ''}`} />
                        {c.label}
                      </strong>
                      <span className={`${styles.statusLabel} ${styles[c.status] || ''}`}>{c.status}</span>
                    </div>
                    <div className={styles.jobSource}>{c.detail}</div>
                    {c.status !== 'ok' && c.fixHint && <div className={styles.stepNote}>{c.fixHint}</div>}
                  </div>
                ))}
              </div>
            )}

            {error && <div className={styles.errorText}>{error}</div>}
            <button className={styles.generateBtn} onClick={generate} disabled={submitting}>
              {submitting ? 'Starting…' : preflight && !preflight.ready ? '⚡ Generate anyway' : '⚡ Generate'}
            </button>
            {!preflight && <div className={styles.muted}>Tip: run “Check steps” first to verify the pipeline before automating.</div>}
          </div>
        </div>
      </section>

      {/* ---- Right: the live run tree ---- */}
      <section className={styles.tableCard}>
        <div className={styles.cardHeader}>
          <h3>Run {activeJob ? `#${activeJob.id}` : ''}</h3>
          {activeJob && (
            <div className={styles.operationRow}>
              {activeJob.status === 'failed' && <button className={styles.saveBtn} onClick={() => jobAction('retry', activeJob.id)}>Retry</button>}
              {(activeJob.status === 'queued' || activeJob.status === 'running') && <button className={styles.editBtn} onClick={() => jobAction('cancel', activeJob.id)}>Cancel</button>}
            </div>
          )}
        </div>
        <div className={styles.panelBody}>
          {!activeJob && <div className={styles.muted}>No runs yet. Hit Generate to start the pipeline.</div>}
          {activeJob && (
            <>
              <div className={styles.jobSource}>{activeJob.sourceId} · {activeJob.sourceInput}</div>
              {activeJob.error && <div className={styles.errorText}>{activeJob.error}</div>}
              <ProgressTree job={activeJob} />
            </>
          )}
          {jobs.length > 1 && (
            <div className={styles.recentRuns}>
              <div className={styles.fieldLabel}>Recent runs</div>
              {jobs.slice(0, 8).map((j) => (
                <button key={j.id}
                  className={`${styles.runChip} ${activeJobId === j.id ? styles.activeFilterChip : ''}`}
                  onClick={() => setActiveJobId(j.id)}>
                  #{j.id} <span className={styles.dotState} style={{ background: STATUS_COLOR[j.status] || 'var(--idle)' }} /> {j.status}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
