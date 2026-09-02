'use client';

import Link from 'next/link';
import { ArrowLeft, ChevronLeft, ChevronRight, Copy, Edit3, Pause, Play, RotateCcw, StopCircle } from 'lucide-react';
import styles from '../../app/page.module.css';

export default function ProcessHeader({ data, live, onLive, onAction, onBack, onEdit }) {
  const { video, job, batchSiblings, capabilities } = data;
  const copy = (value) => navigator.clipboard?.writeText(String(value || '')).catch(() => {});
  return <header className={styles.processHeader}>
    <div className={styles.processHeaderMain}><button type="button" className={styles.processBack} onClick={onBack}><ArrowLeft size={15} />Library</button><div className={styles.processBreadcrumb}><Link href="/?view=library">Library</Link><span>/</span><Link href={`/?view=library&campaign=${encodeURIComponent(video.campaign || '')}`}>{video.campaign || 'Unassigned'}</Link><span>/</span><strong>{video.title}</strong></div><h1>{video.title}</h1><div className={styles.processMeta}><button type="button" onClick={() => copy(video.id)}>video {video.id}<Copy size={11} /></button>{job ? <button type="button" onClick={() => copy(job.id)}>job {job.id}<Copy size={11} /></button> : null}<span>{job?.status || 'planned'}</span></div></div>
    <div className={styles.processHeaderActions}>{batchSiblings.prevVideoId ? <Link className={styles.iconButton} href={`/videos/${batchSiblings.prevVideoId}`} title="Previous video"><ChevronLeft size={16} /></Link> : null}{batchSiblings.nextVideoId ? <Link className={styles.iconButton} href={`/videos/${batchSiblings.nextVideoId}`} title="Next video"><ChevronRight size={16} /></Link> : null}<button className={styles.toolbarButton} type="button" onClick={() => onLive(!live)}>{live ? <Pause size={13} /> : <Play size={13} />}{live ? 'Live' : 'Paused'}</button>{capabilities.editable ? <button className={styles.toolbarButton} type="button" onClick={onEdit}><Edit3 size={13} />Edit process</button> : null}{capabilities.canRetry ? <button className={styles.toolbarButton} type="button" onClick={() => onAction('retry')}><RotateCcw size={13} />Retry</button> : null}{capabilities.canCancel ? <button className={styles.toolbarButton} type="button" onClick={() => onAction('cancel')}><StopCircle size={13} />Cancel</button> : null}</div>
  </header>;
}
