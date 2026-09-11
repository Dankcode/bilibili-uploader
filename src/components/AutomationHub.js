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

const SCHEDULE_INTERVALS = [1, 2, 3, 4, 5, 7, 10, 14, 30];

const DELIVERY_STATE_LABELS = {
  available: 'Ready to automate',
  draft: 'Draft',
  queued: 'Queued',
  scheduled: 'Scheduled',
  processing: 'Processing',
  review: 'Needs review',
  completed: 'Completed — not uploaded',
  uploaded: 'Uploaded to YouTube',
  failed: 'Failed',
  canceled: 'Canceled',
};

function deliveryStateClass(state) {
  return {
    uploaded: styles.scrapeStateUploaded,
    completed: styles.scrapeStateCompleted,
    failed: styles.scrapeStateFailed,
    canceled: styles.scrapeStateFailed,
    queued: styles.scrapeStateActive,
    scheduled: styles.scrapeStateActive,
    processing: styles.scrapeStateActive,
    review: styles.scrapeStateActive,
  }[state] || styles.scrapeStateReady;
}

const DEFAULT_YOUTUBE_OPTIONS = {
  privacyStatus: 'private', categoryId: '', defaultLanguage: 'en', license: 'youtube',
  madeForKids: false, embeddable: true, notifySubscribers: false,
};

const DEFAULT_STEPS = {
  sceneCut: true, faceFusion: false, videoContext: true, ocrContext: false,
  voiceover: true, metadata: true, publish: true,
};

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

function toDateTimeInput(value) {
  const date = value ? new Date(value) : new Date();
  const local = new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
  return local.toISOString().slice(0, 16);
}

function defaultDesignatedDate() {
  const date = new Date();
  date.setHours(9, 0, 0, 0);
  return toDateTimeInput(date);
}

function defaultScheduleForRow(designatedDate, index, intervalDays = 1) {
  const date = new Date(designatedDate || defaultDesignatedDate());
  date.setDate(date.getDate() + (index * Math.max(1, Number(intervalDays) || 1)));
  return date.toISOString();
}

function canAutomateScrapedVideo(item) {
  return Boolean(item.selected) && !item.isUploaded && (!item.isLongVideo || item.longVideoEnabled);
}

