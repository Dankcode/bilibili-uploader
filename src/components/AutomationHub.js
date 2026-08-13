'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check, ChevronRight, FileVideo, LoaderCircle, Play, UploadCloud, X,
} from 'lucide-react';
import DouyinImporter from './DouyinImporter';
import FaceSwapProof from './FaceSwapProof';
import GenerateStudio from './GenerateStudio';
import PipelineDashboard from './PipelineDashboard';
import styles from '../app/page.module.css';

const STEP_ORDER = [
  { id: 'sceneCut', label: 'Edit and format' },
  { id: 'faceFusion', label: 'Face swap' },
  { id: 'voiceover', label: 'English voiceover' },
  { id: 'metadata', label: 'Marketing metadata' },
  { id: 'publish', label: 'Publish to YouTube' },
];

function titleFromRef(value) {
  const cleaned = String(value || '').split(/[?#]/)[0];
  return cleaned.split('/').filter(Boolean).pop()?.replace(/\.[a-z0-9]{2,5}$/i, '') || 'Untitled video';
}

export default function AutomationHub({ openComposerKey = 0, openProofKey = 0, onQueued }) {
  const [tab, setTab] = useState('planner');
  const [sourceTab, setSourceTab] = useState('generate');
  const [presets, setPresets] = useState([]);
  const [presetId, setPresetId] = useState('edit-and-publish');
  const [sourceType, setSourceType] = useState('localFile');
  const [sourceText, setSourceText] = useState('');
  const [uploads, setUploads] = useState([]);
  const [uploading, setUploading] = useState({ active: false, complete: 0, total: 0 });
  const [batchName, setBatchName] = useState('');
  const [campaign, setCampaign] = useState('');
  const [language, setLanguage] = useState('auto');
  const [priority, setPriority] = useState(0);
  const [scheduledFor, setScheduledFor] = useState('');
  const [intervalMinutes, setIntervalMinutes] = useState(0);
  const [aspectRatio, setAspectRatio] = useState('source');
  const [faceSource, setFaceSource] = useState('');
  const [steps, setSteps] = useState({ sceneCut: true, faceFusion: false, voiceover: true, metadata: true, publish: true });
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const fileInput = useRef(null);

  useEffect(() => { if (openComposerKey) setTab('planner'); }, [openComposerKey]);
  useEffect(() => { if (openProofKey) setTab('proof'); }, [openProofKey]);
  useEffect(() => {
    fetch('/api/pipeline/presets', { cache: 'no-store' })
      .then((response) => response.json())
      .then((payload) => setPresets(payload.presets || []))
      .catch(() => setPresets([]));
  }, []);

  function choosePreset(nextId) {
    setPresetId(nextId);
    const template = presets.find((preset) => preset.id === nextId)?.template || {};
    const processors = new Set(template.processorIds || []);
    setSteps({
      sceneCut: processors.has('sceneCut'),
      faceFusion: processors.has('faceFusion'),
      voiceover: processors.has('voiceover'),
      metadata: processors.has('metadata'),
      publish: Boolean(template.uploaderId),
    });
  }

  const typedSources = useMemo(() => sourceText.split(/\r?\n/).map((value) => value.trim()).filter(Boolean), [sourceText]);
  const sourceItems = useMemo(() => {
    const all = [
      ...uploads.map((item) => ({ ref: item.path, title: titleFromRef(item.name), sourceId: 'localFile' })),
      ...typedSources.map((ref) => ({ ref, title: titleFromRef(ref), sourceId: sourceType })),
    ];
    return all.filter((item, index) => all.findIndex((candidate) => candidate.ref === item.ref) === index).slice(0, 100);
  }, [sourceType, typedSources, uploads]);

  async function uploadFiles(fileList) {
    const files = Array.from(fileList || []).filter((file) => /video\/(mp4|quicktime|webm|x-matroska)/.test(file.type) || /\.(mp4|mov|mkv|webm|m4v)$/i.test(file.name));
    if (!files.length) return;
    setError('');
    setUploading({ active: true, complete: 0, total: files.length });
    const completed = [];
    for (let index = 0; index < files.length && uploads.length + completed.length < 100; index += 1) {
      const form = new FormData();
      form.append('file', files[index]);
      try {
        const response = await fetch('/api/operations/import', { method: 'POST', body: form });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || `Could not import ${files[index].name}`);
        completed.push(payload.file);
        setUploads((current) => [...current, payload.file].slice(0, 100));
      } catch (uploadError) {
        setError(uploadError.message);
        break;
      } finally {
        setUploading({ active: true, complete: index + 1, total: files.length });
      }
    }
    setUploading((current) => ({ ...current, active: false }));
  }

  async function createBatch(event) {
    event.preventDefault();
    setNotice('');
    setError('');
    if (!sourceItems.length) return setError('Add at least one video source.');
    if (steps.faceFusion && !faceSource.trim()) return setError('A face source image path is required for face swap.');
    setSubmitting(true);
    const startTime = scheduledFor ? new Date(scheduledFor).getTime() : 0;
    const processorIds = STEP_ORDER.filter((step) => step.id !== 'publish' && steps[step.id]).map((step) => step.id);
    try {
      const response = await fetch('/api/operations/batches', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: batchName || `${campaign || 'Video'} batch`,
          presetId,
          items: sourceItems.map((item, index) => ({
            title: item.title,
            sourceId: item.sourceId,
            sourceInput: item.ref,
            processorIds,
            uploaderId: steps.publish ? 'youtube' : '',
            campaign,
            language,
            priority,
            scheduledFor: startTime ? new Date(startTime + (index * intervalMinutes * 60000)).toISOString() : '',
            options: {
              sceneCut: { aspectRatio, encodingPreset: 'medium', crf: 20 },
              faceFusion: { sourcePaths: faceSource.trim(), outputVideoQuality: 90 },
              voiceover: { sourceLanguage: language, burnSubtitles: true },
              metadata: { reviewMetadata: false },
              youtube: { privacyStatus: 'private' },
            },
          })),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not queue automation batch');
      setNotice(`${payload.batch.totalItems} videos queued and automation started.`);
      setSourceText('');
      setUploads([]);
      onQueued?.(payload.batch);
      setTab('runs');
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className={styles.automationView}>
      <div className={styles.segmentedTabs} role="tablist" aria-label="Automation views">
        {[['planner', 'Batch planner'], ['runs', 'Runs'], ['proof', 'Proof'], ['sources', 'Source tools']].map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? styles.segmentActive : ''} onClick={() => setTab(id)}>{label}</button>)}
      </div>

      {(notice || error) && <div className={error ? styles.inlineError : styles.inlineNotice}>{error || notice}</div>}

      {tab === 'planner' && <form className={styles.plannerGrid} onSubmit={createBatch}>
        <div className={styles.plannerMain}>
          <section className={styles.opsPanel}>
            <div className={styles.opsPanelHeader}><div><span className={styles.eyebrow}>01 · Inputs</span><h2>Video sources</h2></div><span className={styles.counterBadge}>{sourceItems.length}/100</span></div>
            <div className={styles.formGridThree}>
              <label className={styles.formField}><span>Source</span><select value={sourceType} onChange={(event) => setSourceType(event.target.value)}><option value="localFile">Local path</option><option value="bilibili">Bilibili URL</option><option value="douyin">Douyin URL</option></select></label>
              <label className={styles.formField}><span>Preset</span><select value={presetId} onChange={(event) => choosePreset(event.target.value)}>{presets.map((preset) => <option value={preset.id} key={preset.id}>{preset.name}</option>)}</select></label>
              <label className={styles.formField}><span>Source language</span><select value={language} onChange={(event) => setLanguage(event.target.value)}><option value="auto">Auto detect</option><option value="en">English</option><option value="zh">Chinese</option></select></label>
            </div>
            {sourceType === 'localFile' && <div className={styles.dropZone} role="button" tabIndex="0" onClick={() => fileInput.current?.click()} onKeyDown={(event) => (event.key === 'Enter' || event.key === ' ') && fileInput.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); uploadFiles(event.dataTransfer.files); }}>
              <UploadCloud size={24} /><strong>{uploading.active ? `Importing ${uploading.complete} of ${uploading.total}` : 'Drop video files or choose from disk'}</strong>
              <span>MP4, MOV, MKV, WebM, or M4V</span>
              <input ref={fileInput} type="file" accept="video/*,.mkv,.m4v" multiple hidden onChange={(event) => uploadFiles(event.target.files)} />
            </div>}
            <label className={styles.formField}><span>{sourceType === 'localFile' ? 'Server paths' : 'Video URLs'} · one per line</span><textarea rows="6" value={sourceText} onChange={(event) => setSourceText(event.target.value)} placeholder={sourceType === 'localFile' ? '/absolute/path/video-01.mp4' : 'https://...'} /></label>
            {uploads.length > 0 && <div className={styles.uploadList}>{uploads.map((item, index) => <div key={item.path}><FileVideo size={14} /><span>{item.name}</span><small>{item.probe.width}x{item.probe.height}</small><button type="button" onClick={() => setUploads((current) => current.filter((_, itemIndex) => itemIndex !== index))} title="Remove imported video" aria-label={`Remove ${item.name}`}><X size={14} /></button></div>)}</div>}
          </section>

          <section className={styles.opsPanel}>
            <div className={styles.opsPanelHeader}><div><span className={styles.eyebrow}>02 · Workflow</span><h2>Automatic run list</h2></div></div>
            <div className={styles.stepChecklist}>
              {STEP_ORDER.map((step, index) => <label key={step.id} className={steps[step.id] ? styles.stepChecked : ''}><input type="checkbox" checked={steps[step.id]} onChange={(event) => setSteps({ ...steps, [step.id]: event.target.checked })} /><span className={styles.checkVisual}>{steps[step.id] && <Check size={13} />}</span><span className={styles.stepIndex}>{String(index + 1).padStart(2, '0')}</span><strong>{step.label}</strong><ChevronRight size={14} /></label>)}
            </div>
            <div className={styles.formGridTwo}>
              <label className={styles.formField}><span>Output format</span><select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)}><option value="source">Keep source</option><option value="16:9">16:9 · 1280x720</option><option value="9:16">9:16 · 720x1280</option><option value="1:1">1:1 · 1080x1080</option></select></label>
              {steps.faceFusion && <label className={styles.formField}><span>Face source image path</span><input value={faceSource} onChange={(event) => setFaceSource(event.target.value)} placeholder="/absolute/path/face.jpg" /></label>}
            </div>
          </section>
        </div>

        <aside className={styles.plannerRail}>
          <section className={styles.opsPanel}>
            <div className={styles.opsPanelHeader}><div><span className={styles.eyebrow}>03 · Dispatch</span><h2>Batch settings</h2></div></div>
            <label className={styles.formField}><span>Batch name</span><input value={batchName} onChange={(event) => setBatchName(event.target.value)} placeholder="August launch" /></label>
            <label className={styles.formField}><span>Campaign</span><input value={campaign} onChange={(event) => setCampaign(event.target.value)} placeholder="Campaign or series" /></label>
            <div className={styles.formGridTwo}>
              <label className={styles.formField}><span>Priority</span><input type="number" min="-100" max="100" value={priority} onChange={(event) => setPriority(Number(event.target.value))} /></label>
              <label className={styles.formField}><span>Spacing</span><div className={styles.inputSuffix}><input type="number" min="0" max="10080" value={intervalMinutes} onChange={(event) => setIntervalMinutes(Number(event.target.value))} /><span>min</span></div></label>
            </div>
            <label className={styles.formField}><span>Start time</span><input type="datetime-local" value={scheduledFor} onChange={(event) => setScheduledFor(event.target.value)} /></label>
            <div className={styles.batchSummary}>
              <div><span>Videos</span><strong>{sourceItems.length}</strong></div>
              <div><span>Steps each</span><strong>{Object.values(steps).filter(Boolean).length}</strong></div>
              <div><span>Mode</span><strong>{scheduledFor ? 'Scheduled' : 'Immediate'}</strong></div>
            </div>
            <button type="submit" className={styles.launchButton} disabled={submitting || uploading.active || sourceItems.length === 0}>{submitting ? <LoaderCircle size={16} className={styles.spin} /> : <Play size={16} fill="currentColor" />} Queue and run</button>
          </section>
        </aside>
      </form>}

      {tab === 'runs' && <PipelineDashboard />}
      {tab === 'proof' && <FaceSwapProof />}
      {tab === 'sources' && <div className={styles.sourceTools}>
        <div className={styles.segmentedTabs} role="tablist" aria-label="Source tools"><button type="button" className={sourceTab === 'generate' ? styles.segmentActive : ''} onClick={() => setSourceTab('generate')}>Single video</button><button type="button" className={sourceTab === 'douyin' ? styles.segmentActive : ''} onClick={() => setSourceTab('douyin')}>Douyin import</button></div>
        {sourceTab === 'generate' ? <GenerateStudio /> : <DouyinImporter onCreated={() => setTab('runs')} />}
      </div>}
    </section>
  );
}
