'use client';

import { describeDimensions, describeSourceSelection, describeSourceMatch, formatBitrate, formatMediaSize, versionLabel } from '../../lib/media/quality';
import styles from '../../app/page.module.css';

function details(version) {
  if (!version) return 'Waiting for a validated video';
  const output = version.validation?.output || {};
  const avg = Number(output.avgFps); const nominal = Number(version.fps);
  // Show the rate that actually plays; note the nominal rate when it differs (variable frame rate).
  const fps = avg > 0 ? `${Number(avg.toFixed(3))} fps${nominal > 0 && Math.abs(nominal - avg) / avg > 0.002 ? ` (nominal ${Number(nominal.toFixed(3))})` : ''}`
    : nominal > 0 ? `${Number(nominal.toFixed(2))} fps` : '';
  const codec = output.codec ? `${String(output.codec).toUpperCase()}${output.profile ? ` ${output.profile}` : ''}` : '';
  const audio = output.audio ? `${String(output.audio.codec || '').toUpperCase()} ${output.audio.sampleRate ? `${Math.round(output.audio.sampleRate / 100) / 10} kHz` : ''}${output.audio.channels ? ` ${output.audio.channels}ch` : ''}`.trim() : (output.codec ? 'no audio' : '');
  const duration = Number(version.duration) > 0 ? `${Number(version.duration).toFixed(2)} s` : '';
  return [describeDimensions(version.width, version.height), fps, codec, formatBitrate(output.videoBitrate || output.bitrate), audio, duration, formatMediaSize(version.bytes)].filter(Boolean).join(' · ');
}

function EditorReport({ report }) {
  if (!report) return null;
  const rows = [];
  if (report.overlay) rows.push(['Watermark', `${report.overlay.motion}; ${report.overlay.regions} region(s); found in ${(report.overlay.counts?.present || 0) + (report.overlay.counts?.moved || 0)} of ${report.overlay.samples} sampled frames${report.overlay.reviewTimesMs?.length ? `; ${report.overlay.reviewTimesMs.length} moment(s) to review` : ''}`]);
  if (report.speech) rows.push(['Speech', report.speech.cues ? `${report.speech.cues} reliable line(s), ${report.speech.translated} translated` : 'No reliable speech; no spoken subtitles added']);
  if (report.screenText) rows.push(['On-screen text', `${report.screenText.lines} line(s) (one frame every ${report.screenText.intervalMs / 1000}s): ${report.screenText.translated} translated, ${report.screenText.untranslated} untranslated, ${report.screenText.uncertain} uncertain${report.screenText.reviewed ? ', reviewed' : ', not reviewed'}`]);
  if (report.render?.audio) rows.push(['Audio', report.render.audio]);
  return rows.length ? <dl className={styles.mediaEditorReport}>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl> : null;
}

export default function MediaHistory({ versions = [], currentVersionId }) {
  const source = [...versions].reverse().find((version) => version.kind === 'original');
  const current = versions.find((version) => String(version.id) === String(currentVersionId)) || null;
  const selection = describeSourceSelection(source?.validation?.streamSelection);
  return <section className={styles.mediaHistory} aria-label="Video quality and changes">
    <div className={styles.mediaHistoryHeader}><div><span className={styles.eyebrow}>Video quality</span><h2>Download and changes</h2></div><span>Measured from saved media</span></div>
    <div className={styles.mediaQualityGrid}>
      <div><span>Downloaded source</span><strong>{details(source)}</strong>{selection ? <small>{selection}</small> : null}</div>
      <div><span>Current version</span><strong>{details(current)}</strong>{current ? <small>{versionLabel(current.kind)}{current.kind !== 'original' ? ` · ${describeSourceMatch(current.validation)}` : ''}</small> : null}</div>
    </div>
    {versions.length ? <ol className={styles.mediaVersionList} aria-label="Saved video versions">{versions.map((version) => <li key={version.id}>
      <span className={styles.mediaVersionDot} aria-hidden="true" />
      <div>
        <strong>{versionLabel(version.kind)}{version.validation?.mode ? ` (${version.validation.mode})` : ''}</strong>{String(version.id) === String(currentVersionId) ? <span className={styles.mediaCurrentBadge}>Current</span> : null}
        <small>{details(version)}{version.validationStatus ? ` · ${version.validationStatus}` : ''}</small>
        {version.kind !== 'original' && version.validation?.comparison ? <small>{describeSourceMatch(version.validation)}</small> : null}
        <EditorReport report={version.validation?.report} />
      </div>
      <time dateTime={version.createdAt}>{version.createdAt ? new Date(version.createdAt).toLocaleString() : ''}</time>
    </li>)}</ol> : <p className={styles.mediaHistoryEmpty}>Quality and saved changes will appear after the download is validated.</p>}
  </section>;
}
