'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, BadgeCheck, LoaderCircle, RefreshCw } from 'lucide-react';
import styles from '../app/page.module.css';

function mediaUrl(kind, proof) {
  return `/api/control/operations/face-swap-proof?media=${kind}&v=${encodeURIComponent(proof?.completedAt || proof?.createdAt || '')}`;
}

function formatTime(milliseconds) {
  if (!milliseconds) return '0.0s';
  return `${(milliseconds / 1000).toFixed(1)}s`;
}

export default function FaceSwapProof() {
  const [proof, setProof] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function loadProof() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/control/operations/face-swap-proof', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not load the proof record');
      setProof(payload.proof || null);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadProof(); }, []);

  if (loading) return <div className={styles.loadingSurface}><LoaderCircle size={17} className={styles.spin} /> Loading proof</div>;
  if (error) return <div className={styles.inlineError}>{error}</div>;
  if (!proof) return <div className={styles.emptyRail}>No face-swap proof has been recorded.</div>;

  const passed = proof.status === 'passed';
  const checks = proof.validation?.checks || {};
  const fallbackReason = proof.validation?.fallbackReason || '';
  const result = proof.outputProbe || {};

  return (
    <div className={styles.proofView}>
      <section className={styles.opsPanel}>
        <div className={styles.opsPanelHeader}>
          <div><span className={styles.eyebrow}>Executable evidence</span><h2>Face-swap video proof</h2></div>
          <div className={styles.proofHeaderActions}>
            <span className={`${styles.statusPill} ${passed ? styles.statusOk : styles.statusDanger}`}>{proof.status}</span>
            <button type="button" className={styles.iconButton} onClick={loadProof} title="Reload proof" aria-label="Reload proof"><RefreshCw size={14} /></button>
          </div>
        </div>
        {fallbackReason && <div className={styles.proofNotice}><AlertTriangle size={15} /><span><strong>Neural runtime pending</strong>{fallbackReason}. This result uses the local YuNet geometric fallback.</span></div>}
        <div className={styles.proofMediaGrid}>
          <figure><div className={styles.proofImageFrame}><img src={mediaUrl('source', proof)} alt="Source face used by the proof" /></div><figcaption>Source identity</figcaption></figure>
          <figure><div className={styles.proofVideoFrame}><video src={mediaUrl('target', proof)} controls muted playsInline preload="metadata" /></div><figcaption>Original clip</figcaption></figure>
          <figure><div className={styles.proofVideoFrame}><video src={mediaUrl('output', proof)} controls muted playsInline preload="metadata" /></div><figcaption>Transformed clip</figcaption></figure>
        </div>
      </section>

      <div className={styles.proofDetailGrid}>
        <section className={styles.opsPanel}>
          <div className={styles.opsPanelHeader}><div><span className={styles.eyebrow}>Frame zero</span><h2>Before and after</h2></div></div>
          <div className={styles.proofCompare}>
            <figure><img src={mediaUrl('before', proof)} alt="Target frame before face swap" /><figcaption>Before</figcaption></figure>
            <figure><img src={mediaUrl('after', proof)} alt="Target frame after face swap" /><figcaption>After</figcaption></figure>
          </div>
        </section>

        <section className={styles.opsPanel}>
          <div className={styles.opsPanelHeader}><div><span className={styles.eyebrow}>Validation</span><h2>Proof report</h2></div>{passed ? <BadgeCheck size={18} className={styles.proofPassedIcon} /> : <AlertTriangle size={18} className={styles.proofFailedIcon} />}</div>
          <dl className={styles.proofFacts}>
            <div><dt>Engine</dt><dd>{proof.engine}</dd></div>
            <div><dt>Runtime</dt><dd>{proof.engineVersion || 'unknown'}</dd></div>
            <div><dt>Output</dt><dd>{result.width || 0}x{result.height || 0} · {result.codec || 'unknown'}</dd></div>
            <div><dt>Duration</dt><dd>{Number(result.durationSeconds || 0).toFixed(1)}s · {formatTime(proof.durationMs)}</dd></div>
          </dl>
          <div className={styles.proofChecks}>
            {Object.entries(checks).map(([name, value]) => <span key={name} className={value ? styles.proofCheckOk : styles.proofCheckBad}>{value ? <BadgeCheck size={12} /> : <AlertTriangle size={12} />}{name.replace(/([A-Z])/g, ' $1')}</span>)}
          </div>
          {proof.error && <div className={styles.inlineError}>{proof.error}</div>}
        </section>
      </div>
    </div>
  );
}
