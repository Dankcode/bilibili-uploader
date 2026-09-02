'use client';

import { useMemo } from 'react';
import styles from '../../app/page.module.css';

const ROLE = { source: 'SOURCE', processor: 'PROCESS', uploader: 'UPLOAD', gate: 'REVIEW' };
const GLYPH = { ok: '✓', failed: '✕', skipped: '–', running: '⏵', review: '!' };

function duration(node) {
  if (!node.startedAt) return '';
  const end = node.finishedAt ? new Date(node.finishedAt) : new Date();
  const seconds = Math.max(0, Math.round((end - new Date(node.startedAt)) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export default function ProcessNode({ node, index, total, selected, onSelect }) {
  const pct = Math.max(0, Math.min(100, Math.round(node.progress || 0)));
  const metrics = useMemo(() => Object.entries(node.metrics || {}).filter(([, value]) => value !== 0 && value !== false).slice(0, 2), [node.metrics]);
  const state = `processNode${node.status[0]?.toUpperCase()}${node.status.slice(1)}`;
  const accessibleName = `Step ${index + 1} of ${total}, ${node.label}, ${node.status}, ${pct} percent`;
  return (
    <button
      type="button"
      role="listitem"
      className={`${styles.processNode} ${styles[state] || ''} ${selected ? styles.processNodeSelected : ''}`}
      aria-label={accessibleName}
      onClick={() => onSelect(node.id)}
    >
      <span className={styles.processNodeRole}>{ROLE[node.role] || node.role}</span>
      <strong>{node.label}</strong>
      <span className={styles.processNodeState}><i>{GLYPH[node.status] || '·'}</i>{node.status}{duration(node) ? ` · ${duration(node)}` : ''}</span>
      {metrics.length ? <span className={styles.processNodeMetrics}>{metrics.map(([key, value]) => `${key.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)} ${value}`).join(' · ')}</span> : null}
      {node.status === 'failed' && node.error ? <span className={styles.processNodeError}>{node.error}</span> : null}
      {node.status === 'running' ? <span className={styles.processNodeProgress} role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={pct}><i style={{ width: `${pct}%` }} /></span> : null}
    </button>
  );
}
