'use client';

import { useEffect, useState } from 'react';
import { Copy, ExternalLink, X } from 'lucide-react';
import CorrectionsReview from './CorrectionsReview';
import styles from '../../app/page.module.css';

export default function NodeInspector({ node, videoId, jobId, canApproveCorrections, onClose, onRefresh }) {
  const [log, setLog] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!node?.hasLog || !node.stepId) { setLog(''); return; }
    fetch(`/api/control/operations/videos/${videoId}/process/steps/${node.stepId}/log`, { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('Could not load the step log.')))
      .then((payload) => setLog(payload.log || ''))
      .catch((loadError) => setError(loadError.message));
  }, [node, videoId]);
  if (!node) return null;
  const copy = (value) => navigator.clipboard?.writeText(String(value || '')).catch(() => {});
  return <aside className={styles.nodeInspector} aria-label={`${node.label} details`}>
    <div className={styles.nodeInspectorHeader}><div><span className={styles.eyebrow}>{node.role}</span><h2>{node.label}</h2></div><button className={styles.iconButton} type="button" onClick={onClose} aria-label="Close step details"><X size={16} /></button></div>
    <dl className={styles.inspectorFacts}><div><dt>Status</dt><dd>{node.status}</dd></div><div><dt>Progress</dt><dd>{Math.round(node.progress || 0)}% {node.progressNote}</dd></div><div><dt>Step ID</dt><dd><button type="button" onClick={() => copy(node.stepId)}>{node.stepId}<Copy size={12} /></button></dd></div></dl>
    {Object.keys(node.metrics || {}).length ? <div className={styles.inspectorMetrics}>{Object.entries(node.metrics).map(([key, value]) => <span key={key}>{key}<strong>{String(value)}</strong></span>)}</div> : null}
    {node.assets?.length ? <div className={styles.inspectorAssets}><span className={styles.eyebrow}>Artifacts</span>{node.assets.map((asset) => <a href={asset.href} target="_blank" rel="noreferrer" key={asset.id}>{asset.kind}<ExternalLink size={12} /></a>)}</div> : null}
    {canApproveCorrections && node.adapterId === 'ocrContext' ? <CorrectionsReview node={node} jobId={jobId} onApproved={onRefresh} /> : null}
    {error ? <p className={styles.rowError}>{error}</p> : null}
    {log ? <pre className={styles.inspectorLog}>{log.split('\n').slice(-80).join('\n')}</pre> : null}
  </aside>;
}
