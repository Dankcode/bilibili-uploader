'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check, ChevronRight, FileVideo, LoaderCircle, Play, Search, UploadCloud, X,
} from 'lucide-react';
import DouyinImporter from './DouyinImporter';
import FaceSwapProof from './FaceSwapProof';
import GenerateStudio from './GenerateStudio';
import PipelineDashboard from './PipelineDashboard';
import PublishTarget from './PublishTarget';
import styles from '../app/page.module.css';

const STEP_ORDER = [
  { id: 'sceneCut', label: 'Edit and format' },
  { id: 'faceFusion', label: 'Face swap' },
  { id: 'videoContext', label: 'Video context (transcript + frames)', default: true },
  { id: 'ocrContext', label: 'On-screen text OCR', requires: 'videoContext' },
  { id: 'voiceover', label: 'English voiceover' },
  { id: 'metadata', label: 'Marketing metadata' },
  { id: 'publish', label: 'Publish to YouTube' },
];

function titleFromRef(value) {
  const cleaned = String(value || '').split(/[?#]/)[0];
  return cleaned.split('/').filter(Boolean).pop()?.replace(/\.[a-z0-9]{2,5}$/i, '') || 'Untitled video';
}

function creatorIdFromRef(value) {
  const input = String(value || '').trim();
  if (/^\d{1,20}$/.test(input)) return input;
  try {
    const url = new URL(input);
    if (url.hostname.toLowerCase() !== 'space.bilibili.com') return '';
    return url.pathname.split('/').filter(Boolean)[0] || '';
  } catch {
    return '';
  }
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function formatUploadDate(value) {
  if (!value) return 'Unknown date';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

export default function AutomationHub({ openComposerKey = 0, openProofKey = 0, onQueued, youtubeAuthorizations = [] }) {
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
  const [steps, setSteps] = useState({ sceneCut: true, faceFusion: false, videoContext: true, ocrContext: false, voiceover: true, metadata: true, publish: true });
  const [ocrRegion, setOcrRegion] = useState('full');
  const [visionStatus, setVisionStatus] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [youtubeAuthorizationId, setYoutubeAuthorizationId] = useState('');
  const [resolvedSources, setResolvedSources] = useState({});
  const [resolving, setResolving] = useState(false);
  const [bilibiliReview, setBilibiliReview] = useState([]);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [reviewSaving, setReviewSaving] = useState('');
  const [localAuthorizations, setLocalAuthorizations] = useState([]);
  const fileInput = useRef(null);

  useEffect(() => { if (openComposerKey) setTab('planner'); }, [openComposerKey]);
  useEffect(() => { if (openProofKey) setTab('proof'); }, [openProofKey]);
  useEffect(() => { setLocalAuthorizations(youtubeAuthorizations); }, [youtubeAuthorizations]);
  useEffect(() => {
    fetch('/api/control/pipeline/presets', { cache: 'no-store' })
      .then((response) => response.json())
      .then((payload) => setPresets(payload.presets || []))
      .catch(() => setPresets([]));
  }, []);
  useEffect(() => {
    fetch('/api/control/studio/context', { cache: 'no-store' })
      .then((response) => response.json())
      .then(setVisionStatus)
      .catch(() => setVisionStatus(null));
  }, []);

  function choosePreset(nextId) {
    setPresetId(nextId);
    const template = presets.find((preset) => preset.id === nextId)?.template || {};
    const processors = new Set(template.processorIds || []);
    setSteps({
      sceneCut: processors.has('sceneCut'),
      faceFusion: processors.has('faceFusion'),
      videoContext: processors.has('videoContext'),
      ocrContext: processors.has('ocrContext'),
      voiceover: processors.has('voiceover'),
      metadata: processors.has('metadata'),
      publish: Boolean(template.uploaderId),
    });
  }

  function toggleStep(id, checked) {
    setSteps((current) => {
      const next = { ...current, [id]: checked };
      if (id === 'videoContext' && !checked) next.ocrContext = false;
      if (id === 'ocrContext' && checked) next.videoContext = true;
      return next;
    });
  }

  const typedSources = useMemo(() => sourceText.split(/\r?\n/).map((value) => value.trim()).filter(Boolean), [sourceText]);
  const selectedReviewUrls = useMemo(() => new Set(bilibiliReview.map((item) => item.url)), [bilibiliReview]);
  const visibleBilibiliReview = useMemo(() => {
    const query = catalogQuery.trim().toLowerCase();
    if (!query) return bilibiliReview;
    return bilibiliReview.filter((item) => [item.title, item.description, item.bvid, item.creatorId, item.uploadedAt]
      .some((value) => String(value || '').toLowerCase().includes(query)));
  }, [bilibiliReview, catalogQuery]);
  const sourceItems = useMemo(() => {
    const all = [
      ...uploads.map((item) => ({ ref: item.path, title: titleFromRef(item.name), sourceId: 'localFile' })),
      ...typedSources.flatMap((ref) => {
        const resolved = resolvedSources[ref];
        // A Bilibili creator page resolves to many individual video URLs. Once
        // resolved, expand them here rather than queueing the creator page as
        // one opaque source (which previously kept only its first video).
        if (sourceType === 'bilibili' && Array.isArray(resolved?.items) && resolved.items.length) {
          return resolved.items.filter((item) => !selectedReviewUrls.has(item.url)).map((item) => ({
            ref: item.url,
            title: item.title || titleFromRef(item.url),
            sourceId: 'bilibili',
            ...item,
          }));
        }
        return [{ ref, title: resolved?.title || titleFromRef(ref), sourceId: sourceType, ...resolved }];
      }),
      ...(sourceType === 'bilibili' ? bilibiliReview.filter((item) => item.selected).map((item) => ({
        ref: item.url, sourceId: 'bilibili', scraped: true, ...item,
      })) : []),
    ];
    return all.filter((item, index) => all.findIndex((candidate) => candidate.ref === item.ref) === index).slice(0, 100);
  }, [sourceType, typedSources, uploads, resolvedSources, bilibiliReview, selectedReviewUrls]);

  function replaceReviewVideo(nextVideo) {
    setBilibiliReview((current) => current.map((item) => item.creatorId === nextVideo.creatorId && item.bvid === nextVideo.bvid ? nextVideo : item));
  }

  async function saveReviewVideo(video) {
    const key = `${video.creatorId}:${video.bvid}`;
    setReviewSaving(key);
    try {
      const response = await fetch('/api/control/operations/bilibili-scrapes', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorId: video.creatorId, bvid: video.bvid, selected: video.selected, title: video.title, description: video.description }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not save Bilibili review changes');
      replaceReviewVideo(payload.video);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setReviewSaving('');
    }
  }

  function editReviewVideo(video, patch, persist = false) {
    const nextVideo = { ...video, ...patch };
    replaceReviewVideo(nextVideo);
    if (persist) saveReviewVideo(nextVideo);
  }

  async function loadSavedBilibiliReview(query = '') {
    const creatorIds = [...new Set(typedSources.map(creatorIdFromRef).filter(Boolean))];
    if (!creatorIds.length && !query.trim()) {
      setError('Enter a numeric creator ID or space.bilibili.com URL, or search the saved catalog.');
      return;
    }
    setError(''); setCatalogLoading(true);
    try {
      const responses = await Promise.all((creatorIds.length ? creatorIds : ['']).map(async (creatorId) => {
        const params = new URLSearchParams({ limit: '100' });
        if (creatorId) params.set('creatorId', creatorId);
        if (query.trim()) params.set('query', query.trim());
        const response = await fetch(`/api/control/operations/bilibili-scrapes?${params.toString()}`, { cache: 'no-store' });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Could not load the saved Bilibili catalog');
        return payload.videos || [];
      }));
      const videos = responses.flat().filter((item, index, list) => list.findIndex((candidate) => candidate.creatorId === item.creatorId && candidate.bvid === item.bvid) === index);
      setBilibiliReview(videos);
      setNotice(`${videos.length} saved Bilibili video${videos.length === 1 ? '' : 's'} loaded for review.`);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setCatalogLoading(false);
    }
  }

  async function resolveSources() {
    if (sourceType !== 'bilibili' || !typedSources.length) return;
    setError(''); setResolving(true);
    try {
      const entries = await Promise.all(typedSources.map(async (ref) => {
        const response = await fetch('/api/pipeline/source/resolve', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceId: 'bilibili', sourceInput: ref }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || `Could not resolve ${ref}`);
        const items = (payload.items || []).map((item) => ({ ...item, ref: item.url }));
        if (!items.length) throw new Error(`No Bilibili videos were found for ${ref}`);
        return [ref, { items }];
      }));
      const resolvedCount = entries.reduce((count, [, item]) => count + (item?.items?.length || 0), 0);
      setResolvedSources((current) => ({ ...current, ...Object.fromEntries(entries.filter(([, item]) => item)) }));
      const saved = entries.flatMap(([, item]) => item?.items || []).filter((item) => item.scraped && item.creatorId && item.bvid);
      if (saved.length) setBilibiliReview(saved);
      setNotice(`${resolvedCount} Bilibili video${resolvedCount === 1 ? '' : 's'} saved locally. Review and deselect anything that should not be uploaded.`);
    } catch (resolveError) { setError(resolveError.message); } finally { setResolving(false); }
  }

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
        const response = await fetch('/api/control/operations/import', { method: 'POST', body: form });
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
    if (steps.publish && !youtubeAuthorizationId) return setError('Choose an authorized YouTube channel before queueing this upload.');
    setSubmitting(true);
    const startTime = scheduledFor ? new Date(scheduledFor).getTime() : 0;
    const processorIds = STEP_ORDER.filter((step) => step.id !== 'publish' && steps[step.id]).map((step) => step.id);
    try {
      const response = await fetch('/api/control/operations/batches', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: batchName || `${campaign || 'Video'} batch`,
          presetId,
          items: sourceItems.map((item, index) => ({
            title: item.title,
            sourceId: item.sourceId,
            sourceInput: item.ref,
            sourceDurationSeconds: item.durationSeconds || 0,
            processorIds,
            uploaderId: steps.publish ? 'youtube' : '',
            youtubeAuthorizationId: steps.publish ? youtubeAuthorizationId : '',
            campaign,
            language,
            priority,
            scheduledFor: startTime ? new Date(startTime + (index * intervalMinutes * 60000)).toISOString() : '',
            options: {
              sceneCut: { aspectRatio, encodingPreset: 'medium', crf: 20 },
              faceFusion: { sourcePaths: faceSource.trim(), outputVideoQuality: 90 },
              videoContext: { sourceLanguage: language, quality: 'balanced', intervalSeconds: 20, visionMode: 'always' },
              ocrContext: { region: ocrRegion, denseSampling: true, denseInterval: 1, applyCorrections: 'auto' },
              voiceover: { sourceLanguage: language, burnSubtitles: true },
              metadata: {
                reviewMetadata: false, title: item.title, description: item.description || '',
                sourceTitle: item.sourceTitle || item.title, sourceDescription: item.sourceDescription || '',
                sourceUrl: item.url || item.ref, creatorId: item.creatorId || '', bvid: item.bvid || '', uploadedAt: item.uploadedAt || '',
              },
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
              <label className={styles.formField}><span>Source</span><select value={sourceType} onChange={(event) => setSourceType(event.target.value)}><option value="localFile">Local path</option><option value="bilibili">Bilibili video or creator URL</option><option value="douyin">Douyin URL</option></select></label>
              <label className={styles.formField}><span>Preset</span><select value={presetId} onChange={(event) => choosePreset(event.target.value)}>{presets.map((preset) => <option value={preset.id} key={preset.id}>{preset.name}</option>)}</select></label>
              <label className={styles.formField}><span>Source language</span><select value={language} onChange={(event) => setLanguage(event.target.value)}><option value="auto">Auto detect</option><option value="en">English</option><option value="zh">Chinese</option></select></label>
            </div>
            {sourceType === 'localFile' && <div className={styles.dropZone} role="button" tabIndex="0" onClick={() => fileInput.current?.click()} onKeyDown={(event) => (event.key === 'Enter' || event.key === ' ') && fileInput.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); uploadFiles(event.dataTransfer.files); }}>
              <UploadCloud size={24} /><strong>{uploading.active ? `Importing ${uploading.complete} of ${uploading.total}` : 'Drop video files or choose from disk'}</strong>
              <span>MP4, MOV, MKV, WebM, or M4V</span>
              <input ref={fileInput} type="file" accept="video/*,.mkv,.m4v" multiple hidden onChange={(event) => uploadFiles(event.target.files)} />
            </div>}
            <label className={styles.formField}><span>{sourceType === 'localFile' ? 'Server paths' : sourceType === 'bilibili' ? 'Bilibili video or creator-space URLs' : 'Video URLs'} · one per line</span><textarea rows="6" value={sourceText} onChange={(event) => setSourceText(event.target.value)} placeholder={sourceType === 'localFile' ? '/absolute/path/video-01.mp4' : sourceType === 'bilibili' ? 'B2J2aDS\n49748554\nhttps://space.bilibili.com/123456' : 'https://...'} /></label>
            {sourceType === 'bilibili' && <small className={styles.fieldHint}>Paste a short video ID such as <code>B2J2aDS</code>, a video URL, a numeric creator ID, or a <code>space.bilibili.com</code> URL. Creator accounts resolve up to 100 videos into this batch.</small>}
            {sourceType === 'bilibili' && <div className={styles.bilibiliActions}>
              <button type="button" className={styles.editBtn} disabled={resolving || !typedSources.length} onClick={resolveSources}>{resolving ? 'Loading account…' : 'Scrape and save account'}</button>
              <button type="button" className={styles.editBtn} disabled={catalogLoading} onClick={() => loadSavedBilibiliReview(catalogQuery)}>{catalogLoading ? 'Loading saved data…' : 'Load saved review'}</button>
            </div>}
            {sourceType === 'bilibili' && resolving && <div className={styles.scrapeLoading} role="status"><LoaderCircle size={20} className={styles.spin} /><div><strong>Scraping creator uploads</strong><span>Loading each available page, saving the catalog, then opening it for review.</span></div></div>}
            {sourceType === 'bilibili' && bilibiliReview.length > 0 && <section className={styles.scrapeReviewPanel}>
              <div className={styles.scrapeReviewHeader}><div><span className={styles.eyebrow}>Saved creator catalog</span><h3>{bilibiliReview.filter((item) => item.selected).length} of {bilibiliReview.length} selected for delivery</h3></div><div className={styles.bilibiliActions}><button type="button" className={styles.editBtn} onClick={() => bilibiliReview.forEach((item) => editReviewVideo(item, { selected: true }, true))}>Select all</button><button type="button" className={styles.editBtn} onClick={() => bilibiliReview.forEach((item) => editReviewVideo(item, { selected: false }, true))}>Select none</button></div></div>
              <div className={styles.scrapeReviewToolbar}><label className={styles.catalogSearch}><Search size={14} /><input value={catalogQuery} onChange={(event) => setCatalogQuery(event.target.value)} placeholder="Filter loaded catalog or search saved DB" onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); loadSavedBilibiliReview(catalogQuery); } }} /></label><button type="button" className={styles.editBtn} disabled={catalogLoading || !catalogQuery.trim()} onClick={() => loadSavedBilibiliReview(catalogQuery)}>Search saved DB</button></div>
              <div className={styles.scrapeReviewTableWrap}><table className={styles.scrapeReviewTable}><thead><tr><th>Upload</th><th>Source video</th><th>Length / date</th><th>Delivery title</th><th>Delivery description</th></tr></thead><tbody>{visibleBilibiliReview.map((item) => { const key = `${item.creatorId}:${item.bvid}`; return <tr key={key}><td><input type="checkbox" checked={item.selected} onChange={(event) => editReviewVideo(item, { selected: event.target.checked }, true)} aria-label={`Upload ${item.title}`} /></td><td><strong>{item.sourceTitle || item.title}</strong><small>{item.bvid} · creator {item.creatorId}</small></td><td><strong>{formatDuration(item.durationSeconds)}</strong><small>{formatUploadDate(item.uploadedAt)}</small></td><td><input value={item.title} onChange={(event) => editReviewVideo(item, { title: event.target.value })} onBlur={(event) => saveReviewVideo({ ...item, title: event.target.value })} aria-label={`Delivery title for ${item.sourceTitle || item.title}`} /></td><td><textarea rows="2" value={item.description} onChange={(event) => editReviewVideo(item, { description: event.target.value })} onBlur={(event) => saveReviewVideo({ ...item, description: event.target.value })} aria-label={`Delivery description for ${item.sourceTitle || item.title}`} />{reviewSaving === key ? <small>Saving…</small> : null}</td></tr>; })}</tbody></table></div>
            </section>}
            {uploads.length > 0 && <div className={styles.uploadList}>{uploads.map((item, index) => <div key={item.path}><FileVideo size={14} /><span>{item.name}</span><small>{item.probe.width}x{item.probe.height}</small><button type="button" onClick={() => setUploads((current) => current.filter((_, itemIndex) => itemIndex !== index))} title="Remove imported video" aria-label={`Remove ${item.name}`}><X size={14} /></button></div>)}</div>}
          </section>

          <section className={styles.opsPanel}>
            <div className={styles.opsPanelHeader}><div><span className={styles.eyebrow}>02 · Workflow</span><h2>Automatic run list</h2></div></div>
            <div className={styles.stepChecklist}>
              {STEP_ORDER.map((step, index) => <label key={step.id} className={steps[step.id] ? styles.stepChecked : ''}><input type="checkbox" checked={Boolean(steps[step.id])} onChange={(event) => toggleStep(step.id, event.target.checked)} /><span className={styles.checkVisual}>{steps[step.id] ? <Check size={13} /> : null}</span><span className={styles.stepIndex}>{String(index + 1).padStart(2, '0')}</span><strong>{step.label}{step.requires ? <small>requires Video context</small> : null}</strong><ChevronRight size={14} /></label>)}
            </div>
            <div className={styles.formGridTwo}>
              <label className={styles.formField}><span>Output format</span><select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)}><option value="source">Keep source</option><option value="16:9">16:9 · 1280x720</option><option value="9:16">9:16 · 720x1280</option><option value="1:1">1:1 · 1080x1080</option></select></label>
              {steps.faceFusion && <label className={styles.formField}><span>Face source image path</span><input value={faceSource} onChange={(event) => setFaceSource(event.target.value)} placeholder="/absolute/path/face.jpg" /></label>}
              {steps.ocrContext ? <label className={styles.formField}><span>OCR region</span><select value={ocrRegion} onChange={(event) => setOcrRegion(event.target.value)}><option value="full">Full frame</option><option value="bottom">Bottom · burned-in subtitles</option><option value="top">Top · titles</option></select></label> : null}
            </div>
            {steps.videoContext ? <div className={styles.contextHealthLine}>
              <span>Image recognition</span>
              <strong>{visionStatus?.chain?.map((item) => item.label).join(' → ') || 'Gemini → Codex CLI → Kimi'}</strong>
              <em>{visionStatus?.configured ? 'ready' : 'configure in Connections'}</em>
            </div> : null}
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
            {steps.publish && <PublishTarget authorizations={localAuthorizations} value={youtubeAuthorizationId} onChange={setYoutubeAuthorizationId} durationSeconds={Math.max(0, ...sourceItems.map((item) => Number(item.durationSeconds) || 0))} />}
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
        {sourceTab === 'generate' ? <GenerateStudio youtubeAuthorizations={localAuthorizations} onAuthorizationAdded={(authorization) => setLocalAuthorizations((current) => [...current.filter((item) => item.id !== authorization.id), authorization])} /> : <DouyinImporter onCreated={() => setTab('runs')} />}
      </div>}
    </section>
  );
}
