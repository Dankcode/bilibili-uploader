'use client';

import { describeDimensions, formatMediaSize, versionLabel } from '../../lib/media/quality';
import styles from '../../app/page.module.css';

function details(version) {
  if (!version) return 'Waiting for a validated video';
  const fps = Number(version.fps);
  const codec = version.validation?.output?.codec;
  return [describeDimensions(version.width, version.height), fps > 0 ? `${Number(fps.toFixed(2))} fps` : '', codec ? String(codec).toUpperCase() : '', formatMediaSize(version.bytes)].filter(Boolean).join(' · ');
}

export default function MediaHistory({ versions = [], currentVersionId }) {
  const source = [...versions].reverse().find((version) => version.kind === 'original');
  const current = versions.find((version) => String(version.id) === String(currentVersionId)) || null;
  return <section className={styles.mediaHistory} aria-label="Video quality and changes">
    <div className={styles.mediaHistoryHeader}><div><span className={styles.eyebrow}>Video quality</span><h2>Download and changes</h2></div><span>Measured from saved media</span></div>
    <div className={styles.mediaQualityGrid}>
      <div><span>Downloaded source</span><strong>{details(source)}</strong></div>
      <div><span>Current version</span><strong>{details(current)}</strong>{current ? <small>{versionLabel(current.kind)}</small> : null}</div>
    </div>
    {versions.length ? <ol className={styles.mediaVersionList} aria-label="Saved video versions">{versions.map((version) => <li key={version.id}>
      <span className={styles.mediaVersionDot} aria-hidden="true" />
      <div><strong>{versionLabel(version.kind)}</strong>{String(version.id) === String(currentVersionId) ? <span className={styles.mediaCurrentBadge}>Current</span> : null}<small>{details(version)}{version.validationStatus ? ` · ${version.validationStatus}` : ''}</small></div>
      <time dateTime={version.createdAt}>{version.createdAt ? new Date(version.createdAt).toLocaleString() : ''}</time>
    </li>)}</ol> : <p className={styles.mediaHistoryEmpty}>Quality and saved changes will appear after the download is validated.</p>}
  </section>;
}