export default function AutomationHub({ openProofKey = 0, onQueued, youtubeAuthorizations = [] }) {
  const [tab, setTab] = useState('planner');
  const [plannerStep, setPlannerStep] = useState('sources');
  const [sourceTab, setSourceTab] = useState('generate');
  const [presets, setPresets] = useState([]);
  const [presetId, setPresetId] = useState('edit-and-publish');
  const [sourceType, setSourceType] = useState('bilibili');
  const [sourceText, setSourceText] = useState('');
  const [uploads, setUploads] = useState([]);
  const [uploading, setUploading] = useState({ active: false, complete: 0, total: 0 });
  const [batchName, setBatchName] = useState('');
  const [campaign, setCampaign] = useState('');
  const [language, setLanguage] = useState('auto');
  const [designatedDate, setDesignatedDate] = useState(defaultDesignatedDate);
  const [scheduleEveryDays, setScheduleEveryDays] = useState(1);
  const [youtubeOptions, setYoutubeOptions] = useState(DEFAULT_YOUTUBE_OPTIONS);
  const [aspectRatio, setAspectRatio] = useState('source');
  const [faceSource, setFaceSource] = useState('');
  const [steps, setSteps] = useState(DEFAULT_STEPS);
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
  const [catalogSearchOpen, setCatalogSearchOpen] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [showUploaded, setShowUploaded] = useState(false);
  const [catalogSummary, setCatalogSummary] = useState({ loadedCount: 0, uploadedCount: 0 });
  const [reviewSaving, setReviewSaving] = useState('');
  const [aiPreviewing, setAiPreviewing] = useState('');
  const [localAuthorizations, setLocalAuthorizations] = useState([]);
  const [savedAutomationSettings, setSavedAutomationSettings] = useState([]);
  const [savedAutomationSettingId, setSavedAutomationSettingId] = useState('');
  const [settingsName, setSettingsName] = useState('Bilibili automation');
  const [savingAutomationSettings, setSavingAutomationSettings] = useState(false);
  const fileInput = useRef(null);

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
  useEffect(() => {
    fetch('/api/control/operations/automation-settings?limit=20', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('Could not load saved automation settings')))
      .then((payload) => setSavedAutomationSettings(payload.settings || []))
      .catch(() => setSavedAutomationSettings([]));
  }, []);
  useEffect(() => {
    if (sourceType === 'bilibili') loadSavedBilibiliReview();
  }, [sourceType]);

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

  function automationSettingsPayload() {
    return {
      sourceType, presetId, batchName, campaign, language, designatedDate, scheduleEveryDays,
      steps: { ...steps }, aspectRatio, faceSource, ocrRegion,
      youtubeOptions: { ...youtubeOptions }, youtubeAuthorizationId,
    };
  }

  function applyAutomationSettings(setting) {
    const saved = setting?.settings || {};
    const allowedSourceTypes = new Set(['bilibili', 'localFile', 'douyin']);
    setSourceType(allowedSourceTypes.has(saved.sourceType) ? saved.sourceType : 'bilibili');
    setPresetId(saved.presetId || 'edit-and-publish');
    setBatchName(saved.batchName || '');
    setCampaign(saved.campaign || '');
    setLanguage(saved.language || 'auto');
    setDesignatedDate(saved.designatedDate || defaultDesignatedDate());
    setScheduleEveryDays(Math.max(1, Number(saved.scheduleEveryDays) || 1));
    setSteps({ ...DEFAULT_STEPS, ...(saved.steps || {}) });
    setAspectRatio(saved.aspectRatio || 'source');
    setFaceSource(saved.faceSource || '');
    setOcrRegion(saved.ocrRegion || 'full');
    setYoutubeOptions({ ...DEFAULT_YOUTUBE_OPTIONS, ...(saved.youtubeOptions || {}) });
    setYoutubeAuthorizationId(saved.youtubeAuthorizationId || '');
    setSavedAutomationSettingId(setting.id);
    setSettingsName(setting.name || 'Bilibili automation');
    setPlannerStep('automation');
    setNotice(`Loaded “${setting.name}”. Edit it, then save to update the SQL-backed setting.`);
  }

  async function saveCurrentAutomationSettings() {
    setSavingAutomationSettings(true);
    setError('');
    try {
      const response = await fetch('/api/control/operations/automation-settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: savedAutomationSettingId, name: settingsName, settings: automationSettingsPayload() }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not save automation settings');
      const saved = payload.setting;
      setSavedAutomationSettingId(saved.id);
      setSavedAutomationSettings((current) => [saved, ...current.filter((setting) => setting.id !== saved.id)]);
      setNotice(`Saved “${saved.name}” to the automation settings library.`);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSavingAutomationSettings(false);
    }
  }

  const typedSources = useMemo(() => sourceText.split(/\r?\n/).map((value) => value.trim()).filter(Boolean), [sourceText]);
  const selectedReviewUrls = useMemo(() => new Set(bilibiliReview.map((item) => item.url)), [bilibiliReview]);
  const reviewIndexByKey = useMemo(() => new Map(bilibiliReview.map((item, index) => [`${item.creatorId}:${item.bvid}`, index])), [bilibiliReview]);
  const visibleBilibiliReview = useMemo(() => {
    const query = catalogQuery.trim().toLowerCase();
    return bilibiliReview.filter((item) => (showUploaded || !item.isUploaded) && (!query || [item.title, item.description, item.bvid, item.creatorId, item.uploadedAt]
      .some((value) => String(value || '').toLowerCase().includes(query))));
  }, [bilibiliReview, catalogQuery, showUploaded]);
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
      ...(sourceType === 'bilibili' ? bilibiliReview.filter(canAutomateScrapedVideo).map((item) => ({
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
        method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(video.updatedAt ? { 'If-Match': video.updatedAt } : {}) },
        body: JSON.stringify({
          creatorId: video.creatorId, bvid: video.bvid, selected: video.selected, title: video.title, description: video.description,
          scheduledFor: video.scheduledFor, scheduleDays: video.scheduleDays, copyPrompt: video.copyPrompt,
          tags: video.tags, generationFields: video.generationFields, youtubeOptions: video.youtubeOptions,
          longVideoEnabled: video.longVideoEnabled,
        }),
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

  function selectReviewRows(selected) {
    bilibiliReview.filter((item) => !item.isUploaded).forEach((item) => editReviewVideo(item, {
      selected: selected && (!item.isLongVideo || item.longVideoEnabled),
    }, true));
  }

  function scheduleForItem(item, index) {
    return item.scheduledFor || defaultScheduleForRow(designatedDate, index, scheduleEveryDays);
  }

  function applyAutoDates(intervalDays = scheduleEveryDays) {
    bilibiliReview.filter(canAutomateScrapedVideo).forEach((item, index) => {
      editReviewVideo(item, { scheduledFor: defaultScheduleForRow(designatedDate, index, intervalDays), scheduleDays: [] }, true);
    });
    setNotice(`Scheduled selected videos every ${intervalDays} day${intervalDays === 1 ? '' : 's'}. You can still override an individual row.`);
  }

  async function testAiPreview(video) {
    const key = `${video.creatorId}:${video.bvid}`;
    setAiPreviewing(key);
    setError('');
    try {
      const response = await fetch('/api/control/operations/bilibili-scrapes/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creatorId: video.creatorId, bvid: video.bvid,
          copyPrompt: video.copyPrompt, generationFields: video.generationFields, provider: 'codex',
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not test the AI title, description, and tags');
      replaceReviewVideo(payload.video);
      setNotice(`AI test run is ready for “${video.sourceTitle || video.title}”. Review it before applying.`);
    } catch (previewError) {
      setError(previewError.message);
    } finally {
      setAiPreviewing('');
    }
  }

  function applyAiPreview(video) {
    const preview = video.aiPreview;
    if (!preview) return;
    editReviewVideo(video, {
      title: preview.title || video.title,
      description: preview.description || video.description,
      tags: preview.tags?.length ? preview.tags : video.tags,
    }, true);
    setNotice('Applied the AI test result to the editable publishing fields.');
  }

  async function loadSavedBilibiliReview(query = '') {
    const creatorIds = [...new Set(typedSources.map(creatorIdFromRef).filter(Boolean))];
    setError(''); setCatalogLoading(true);
    try {
      const responses = await Promise.all((creatorIds.length ? creatorIds : ['']).map(async (creatorId) => {
        const params = new URLSearchParams({ limit: '100', includeUploaded: '1' });
        if (creatorId) params.set('creatorId', creatorId);
        if (query.trim()) params.set('query', query.trim());
        const response = await fetch(`/api/control/operations/bilibili-scrapes?${params.toString()}`, { cache: 'no-store' });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Could not load the saved Bilibili catalog');
        return payload.videos || [];
      }));
      const videos = responses.flat().filter((item, index, list) => list.findIndex((candidate) => candidate.creatorId === item.creatorId && candidate.bvid === item.bvid) === index);
      setBilibiliReview(videos);
      const uploadedCount = videos.filter((video) => video.isUploaded).length;
      setCatalogSummary({ loadedCount: videos.length, uploadedCount });
      const visibleCount = videos.filter((video) => !video.isUploaded).length;
      setNotice(`${visibleCount} saved Bilibili video${visibleCount === 1 ? '' : 's'} ready for review${uploadedCount ? `; ${uploadedCount} already uploaded and omitted.` : '.'}`);
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
    const processorIds = STEP_ORDER.filter((step) => step.id !== 'publish' && steps[step.id]).map((step) => step.id);
    try {
      const response = await fetch('/api/control/operations/batches', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: batchName || `${campaign || 'Video'} batch`,
          presetId,
          options: automationSettingsPayload(),
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
            priority: 0,
            scheduledFor: scheduleForItem(item, index),
            options: {
              sceneCut: { aspectRatio, encodingPreset: 'medium', crf: 20 },
              faceFusion: { sourcePaths: faceSource.trim(), outputVideoQuality: 90 },
              videoContext: { sourceLanguage: language, quality: 'balanced', intervalSeconds: 20, visionMode: 'always' },
              ocrContext: { region: ocrRegion, denseSampling: true, denseInterval: 1, applyCorrections: 'auto' },
              voiceover: { sourceLanguage: language, burnSubtitles: true },
              metadata: {
                reviewMetadata: false, title: item.title, description: item.description || '',
                tags: item.tags || [], generationFields: item.generationFields,
                sourceTitle: item.sourceTitle || item.title, sourceDescription: item.sourceDescription || '',
                sourceUrl: item.url || item.ref, creatorId: item.creatorId || '', bvid: item.bvid || '', uploadedAt: item.uploadedAt || '',
                copyPrompt: item.copyPrompt || '',
              },
              youtube: { ...youtubeOptions, ...(item.youtubeOptions || {}) },
            },
          })),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not queue automation batch');
      setNotice(`${payload.batch.totalItems} videos queued and automation started.`);
      setSourceText('');
      setUploads([]);
      setPlannerStep('sources');
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
      {(plannerStep === 'automation' || tab !== 'planner') && <div className={styles.segmentedTabs} role="tablist" aria-label="Automation tools">
        {[['planner', 'Create automation'], ['runs', 'Automation runs'], ['proof', 'Proof'], ['sources', 'Source tools']].map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? styles.segmentActive : ''} onClick={() => setTab(id)}>{label}</button>)}
      </div>}

      {(notice || error) && <div className={error ? styles.inlineError : styles.inlineNotice}>{error || notice}</div>}

      {tab === 'planner' && <form className={`${styles.plannerGrid} ${plannerStep === 'sources' ? styles.plannerGridSources : ''}`} onSubmit={createBatch}>
        <div className={styles.plannerMain}>
          {sourceType === 'bilibili' ? <section className={styles.scrapeReviewPanel}>
            <div className={styles.scrapeCatalogCommandBar}>
              <div className={styles.catalogSourceControls}>
                <label className={styles.catalogSourceType}><span>Source</span><select value={sourceType} onChange={(event) => setSourceType(event.target.value)} aria-label="Source type"><option value="bilibili">Bilibili</option><option value="localFile">Local file</option><option value="douyin">Douyin</option></select></label>
                <label className={styles.catalogSourceInput}><span>Bilibili creator, video, or ID</span><textarea rows="1" value={sourceText} onChange={(event) => setSourceText(event.target.value)} placeholder="space.bilibili.com/123456" aria-label="Bilibili creator, video, or ID" /></label>
                <button type="button" className={styles.buttonPrimary} disabled={resolving || !typedSources.length} onClick={resolveSources}>{resolving ? 'Updating…' : 'Scrape and save'}</button>
                <button type="button" className={styles.editBtn} disabled={catalogLoading} onClick={() => loadSavedBilibiliReview(catalogQuery)}>{catalogLoading ? 'Loading…' : 'Reload SQL'}</button>
              </div>
              <div className={styles.catalogCommandActions}>
                <label className={styles.compactCommandField}><span>First date</span><input type="datetime-local" value={designatedDate} onChange={(event) => setDesignatedDate(event.target.value)} /></label>
                <label className={styles.compactCommandField}><span>Cadence</span><select value={scheduleEveryDays} onChange={(event) => {
                  const intervalDays = Math.max(1, Number(event.target.value) || 1);
                  setScheduleEveryDays(intervalDays);
                  applyAutoDates(intervalDays);
                }}>{SCHEDULE_INTERVALS.map((days) => <option key={days} value={days}>Every {days} day{days === 1 ? '' : 's'}</option>)}</select></label>
                <button type="button" className={styles.editBtn} onClick={() => applyAutoDates()}>Apply dates</button>
                <span className={styles.catalogSelectionMeta}><strong>{bilibiliReview.filter(canAutomateScrapedVideo).length}</strong> selected · {catalogSummary.loadedCount} SQL rows</span>
                <button type="button" className={styles.editBtn} onClick={() => setShowUploaded((value) => !value)}>{showUploaded ? 'Hide uploaded' : `Show uploaded${catalogSummary.uploadedCount ? ` (${catalogSummary.uploadedCount})` : ''}`}</button>
                <button type="button" className={styles.editBtn} onClick={() => setCatalogSearchOpen((open) => !open)} aria-expanded={catalogSearchOpen}><Search size={13} /> {catalogSearchOpen ? 'Hide search' : 'Search'}</button>
                <button type="button" className={styles.editBtn} onClick={() => selectReviewRows(true)}>Select ready</button>
                <button type="button" className={styles.editBtn} onClick={() => selectReviewRows(false)}>Clear selection</button>
                <button type="button" className={styles.buttonPrimary} disabled={!sourceItems.length} onClick={() => setPlannerStep('automation')}>Next: configure <ChevronRight size={14} /></button>
              </div>
            </div>
            {catalogSearchOpen && <div className={styles.catalogSearchRow}><label className={styles.catalogSearch}><Search size={14} /><input value={catalogQuery} onChange={(event) => setCatalogQuery(event.target.value)} placeholder="Filter loaded catalog or search saved SQL" onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); loadSavedBilibiliReview(catalogQuery); } }} autoFocus /></label><button type="button" className={styles.editBtn} disabled={catalogLoading || !catalogQuery.trim()} onClick={() => loadSavedBilibiliReview(catalogQuery)}>Search SQL</button></div>}
            {resolving && <div className={styles.scrapeLoading} role="status"><LoaderCircle size={20} className={styles.spin} /><div><strong>Scraping creator uploads</strong><span>Saving each available page, then opening the catalog for review.</span></div></div>}
            {bilibiliReview.length > 0 && <div className={styles.catalogReviewBody}>
              <div className={styles.catalogInfoLine}><span>{catalogSummary.uploadedCount ? `${catalogSummary.uploadedCount} already uploaded and omitted from this automation.` : 'SQL catalog checked against upload history.'}</span><span>{visibleBilibiliReview.length} visible · dates follow the selected cadence</span></div>
              <div className={styles.scrapeReviewTableWrap}>
                <table className={styles.scrapeReviewTable}>
                  <thead><tr><th>Include</th><th>Original Bilibili video</th><th>Schedule</th><th>Delivery metadata</th></tr></thead>
                  <tbody>{visibleBilibiliReview.map((item) => {
                    const key = `${item.creatorId}:${item.bvid}`;
                    const index = reviewIndexByKey.get(key) || 0;
                    const scheduledFor = scheduleForItem(item, index);
                    const generationFields = item.generationFields || { title: true, description: true, tags: true };
                    const tags = Array.isArray(item.tags) ? item.tags : [];
                    return <tr key={key}>
                      <td className={styles.scrapeIncludeCell}><input type="checkbox" checked={canAutomateScrapedVideo(item)} disabled={item.isUploaded || (item.isLongVideo && !item.longVideoEnabled)} onChange={(event) => editReviewVideo(item, { selected: event.target.checked }, true)} aria-label={item.isUploaded ? `${item.title} is already uploaded` : item.isLongVideo && !item.longVideoEnabled ? `${item.title} needs a long-video opt-in before it can be included` : `Include ${item.title} in automation`} /></td>
                      <td className={styles.scrapeVideoCell}><strong title={item.sourceTitle || item.title}>{item.sourceTitle || item.title}</strong><small>{item.bvid} · {formatDuration(item.durationSeconds)} · {formatUploadDate(item.uploadedAt)}</small><span className={`${styles.scrapeDurationState} ${item.isLongVideo ? styles.scrapeDurationLong : styles.scrapeDurationReady}`}>{item.isLongVideo ? 'Over 15 min' : 'Under 15 min'}</span>{item.isLongVideo ? <label className={styles.scrapeLongVideoToggle}><input type="checkbox" checked={Boolean(item.longVideoEnabled)} disabled={item.isUploaded} onChange={(event) => editReviewVideo(item, { longVideoEnabled: event.target.checked, selected: event.target.checked ? item.selected : false }, true)} aria-label={`${item.longVideoEnabled ? 'Disable' : 'Enable'} ${item.title} for long-video automation`} />{item.longVideoEnabled ? 'Long video enabled' : 'Long video disabled'}</label> : null}<span className={`${styles.scrapeDeliveryState} ${deliveryStateClass(item.deliveryState)}`}>{DELIVERY_STATE_LABELS[item.deliveryState] || DELIVERY_STATE_LABELS.available}</span>{item.uploadedUrl ? <a className={styles.scrapeDeliveryLink} href={item.uploadedUrl} target="_blank" rel="noreferrer">Open upload</a> : null}</td>
                      <td className={styles.scrapeScheduleCell}><input type="datetime-local" value={toDateTimeInput(scheduledFor)} onChange={(event) => editReviewVideo(item, { scheduledFor: new Date(event.target.value).toISOString() })} onBlur={(event) => saveReviewVideo({ ...item, scheduledFor: new Date(event.target.value).toISOString() })} aria-label={`Publishing date for ${item.title}`} /></td>
                      <td className={styles.scrapeMetadataCell}>
                        <details className={styles.metadataDetails}>
                          <summary><span><strong>{item.title || 'Set delivery title'}</strong><small>{tags.length ? `${tags.slice(0, 3).join(', ')}${tags.length > 3 ? '…' : ''}` : 'Title, description, tags, and AI prompt'}</small></span><span className={styles.metadataDetailsAction}>Edit</span></summary>
                          <div className={styles.metadataDetailsBody}>
                            <label className={styles.compactField}><span>AI prompt for video title, description &amp; tags</span><textarea rows="2" value={item.copyPrompt || ''} onChange={(event) => editReviewVideo(item, { copyPrompt: event.target.value })} onBlur={(event) => saveReviewVideo({ ...item, copyPrompt: event.target.value })} placeholder="Describe the audience and angle for the AI." aria-label={`AI prompt for ${item.sourceTitle || item.title}`} /></label>
                            <div className={styles.generationFieldPicker} aria-label={`AI-generated fields for ${item.title}`}>{['title', 'description', 'tags'].map((field) => <label key={field}><input type="checkbox" checked={Boolean(generationFields[field])} onChange={(event) => editReviewVideo(item, { generationFields: { ...generationFields, [field]: event.target.checked } }, true)} /> AI generates {field}</label>)}</div>
                            <div className={styles.metadataEditGrid}>
                              <label className={styles.compactField}><span>Title</span><input value={item.title} onChange={(event) => editReviewVideo(item, { title: event.target.value })} onBlur={(event) => saveReviewVideo({ ...item, title: event.target.value })} aria-label={`Publishing title for ${item.sourceTitle || item.title}`} /></label>
                              <label className={styles.compactField}><span>Description</span><textarea rows="2" value={item.description} onChange={(event) => editReviewVideo(item, { description: event.target.value })} onBlur={(event) => saveReviewVideo({ ...item, description: event.target.value })} aria-label={`Publishing description for ${item.sourceTitle || item.title}`} /></label>
                              <label className={styles.compactField}><span>Tags</span><input value={tags.join(', ')} onChange={(event) => editReviewVideo(item, { tags: event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean) })} onBlur={(event) => saveReviewVideo({ ...item, tags: event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean) })} placeholder="tag one, tag two" aria-label={`Publishing tags for ${item.sourceTitle || item.title}`} /></label>
                            </div>
                            <div className={styles.bilibiliActions}><button type="button" className={styles.editBtn} disabled={aiPreviewing === key || !Object.values(generationFields).some(Boolean)} onClick={() => testAiPreview(item)}>{aiPreviewing === key ? 'Testing Codex…' : 'Test with Codex'}</button>{item.aiPreview && <button type="button" className={styles.editBtn} onClick={() => applyAiPreview(item)}>Apply test result</button>}{reviewSaving === key ? <small>Saving…</small> : null}</div>
                            {item.aiPreview && <div className={styles.aiPreview}><strong>Test result · {item.aiPreview.provider}/{item.aiPreview.model}</strong><span>{item.aiPreview.title}</span><small>{item.aiPreview.description}</small><em>{(item.aiPreview.tags || []).join(', ')}</em></div>}
                          </div>
                        </details>
                      </td>
                    </tr>;
                  })}</tbody>
                </table>
              </div>
            </div>}
          </section> : <section className={styles.opsPanel}>
            <div className={styles.opsPanelHeader}><div><h2>Other video source</h2></div><label className={styles.formField}><span>Source type</span><select value={sourceType} onChange={(event) => setSourceType(event.target.value)}><option value="bilibili">Bilibili</option><option value="localFile">Local file</option><option value="douyin">Douyin</option></select></label></div>
            <div className={styles.formGridTwo}><label className={styles.formField}><span>Preset</span><select value={presetId} onChange={(event) => choosePreset(event.target.value)}>{presets.map((preset) => <option value={preset.id} key={preset.id}>{preset.name}</option>)}</select></label><label className={styles.formField}><span>Source language</span><select value={language} onChange={(event) => setLanguage(event.target.value)}><option value="auto">Auto detect</option><option value="en">English</option><option value="zh">Chinese</option></select></label></div>
            {sourceType === 'localFile' && <div className={styles.dropZone} role="button" tabIndex="0" onClick={() => fileInput.current?.click()} onKeyDown={(event) => (event.key === 'Enter' || event.key === ' ') && fileInput.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); uploadFiles(event.dataTransfer.files); }}><UploadCloud size={24} /><strong>{uploading.active ? `Importing ${uploading.complete} of ${uploading.total}` : 'Drop video files or choose from disk'}</strong><span>MP4, MOV, MKV, WebM, or M4V</span><input ref={fileInput} type="file" accept="video/*,.mkv,.m4v" multiple hidden onChange={(event) => uploadFiles(event.target.files)} /></div>}
            <label className={styles.formField}><span>{sourceType === 'localFile' ? 'Server paths' : 'Video URLs'} · one per line</span><textarea rows="5" value={sourceText} onChange={(event) => setSourceText(event.target.value)} placeholder={sourceType === 'localFile' ? '/absolute/path/video-01.mp4' : 'https://...'} /></label>
            {uploads.length > 0 && <div className={styles.uploadList}>{uploads.map((item, index) => <div key={item.path}><FileVideo size={14} /><span>{item.name}</span><small>{item.probe.width}x{item.probe.height}</small><button type="button" onClick={() => setUploads((current) => current.filter((_, itemIndex) => itemIndex !== index))} title="Remove imported video" aria-label={`Remove ${item.name}`}><X size={14} /></button></div>)}</div>}
            <div className={styles.operationRow}><span className={styles.connectionMeta}>Choose your sources before configuring automation and delivery.</span><button type="button" className={styles.buttonPrimary} disabled={!sourceItems.length} onClick={() => setPlannerStep('automation')}>Next: configure automation <ChevronRight size={14} /></button></div>
          </section>}

          {plannerStep === 'automation' && <section className={styles.opsPanel}>
            <div className={styles.opsPanelHeader}><div><span className={styles.eyebrow}>02 · Workflow</span><h2>Automatic run list</h2></div></div>
            <div className={styles.stepChecklist}>
              {STEP_ORDER.map((step, index) => <label key={step.id} className={steps[step.id] ? styles.stepChecked : ''}><input type="checkbox" checked={Boolean(steps[step.id])} onChange={(event) => toggleStep(step.id, event.target.checked)} /><span className={styles.checkVisual}>{steps[step.id] ? <Check size={13} /> : null}</span><span className={styles.stepIndex}>{String(index + 1).padStart(2, '0')}</span><strong>{step.label}{step.requires ? <small>requires Video context</small> : null}</strong><ChevronRight size={14} /></label>)}
            </div>
            <div className={styles.formGridTwo}>
              <label className={styles.formField}><span>Workflow preset</span><select value={presetId} onChange={(event) => choosePreset(event.target.value)}>{presets.map((preset) => <option value={preset.id} key={preset.id}>{preset.name}</option>)}</select></label>
              <label className={styles.formField}><span>Source language</span><select value={language} onChange={(event) => setLanguage(event.target.value)}><option value="auto">Auto detect</option><option value="en">English</option><option value="zh">Chinese</option></select></label>
              <label className={styles.formField}><span>Output format</span><select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)}><option value="source">Keep source</option><option value="16:9">16:9 · 1280x720</option><option value="9:16">9:16 · 720x1280</option><option value="1:1">1:1 · 1080x1080</option></select></label>
              {steps.faceFusion && <label className={styles.formField}><span>Face source image path</span><input value={faceSource} onChange={(event) => setFaceSource(event.target.value)} placeholder="/absolute/path/face.jpg" /></label>}
              {steps.ocrContext ? <label className={styles.formField}><span>OCR region</span><select value={ocrRegion} onChange={(event) => setOcrRegion(event.target.value)}><option value="full">Full frame</option><option value="bottom">Bottom · burned-in subtitles</option><option value="top">Top · titles</option></select></label> : null}
            </div>
            {steps.videoContext ? <div className={styles.contextHealthLine}>
              <span>Image recognition</span>
              <strong>{visionStatus?.chain?.map((item) => item.label).join(' → ') || 'Gemini → Codex CLI → Kimi'}</strong>
              <em>{visionStatus?.configured ? 'ready' : 'configure in Connections'}</em>
            </div> : null}
          </section>}
        </div>

        {plannerStep === 'automation' && <aside className={styles.plannerRail}>
          <section className={styles.opsPanel}>
            <div className={styles.opsPanelHeader}><div><span className={styles.eyebrow}>03 · Automation</span><h2>Settings and delivery</h2></div><button type="button" className={styles.buttonSecondary} onClick={() => setPlannerStep('sources')}>Edit sources</button></div>
            <div className={styles.savedAutomationSettings}>
              <label className={styles.formField}><span>Saved automation setting</span><select value={savedAutomationSettingId} onChange={(event) => {
                const setting = savedAutomationSettings.find((item) => item.id === event.target.value);
                if (setting) applyAutomationSettings(setting);
                else setSavedAutomationSettingId('');
              }}><option value="">New setting</option>{savedAutomationSettings.map((setting) => <option key={setting.id} value={setting.id}>{setting.name}</option>)}</select></label>
              <label className={styles.formField}><span>Setting name</span><input value={settingsName} onChange={(event) => setSettingsName(event.target.value)} placeholder="Bilibili automation" /></label>
              <button type="button" className={styles.buttonSecondary} disabled={savingAutomationSettings} onClick={saveCurrentAutomationSettings}>{savingAutomationSettings ? 'Saving…' : 'Save automation settings'}</button>
              <small className={styles.connectionMeta}>Saved settings are reusable SQL records. Updating one never changes jobs already dispatched.</small>
            </div>
            <label className={styles.formField}><span>Batch name</span><input value={batchName} onChange={(event) => setBatchName(event.target.value)} placeholder="August launch" /></label>
            <label className={styles.formField}><span>Campaign</span><input value={campaign} onChange={(event) => setCampaign(event.target.value)} placeholder="Campaign or series" /></label>
            {steps.publish && <PublishTarget authorizations={localAuthorizations} value={youtubeAuthorizationId} onChange={setYoutubeAuthorizationId} durationSeconds={Math.max(0, ...sourceItems.map((item) => Number(item.durationSeconds) || 0))} />}
            {steps.publish && <div className={styles.youtubeOptions}>
              <div><span className={styles.eyebrow}>YouTube delivery</span><p>Tags are intentionally blank: the AI metadata step creates them from each row’s copy brief.</p></div>
              <div className={styles.formGridTwo}>
                <label className={styles.formField}><span>Visibility</span><select value={youtubeOptions.privacyStatus} onChange={(event) => setYoutubeOptions((current) => ({ ...current, privacyStatus: event.target.value }))}><option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option></select></label>
                <label className={styles.formField}><span>Category</span><select value={youtubeOptions.categoryId} onChange={(event) => setYoutubeOptions((current) => ({ ...current, categoryId: event.target.value }))}><option value="">AI / leave unset</option><option value="22">People & Blogs</option><option value="24">Entertainment</option><option value="27">Education</option><option value="28">Science & Technology</option></select></label>
                <label className={styles.formField}><span>Video language</span><select value={youtubeOptions.defaultLanguage} onChange={(event) => setYoutubeOptions((current) => ({ ...current, defaultLanguage: event.target.value }))}><option value="">Unspecified</option><option value="en">English</option><option value="zh">Chinese</option></select></label>
                <label className={styles.formField}><span>License</span><select value={youtubeOptions.license} onChange={(event) => setYoutubeOptions((current) => ({ ...current, license: event.target.value }))}><option value="youtube">Standard</option><option value="creativeCommon">Creative Commons</option></select></label>
              </div>
              <div className={styles.youtubeChecks}>
                <label><input type="checkbox" checked={youtubeOptions.madeForKids} onChange={(event) => setYoutubeOptions((current) => ({ ...current, madeForKids: event.target.checked }))} /> Made for kids</label>
                <label><input type="checkbox" checked={youtubeOptions.embeddable} onChange={(event) => setYoutubeOptions((current) => ({ ...current, embeddable: event.target.checked }))} /> Allow embedding</label>
                <label><input type="checkbox" checked={youtubeOptions.notifySubscribers} onChange={(event) => setYoutubeOptions((current) => ({ ...current, notifySubscribers: event.target.checked }))} /> Notify subscribers</label>
              </div>
            </div>}
            <div className={styles.batchSummary}>
              <div><span>Videos</span><strong>{sourceItems.length}</strong></div>
              <div><span>Steps each</span><strong>{Object.values(steps).filter(Boolean).length}</strong></div>
              <div><span>Mode</span><strong>Scheduled</strong></div>
            </div>
            <button type="submit" className={styles.launchButton} disabled={submitting || uploading.active || sourceItems.length === 0}>{submitting ? <LoaderCircle size={16} className={styles.spin} /> : <Play size={16} fill="currentColor" />} Queue and run</button>
          </section>
        </aside>}
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
