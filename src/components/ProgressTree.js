'use client';

/**
 * ProgressTree — n8n / HuggingFace-style vertical run tree for a pipeline job.
 * Renders each step as a connected node with a live status icon, progress bar,
 * current note, timing, and an expandable log. Pure presentational: give it a
 * `job` (from /api/pipeline/jobs) and it renders.
 */

import { useState } from 'react';
import styles from '../app/page.module.css';

const ROLE_LABEL = { source: 'Source', processor: 'Process', uploader: 'Upload' };
const ID_LABEL = {
  bilibili: 'Bilibili', douyin: 'Douyin',
  voiceover: 'AI Voiceover', faceFusion: 'Face Fusion', aiEditor: 'AI Editor', sceneCut: 'Scene Cut',
  youtube: 'YouTube',
};

function humanize(stepName) {
  const [role, id] = String(stepName || '').split(':');
  return { role: ROLE_LABEL[role] || role, name: ID_LABEL[id] || id || stepName };
}

function nodeStateClass(status) {
  switch (status) {
    case 'ok': return styles.nodeOk;
    case 'running': return styles.nodeRunning;
    case 'failed': return styles.nodeFail;
    case 'skipped': return styles.nodeSkipped;
    default: return styles.nodePending;
  }
}

function NodeIcon({ status }) {
  if (status === 'running') return <span className={styles.spinner} aria-label="running" />;
  const glyph = status === 'ok' ? '✓' : status === 'failed' ? '✕' : status === 'skipped' ? '–' : '';
  return <span className={styles.nodeGlyph}>{glyph}</span>;
}

function duration(step) {
  if (!step.startedAt) return null;
  const end = step.finishedAt ? new Date(step.finishedAt) : new Date();
  const secs = Math.max(0, Math.round((end - new Date(step.startedAt)) / 1000));
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

function StepNode({ step, isLast }) {
  const [open, setOpen] = useState(false);
  const { role, name } = humanize(step.step);
  const pct = Math.max(0, Math.min(100, Math.round(step.progress || 0)));
  const hasLog = Boolean(step.log && step.log.trim());
  const dur = duration(step);

  return (
    <div className={styles.treeNode}>
      <div className={styles.treeRail}>
        <span className={`${styles.nodeIcon} ${nodeStateClass(step.status)}`}><NodeIcon status={step.status} /></span>
        {!isLast && <span className={styles.treeConnector} />}
      </div>
      <div className={styles.nodeBody}>
        <div className={styles.nodeLabel}>
          <span className={styles.nodeRole}>{role}</span>
          <strong>{name}</strong>
          <span className={styles.nodeMeta}>
            {step.status === 'running' ? `${pct}%` : step.status}
            {dur ? ` · ${dur}` : ''}
          </span>
        </div>
        {(step.status === 'running' || (pct > 0 && pct < 100)) && (
          <div className={styles.progressTrack}>
            <div className={styles.progressFill} style={{ width: `${pct}%` }} />
          </div>
        )}
        {step.progressNote && <div className={styles.stepNote}>{step.progressNote}</div>}
        {hasLog && (
          <button className={styles.logToggle} onClick={() => setOpen((v) => !v)}>
            {open ? '▾ hide log' : '▸ log'}
          </button>
        )}
        {open && hasLog && <pre className={styles.logBox}>{step.log.trim().split('\n').slice(-40).join('\n')}</pre>}
      </div>
    </div>
  );
}

export default function ProgressTree({ job }) {
  if (!job) return null;
  const steps = job.steps || [];
  const done = steps.filter((s) => s.status === 'ok').length;
  const overall = steps.length ? Math.round((done / steps.length) * 100) : 0;

  return (
    <div className={styles.tree}>
      <div className={styles.treeSummary}>
        <span className={`${styles.statusLabel} ${styles[job.status] || ''}`}>{job.status}</span>
        <span className={styles.nodeMeta}>{done}/{steps.length} steps · {overall}%</span>
      </div>
      {steps.map((step, i) => (
        <StepNode key={step.id} step={step} isLast={i === steps.length - 1} />
      ))}
    </div>
  );
}
