'use client';

import dynamic from 'next/dynamic';
import { useRef, useState } from 'react';
import { FileVideo, LoaderCircle, Plus, Scissors, Trash2, Upload } from 'lucide-react';
import SceneRepository from './SceneRepository';
import styles from '../app/page.module.css';

const SubtitleStudio = dynamic(() => import('./SubtitleStudio'), {
  loading: () => <div className={styles.loadingSurface}>Loading subtitle editor</div>,
  ssr: false,
});

export default function EditorWorkspace({ channels = [], onPublished, onJobQueued }) {
  const [tab, setTab] = useState('subtitles');
  const [filePath, setFilePath] = useState('');
  const [fileName, setFileName] = useState('');
  const [title, setTitle] = useState('');
  const [campaign, setCampaign] = useState('');
  const [aspectRatio, setAspectRatio] = useState('source');
  const [clips, setClips] = useState([{ start: 0, end: 30 }]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const fileInput = useRef(null);

  async function importFile(file) {
    if (!file) return;
    setBusy(true);
    setError('');
    const form = new FormData();
    form.append('file', file);
    try {
      const response = await fetch('/api/operations/import', { method: 'POST', body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not import video');
      setFilePath(payload.file.path);
      setFileName(payload.file.name);
      setTitle(payload.file.name.replace(/\.[^.]+$/, ''));
    } catch (importError) {
      setError(importError.message);
    } finally {
      setBusy(false);
    }
  }

  async function queueEdit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/pipeline/jobs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create', sourceId: 'localFile', sourceInput: filePath,
          processorIds: ['sceneCut'], uploaderId: '', title, campaign,
          options: { sceneCut: { clips, aspectRatio, encodingPreset: 'medium', crf: 20 } },
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not queue edit');
      setNotice(`Edit job #${payload.job.id} queued.`);
      onJobQueued?.(payload.job);
    } catch (queueError) {
      setError(queueError.message);
    } finally {
      setBusy(false);
    }
  }

  return <section className={styles.editorWorkspace}>
    <div className={styles.segmentedTabs} role="tablist" aria-label="Editor views">
      {[['subtitles', 'Subtitle studio'], ['cut', 'Cut and format'], ['scenes', 'Scene library']].map(([id, label]) => <button key={id} type="button" className={tab === id ? styles.segmentActive : ''} onClick={() => setTab(id)}>{label}</button>)}
    </div>
    {tab === 'subtitles' && <SubtitleStudio channels={channels} onPublished={onPublished} />}
    {tab === 'scenes' && <SceneRepository />}
    {tab === 'cut' && <form className={styles.cutPlanner} onSubmit={queueEdit}>
      {(notice || error) && <div className={error ? styles.inlineError : styles.inlineNotice}>{error || notice}</div>}
      <div className={styles.cutPlannerGrid}>
        <section className={styles.opsPanel}>
          <div className={styles.opsPanelHeader}><div><span className={styles.eyebrow}>Media</span><h2>Source and output</h2></div></div>
          <button type="button" className={styles.mediaPicker} onClick={() => fileInput.current?.click()}>
            {fileName ? <FileVideo size={24} /> : <Upload size={24} />}
            <span><strong>{fileName || 'Choose a video'}</strong><small>{filePath || 'MP4, MOV, MKV, WebM, or M4V'}</small></span>
          </button>
          <input ref={fileInput} type="file" accept="video/*,.mkv,.m4v" hidden onChange={(event) => importFile(event.target.files?.[0])} />
          <label className={styles.formField}><span>Server path</span><input value={filePath} onChange={(event) => setFilePath(event.target.value)} required /></label>
          <div className={styles.formGridTwo}><label className={styles.formField}><span>Title</span><input value={title} onChange={(event) => setTitle(event.target.value)} required /></label><label className={styles.formField}><span>Campaign</span><input value={campaign} onChange={(event) => setCampaign(event.target.value)} /></label></div>
          <label className={styles.formField}><span>Output format</span><select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)}><option value="source">Keep source</option><option value="16:9">16:9 · 1280x720</option><option value="9:16">9:16 · 720x1280</option><option value="1:1">1:1 · 1080x1080</option></select></label>
        </section>
        <section className={styles.opsPanel}>
          <div className={styles.opsPanelHeader}><div><span className={styles.eyebrow}>Timeline</span><h2>Clip sequence</h2></div><button type="button" className={styles.toolbarButton} onClick={() => setClips([...clips, { start: 0, end: 30 }])}><Plus size={14} /> Add clip</button></div>
          <div className={styles.clipList}>{clips.map((clip, index) => <div className={styles.clipRow} key={index}><span className={styles.clipHandle}><Scissors size={14} /> {String(index + 1).padStart(2, '0')}</span><label><span>Start</span><input type="number" min="0" step="0.01" value={clip.start} onChange={(event) => setClips(clips.map((item, itemIndex) => itemIndex === index ? { ...item, start: Number(event.target.value) } : item))} /></label><label><span>End</span><input type="number" min="0.01" step="0.01" value={clip.end} onChange={(event) => setClips(clips.map((item, itemIndex) => itemIndex === index ? { ...item, end: Number(event.target.value) } : item))} /></label><button type="button" className={styles.iconButton} disabled={clips.length === 1} onClick={() => setClips(clips.filter((_, itemIndex) => itemIndex !== index))} title="Remove clip" aria-label={`Remove clip ${index + 1}`}><Trash2 size={15} /></button></div>)}</div>
          <div className={styles.timelineStrip}>{clips.map((clip, index) => <div key={index} style={{ flex: Math.max(1, Number(clip.end) - Number(clip.start)) }}><span>{index + 1}</span></div>)}</div>
          <button type="submit" className={styles.launchButton} disabled={busy || !filePath}>{busy ? <LoaderCircle size={16} className={styles.spin} /> : <Scissors size={16} />} Queue edit</button>
        </section>
      </div>
    </form>}
  </section>;
}
