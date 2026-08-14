'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseSubtitle, parseSubtitleTimestamp } from '@/lib/studio/subtitles';
import styles from '../app/page.module.css';

const QUALITY_OPTIONS = [
  ['fast', 'Fast'], ['balanced', 'Balanced'], ['best', 'Best'],
];

const STAGES = [
  { id: 'transcribe', label: '1. Transcribe' },
  { id: 'frames', label: '2. Timed screenshots' },
  { id: 'context', label: '3. Kimi context' },
  { id: 'correct', label: '4. Context Whisper' },
  { id: 'translate', label: '5. Translate' },
];

const EMPTY_ANALYSIS = { tone: '', schema: '' };
const LAST_WATCHED_PROJECT_KEY = 'subtitle-studio:last-watched-project:v1';
const NEW_UPLOAD_JOB_KEY = '__new-upload__';
const ACTIVE_PIPELINE_STATUSES = new Set(['queued', 'running']);

function stageState(project, id) {
  return project?.stageStatus?.[id] || { status: 'pending', detail: '' };
}

function isActivePipelineJob(job) {
  return Boolean(job && ACTIVE_PIPELINE_STATUSES.has(job.status));
}

function projectActivity(project, job) {
  if (job) {
    return {
      label: job.status === 'running'
        ? `${job.stageLabel || 'Processing'}`
        : (job.status === 'queued' ? 'Queued' : (job.status === 'done' ? 'Ready' : 'Needs attention')),
      detail: job.detail || '',
      tone: job.status,
    };
  }
  const remoteStage = STAGES.find((stage) => stageState(project, stage.id).status === 'running');
  if (remoteStage) {
    return {
      label: remoteStage.label.replace(/^\d+\.\s*/, ''),
      detail: stageState(project, remoteStage.id).detail || 'Processing',
      tone: 'running',
    };
  }
  return {
    label: project.hasSubtitles ? 'Ready to watch' : (project.hasTranscript ? 'Transcript ready' : 'Not processed'),
    detail: '',
    tone: project.hasSubtitles || project.hasTranscript ? 'done' : 'idle',
  };
}

function ProjectRow({
  item,
  active,
  job,
  watchDisabled,
  onWatch,
  onProcess,
}) {
  const activity = projectActivity(item, job);
  const processing = isActivePipelineJob(job)
    || STAGES.some((stage) => stageState(item, stage.id).status === 'running');
  return (
    <article className={`${styles.studioProjectItem} ${active ? styles.studioProjectActive : ''}`}>
      <button className={styles.studioProjectWatch} onClick={() => onWatch(item.id)} disabled={watchDisabled}>
        <span className={styles.studioProjectNameRow}>
          <strong>{item.name}</strong>
          {active ? <em>Watching</em> : null}
        </span>
        <span>{new Date(item.updatedAt).toLocaleString()}</span>
      </button>
      <div className={styles.studioProjectActivity}>
        <span className={`${styles.studioProjectStatus} ${styles[`studioProjectStatus_${activity.tone}`] || ''}`}
          title={activity.detail}>
          {activity.label}
        </span>
        <button className={styles.studioProjectProcess} onClick={() => onProcess(item.id)}
          disabled={processing}>
          {processing ? 'Running' : 'Process'}
        </button>
      </div>
    </article>
  );
}

async function readJson(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status})`);
    error.code = data.code;
    error.status = response.status;
    error.projectId = data.projectId;
    throw error;
  }
  return data;
}

function StageRow({ stage, project, busy, checked, onToggle, disabled }) {
  const state = stageState(project, stage.id);
  const running = busy === stage.id || state.status === 'running';
  return (
    <label className={styles.studioStage}>
      <input className={styles.studioStageCheck} type="checkbox" checked={checked}
        onChange={(event) => onToggle(stage.id, event.target.checked)} disabled={disabled} />
      <span className={`${styles.studioStageDot} ${styles[`studioStage_${running ? 'running' : state.status}`] || ''}`} />
      <div className={styles.studioStageCopy}>
        <strong>{stage.label}</strong>
        <span>{running ? 'Working' : state.detail || state.status}</span>
      </div>
    </label>
  );
}

function nearestTimestamp(text, cursor) {
  const lineStart = text.lastIndexOf('\n', Math.max(0, cursor - 1)) + 1;
  const lineEnd = text.indexOf('\n', cursor);
  const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
  const match = line.match(/\d{1,3}:\d{2}:\d{2}[.,]\d{1,3}/);
  if (!match) return null;
  try { return parseSubtitleTimestamp(match[0]); } catch { return null; }
}

export default function SubtitleStudio({ channels = [], youtubeAuthorizations = [], onPublished }) {
  const [projects, setProjects] = useState([]);
  const [project, setProject] = useState(null);
  const [file, setFile] = useState(null);
  const [showAddVideo, setShowAddVideo] = useState(false);
  const [quality, setQuality] = useState('fast');
  const [sourceLang, setSourceLang] = useState('zh');
  const [targetLang, setTargetLang] = useState('en');
  const [health, setHealth] = useState(null);
  const [contextStatus, setContextStatus] = useState(null);
  const [captureIntervalSeconds, setCaptureIntervalSeconds] = useState(15);
  const [maxContextFrames, setMaxContextFrames] = useState(120);
  const [busy, setBusy] = useState('');
  const [pipelineJobs, setPipelineJobs] = useState({});
  const [selectedStages, setSelectedStages] = useState(() => Object.fromEntries(STAGES.map((stage) => [stage.id, true])));
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [editorMode, setEditorMode] = useState('transcript');
  const [editorText, setEditorText] = useState('');
  const [baseline, setBaseline] = useState('');
  const [analysisStatus, setAnalysisStatus] = useState(null);
  const [analysisProvider, setAnalysisProvider] = useState('');
  const [analysisDraft, setAnalysisDraft] = useState(EMPTY_ANALYSIS);
  const [analysisBaseline, setAnalysisBaseline] = useState(EMPTY_ANALYSIS);
  const [currentTime, setCurrentTime] = useState(0);
  const [instruction, setInstruction] = useState('');
  const [model, setModel] = useState('moonshot-v1-32k');
  const [temperature, setTemperature] = useState(0.25);
  const [downloadFormat, setDownloadFormat] = useState('ass');
  const [publishOptions, setPublishOptions] = useState({
    voiceover: true,
    burnSubtitles: true,
    metadata: true,
    reviewMetadata: false,
    upload: false,
    authorizationId: '',
    channelId: '',
  });
  const [autoPublishEnabled, setAutoPublishEnabled] = useState(false);
  const fileInputRef = useRef(null);
  const videoRef = useRef(null);
  const pipelineLocksRef = useRef(new Set());
  const watchProjectIdRef = useRef(null);
  const usableYouTubeAuthorizations = useMemo(
    () => youtubeAuthorizations.filter((authorization) => authorization.enabled
      && ['configured', 'active'].includes(authorization.status)),
    [youtubeAuthorizations],
  );

  const dirty = editorText !== baseline;
  const analysisDirty = analysisDraft.tone !== analysisBaseline.tone
    || analysisDraft.schema !== analysisBaseline.schema;
  const hasUnsavedChanges = dirty || analysisDirty;

  useEffect(() => {
    watchProjectIdRef.current = project?.id || null;
  }, [project?.id]);

  const applyProject = useCallback((next, preferredMode) => {
    watchProjectIdRef.current = next?.id || null;
    setProject(next);
    const nextSourceLang = next?.sourceLang || 'zh';
    const nextTargetLang = next?.targetLang || 'en';
    setSourceLang(nextSourceLang);
    setTargetLang(nextTargetLang);
    if (nextSourceLang === nextTargetLang) {
      setSelectedStages((current) => ({ ...current, translate: false }));
    }
    setQuality(next?.quality || 'fast');
    setCaptureIntervalSeconds(Number(next?.contextSettings?.intervalSeconds) || 15);
    setMaxContextFrames(Number(next?.contextSettings?.maxFrames) || 120);
    const mode = preferredMode || (next?.subtitleText ? 'subtitle' : 'transcript');
    const text = mode === 'subtitle'
      ? (next?.subtitleText || '')
      : (mode === 'context' ? (next?.contextMd || '') : (next?.transcriptMd || ''));
    const nextAnalysis = {
      tone: next?.analysis?.tone || '',
      schema: next?.analysis?.schema || '',
    };
    setEditorMode(mode);
    setEditorText(text);
    setBaseline(text);
    setAnalysisDraft(nextAnalysis);
    setAnalysisBaseline(nextAnalysis);
  }, []);

  const rememberWatchedProject = useCallback((id) => {
    try {
      if (id) window.localStorage.setItem(LAST_WATCHED_PROJECT_KEY, String(id));
      else window.localStorage.removeItem(LAST_WATCHED_PROJECT_KEY);
    } catch {
      // Storage can be unavailable in private or restricted browser contexts.
    }
  }, []);

  const loadProjects = useCallback(async () => {
    const data = await readJson(await fetch('/api/control/studio/project?limit=50', { cache: 'no-store' }));
    const nextProjects = data.projects || [];
    setProjects(nextProjects);
    return nextProjects;
  }, []);

  const fetchProject = useCallback(async (id) => {
    const data = await readJson(await fetch(`/api/control/studio/project/${id}`, { cache: 'no-store' }));
    return data.project;
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      const available = await loadProjects();
      if (!active || !available.length) return;
      let storedId = '';
      try {
        storedId = window.localStorage.getItem(LAST_WATCHED_PROJECT_KEY) || '';
      } catch {
        // Fall back to the most recently updated project.
      }
      const target = available.find((item) => String(item.id) === storedId) || available[0];
      const next = await fetchProject(target.id);
      if (!active) return;
      applyProject(next);
      rememberWatchedProject(next.id);
    })().catch((nextError) => {
      if (active) setError(nextError.message);
    });
    return () => { active = false; };
  }, [applyProject, fetchProject, loadProjects, rememberWatchedProject]);

  const watchProject = useCallback(async (id, { reload = false } = {}) => {
    if (!reload && String(project?.id || '') === String(id)) return project;
    if (hasUnsavedChanges && !window.confirm('Discard unsaved changes and watch another project?')) {
      return null;
    }
    const next = await fetchProject(id);
    applyProject(next);
    rememberWatchedProject(next.id);
    setCurrentTime(0);
    setError('');
    setNotice('');
    return next;
  }, [applyProject, fetchProject, hasUnsavedChanges, project, rememberWatchedProject]);

  useEffect(() => {
    let active = true;
    fetch('/api/control/studio/analyze', { cache: 'no-store' })
      .then(readJson)
      .then((data) => {
        if (!active) return;
        setAnalysisStatus(data);
        setAnalysisProvider(data.selected
          || data.providers?.find((item) => item.configured)?.id
          || data.providers?.[0]?.id
          || '');
      })
      .catch((nextError) => { if (active) setError(nextError.message); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    fetch('/api/control/studio/publish', { cache: 'no-store' })
      .then(readJson)
      .then((data) => {
        if (!active) return;
        setAutoPublishEnabled(Boolean(data.autoPublish?.enabled));
        if (data.autoPublish?.enabled && data.autoPublish?.options) {
          setPublishOptions((current) => ({ ...current, ...data.autoPublish.options }));
        }
      })
      .catch((nextError) => { if (active) setError(nextError.message); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (usableYouTubeAuthorizations.length
      && !usableYouTubeAuthorizations.some((authorization) => authorization.id === publishOptions.authorizationId)) {
      setPublishOptions((current) => ({
        ...current,
        authorizationId: usableYouTubeAuthorizations[0].id,
        channelId: '',
      }));
    } else if (!usableYouTubeAuthorizations.length
      && (publishOptions.authorizationId || (!publishOptions.channelId && channels[0]?.id))) {
      setPublishOptions((current) => ({
        ...current,
        authorizationId: '',
        channelId: current.channelId || String(channels[0]?.id || ''),
      }));
    }
  }, [channels, publishOptions.authorizationId, publishOptions.channelId, usableYouTubeAuthorizations]);

  useEffect(() => {
    let active = true;
    fetch(`/api/control/studio/transcribe?quality=${quality}`, { cache: 'no-store' })
      .then(readJson)
      .then((data) => { if (active) setHealth(data); })
      .catch((nextError) => { if (active) setHealth({ ready: false, error: nextError.message }); });
    return () => { active = false; };
  }, [quality]);

  useEffect(() => {
    let active = true;
    fetch('/api/control/studio/context', { cache: 'no-store' })
      .then(readJson)
      .then((data) => { if (active) setContextStatus(data); })
      .catch((nextError) => {
        if (active) setContextStatus({ configured: false, error: nextError.message });
      });
    return () => { active = false; };
  }, []);

  const cues = useMemo(() => {
    const text = editorMode === 'subtitle' ? editorText : project?.subtitleText;
    if (!text) return [];
    try { return parseSubtitle(text, 'ass'); } catch { return []; }
  }, [editorMode, editorText, project?.subtitleText]);

  const activeCue = useMemo(
    () => cues.find((cue) => currentTime >= cue.start && currentTime < cue.end) || null,
    [cues, currentTime],
  );

  const activeContext = useMemo(
    () => (project?.contextManifest || []).find((item) => {
      const start = Number.isFinite(Number(item.windowStart))
        ? Number(item.windowStart)
        : (Number(item.windowStartMs) / 1000);
      const end = Number.isFinite(Number(item.windowEnd))
        ? Number(item.windowEnd)
        : (Number(item.windowEndMs) / 1000);
      return currentTime >= start && currentTime < end;
    }) || null,
    [currentTime, project?.contextManifest],
  );
  const activeContextTerms = useMemo(() => {
    if (!activeContext) return '';
    return [
      ...(activeContext.technicalTerms || []),
      ...(activeContext.visibleText || []),
      ...(activeContext.entities || []),
    ].slice(0, 10).join(' · ');
  }, [activeContext]);

  const resetMessages = () => { setError(''); setNotice(''); };

  const updateSourceLanguage = (value) => {
    setSourceLang(value);
    if (value === targetLang) setSelectedStages((current) => ({ ...current, translate: false }));
  };

  const updateTargetLanguage = (value) => {
    setTargetLang(value);
    if (value === sourceLang) setSelectedStages((current) => ({ ...current, translate: false }));
  };

  const updatePipelineJob = (key, patch) => {
    setPipelineJobs((current) => ({
      ...current,
      [key]: {
        ...(current[key] || {}),
        key,
        ...patch,
      },
    }));
  };

  const executeTranscription = async (currentProject, options, uploadedFile) => {
    let request;
    if (uploadedFile) {
      const form = new FormData();
      form.set('file', uploadedFile);
      form.set('quality', options.quality);
      form.set('sourceLang', options.sourceLang);
      form.set('targetLang', options.targetLang);
      request = fetch('/api/control/studio/transcribe', { method: 'POST', body: form });
    } else if (currentProject?.hasVideo) {
      request = fetch('/api/control/studio/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: currentProject.id,
          quality: options.quality,
          sourceLang: options.sourceLang,
          targetLang: options.targetLang,
        }),
      });
    } else {
      throw new Error('Choose a video or load a project with an uploaded video.');
    }
    const data = await readJson(await request);
    return data.project;
  };

  const executeStage = async (stage, currentProject, options) => {
    const endpoints = {
      frames: 'frames', context: 'context', correct: 'correct', translate: 'translate',
    };
    const data = await readJson(await fetch(`/api/control/studio/${endpoints[stage]}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: currentProject.id,
        from: options.sourceLang,
        to: options.targetLang,
        model: options.model,
        temperature: options.temperature,
        intervalSeconds: options.captureIntervalSeconds,
        maxFrames: options.maxContextFrames,
        quality: options.quality,
      }),
    }));
    return { project: data.project, skipped: Boolean(data.skipped), message: data.message || '' };
  };

  const startBackgroundPipeline = async ({
    initialProject = null,
    projectId = initialProject?.id || '',
    uploadedFile = null,
    options,
  }) => {
    const initialKey = projectId || NEW_UPLOAD_JOB_KEY;
    if (pipelineLocksRef.current.has(initialKey)) return;
    const summary = projectId
      ? projects.find((item) => String(item.id) === String(projectId))
      : null;
    if (summary && STAGES.some((stage) => stageState(summary, stage.id).status === 'running')) {
      setError(`${summary.name} is already processing.`);
      return;
    }
    pipelineLocksRef.current.add(initialKey);
    const selected = STAGES.filter((stage) => options.stageSelection[stage.id]);
    let currentProject = initialProject;
    let jobKey = initialKey;
    let resolvedProjectId = projectId;
    let resolvedName = uploadedFile?.name || initialProject?.name || summary?.name || 'New video';
    updatePipelineJob(jobKey, {
      projectId: resolvedProjectId,
      name: resolvedName,
      status: 'queued',
      stageLabel: 'Queued',
      detail: `${selected.length} selected step${selected.length === 1 ? '' : 's'}`,
      startedAt: new Date().toISOString(),
    });
    const completed = [];
    const notes = [];
    try {
      if (!selected.length) throw new Error('Check at least one pipeline step.');
      if (uploadedFile && !options.stageSelection.transcribe) {
        throw new Error('Check Transcribe to process the selected video.');
      }
      if (options.stageSelection.context && (!contextStatus?.configured || contextStatus?.backend !== 'kimiVision')) {
        throw new Error('Configure KIMI_API_KEY and use VISION_BACKEND=kimiVision before building screenshot context.');
      }
      if (options.stageSelection.correct && options.sourceLang === 'auto') {
        throw new Error('Choose an exact source language before running Context Whisper; local auto-detection is not reliable on short cue windows.');
      }
      if (!currentProject && projectId) currentProject = await fetchProject(projectId);
      resolvedName = currentProject?.name || resolvedName;

      if (options.stageSelection.transcribe) {
        updatePipelineJob(jobKey, {
          status: 'running',
          stage: 'transcribe',
          stageLabel: 'Transcribe',
          detail: uploadedFile ? 'Uploading and transcribing' : 'Transcribing in background',
        });
        currentProject = await executeTranscription(currentProject, options, uploadedFile);
        resolvedProjectId = currentProject.id;
        resolvedName = currentProject.name;
        if (uploadedFile) {
          pipelineLocksRef.current.add(resolvedProjectId);
          setPipelineJobs((current) => {
            const previous = current[jobKey] || {};
            const next = { ...current };
            delete next[jobKey];
            next[resolvedProjectId] = {
              ...previous,
              key: resolvedProjectId,
              projectId: resolvedProjectId,
              name: resolvedName,
              status: 'running',
              stage: 'transcribe',
              stageLabel: 'Transcribe',
              detail: 'Transcript ready; continuing selected steps',
            };
            return next;
          });
          jobKey = resolvedProjectId;
          setFile((current) => (current === uploadedFile ? null : current));
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
        await loadProjects();
        completed.push('Transcribe');
      }
      if (!currentProject) throw new Error('Choose a video or load a project before running the pipeline.');

      for (const stage of selected.filter((item) => item.id !== 'transcribe')) {
        if (stage.id === 'frames' && !currentProject.hasVideo) throw new Error('Screenshots require an uploaded video.');
        if (stage.id === 'context' && !currentProject.frameManifest?.length) {
          throw new Error('Check Timed screenshots before Kimi context, or load a project that already has frames.');
        }
        if (stage.id === 'correct' && (!currentProject.contextMd || !currentProject.contextManifest?.length)) {
          throw new Error('Build Kimi context before the context-assisted Whisper pass.');
        }
        if (stage.id === 'translate' && !currentProject.transcriptMd) {
          throw new Error('Translation requires a completed transcript.');
        }
        updatePipelineJob(jobKey, {
          status: 'running',
          stage: stage.id,
          stageLabel: stage.label.replace(/^\d+\.\s*/, ''),
          detail: `Working on ${resolvedName}`,
        });
        const result = await executeStage(stage.id, currentProject, options);
        currentProject = result.project;
        if (result.skipped) notes.push(result.message);
        else completed.push(stage.label.replace(/^\d+\.\s*/, ''));
        await loadProjects();
      }
      updatePipelineJob(jobKey, {
        projectId: currentProject.id,
        name: currentProject.name,
        status: 'done',
        stage: '',
        stageLabel: 'Ready',
        detail: [
          completed.length ? `Completed: ${completed.join(', ')}` : 'No changes',
          ...notes,
        ].filter(Boolean).join(' · '),
        completedAt: new Date().toISOString(),
      });
      await loadProjects();
      if (!watchProjectIdRef.current) {
        applyProject(currentProject, currentProject.subtitleText ? 'subtitle' : 'transcript');
        rememberWatchedProject(currentProject.id);
      }
    } catch (nextError) {
      updatePipelineJob(jobKey, {
        projectId: resolvedProjectId,
        name: resolvedName,
        status: 'failed',
        stage: '',
        stageLabel: 'Failed',
        detail: nextError.message,
        completedAt: new Date().toISOString(),
      });
      if (jobKey === NEW_UPLOAD_JOB_KEY || String(watchProjectIdRef.current || '') === String(resolvedProjectId || '')) {
        setError(`${resolvedName}: ${nextError.message}`);
      }
      await loadProjects().catch(() => {});
    } finally {
      pipelineLocksRef.current.delete(initialKey);
      if (resolvedProjectId) pipelineLocksRef.current.delete(resolvedProjectId);
    }
  };

  const pipelineOptions = (targetProject, useWatchSettings) => ({
    stageSelection: { ...selectedStages },
    sourceLang: useWatchSettings ? sourceLang : (targetProject?.sourceLang || sourceLang),
    targetLang: useWatchSettings ? targetLang : (targetProject?.targetLang || targetLang),
    quality: useWatchSettings ? quality : (targetProject?.quality || quality),
    captureIntervalSeconds: useWatchSettings
      ? captureIntervalSeconds
      : (Number(targetProject?.contextSettings?.intervalSeconds) || captureIntervalSeconds),
    maxContextFrames: useWatchSettings
      ? maxContextFrames
      : (Number(targetProject?.contextSettings?.maxFrames) || maxContextFrames),
    model,
    temperature,
  });

  const runSelectedPipeline = () => {
    resetMessages();
    if (!file && !project) {
      setError('Add a video or choose a project to process.');
      return;
    }
    if (!file && hasUnsavedChanges) {
      setError('Save or discard this project draft before processing it.');
      return;
    }
    const targetProject = file ? null : project;
    void startBackgroundPipeline({
      initialProject: targetProject,
      projectId: targetProject?.id,
      uploadedFile: file,
      options: pipelineOptions(targetProject, true),
    });
  };

  const queueExistingProject = (id) => {
    resetMessages();
    const target = projects.find((item) => String(item.id) === String(id));
    void startBackgroundPipeline({
      projectId: id,
      options: pipelineOptions(target, false),
    });
  };

  const saveEditor = async () => {
    if (!project || !dirty) return;
    resetMessages();
    setBusy('save');
    try {
      const body = editorMode === 'transcript'
        ? { transcriptMd: editorText }
        : (editorMode === 'context'
          ? { contextMd: editorText }
          : { subtitleText: editorText, format: 'ass' });
      const data = await readJson(await fetch(`/api/control/studio/project/${project.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }));
      applyProject(data.project, editorMode);
      setNotice('Saved.');
      await loadProjects();
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setBusy('');
    }
  };

  const runTranscriptAnalysis = async () => {
    if (!project?.transcriptMd || !analysisProvider) return;
    resetMessages();
    setBusy('analyze');
    try {
      const data = await readJson(await fetch('/api/control/studio/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, provider: analysisProvider, temperature }),
      }));
      applyProject(data.project, 'analysis');
      setNotice(`Transcript analyzed with ${data.analysis.providerLabel}. Subtitles were not changed.`);
      await loadProjects();
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setBusy('');
    }
  };

  const useAnalysisInRefine = async () => {
    if (!project?.analysis?.generatedAt || !analysisDirty) return;
    resetMessages();
    const changes = [];
    if (analysisDraft.tone !== analysisBaseline.tone) changes.push(`Tone: ${analysisDraft.tone.trim()}`);
    if (analysisDraft.schema !== analysisBaseline.schema) changes.push(`Overall schema: ${analysisDraft.schema.trim()}`);
    if (!changes.length || changes.some((item) => !item.split(':').slice(1).join(':').trim())) return;
    setBusy('analysis-save');
    try {
      const data = await readJson(await fetch('/api/control/studio/analyze', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          tone: analysisDraft.tone,
          schema: analysisDraft.schema,
        }),
      }));
      const refineInstruction = [
        'Apply only these revised transcript-level editorial settings to the subtitles:',
        ...changes.map((item) => `- ${item}`),
        'Preserve every cue, timestamp, and source-language line.',
      ].join('\n');
      applyProject(data.project, 'analysis');
      setInstruction(refineInstruction);
      setNotice('Analysis changes were added to the refine instruction. Subtitles remain unchanged until Send.');
      await loadProjects();
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setBusy('');
    }
  };

  const refine = async () => {
    if (!project || !instruction.trim()) return;
    resetMessages();
    setBusy('refine');
    try {
      if (dirty && editorMode === 'subtitle') {
        await readJson(await fetch(`/api/control/studio/project/${project.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subtitleText: editorText, format: 'ass' }),
        }));
      }
      const data = await readJson(await fetch('/api/control/studio/refine', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, instruction, model, temperature }),
      }));
      applyProject(data.project, 'subtitle');
      if (!data.unchanged) setInstruction('');
      setNotice(data.message || 'Refine pass saved.');
      await loadProjects();
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setBusy('');
    }
  };

  const resetHistory = async () => {
    if (!project) return;
    resetMessages();
    try {
      const data = await readJson(await fetch('/api/control/studio/refine', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: project.id }),
      }));
      applyProject(data.project, editorMode);
      setNotice('Refine history reset.');
    } catch (nextError) { setError(nextError.message); }
  };

  const updatePublishOption = (key, value) => {
    const next = {
      ...publishOptions,
      [key]: value,
      ...(key === 'voiceover' && !value ? { burnSubtitles: false } : {}),
    };
    setPublishOptions(next);
    if (autoPublishEnabled) {
      fetch('/api/control/studio/publish', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true, options: next }),
      }).then(readJson).catch((nextError) => setError(nextError.message));
    }
  };

  const sendToPipeline = async () => {
    if (!project) return;
    resetMessages();
    setBusy('publish');
    try {
      const data = await readJson(await fetch('/api/control/studio/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, options: publishOptions }),
      }));
      applyProject(data.project, editorMode);
      setNotice(`Pipeline job #${data.job.id} queued.`);
      await loadProjects();
      onPublished?.(data.job);
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setBusy('');
    }
  };

  const saveAutoPublish = async (enabled) => {
    resetMessages();
    setBusy('auto-publish');
    try {
      const data = await readJson(await fetch('/api/control/studio/publish', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, options: publishOptions }),
      }));
      setAutoPublishEnabled(Boolean(data.autoPublish.enabled));
      setNotice(data.autoPublish.enabled ? 'Automatic publishing enabled.' : 'Automatic publishing disabled.');
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setBusy('');
    }
  };

  const deleteProject = async () => {
    if (!project || !window.confirm(`Delete ${project.name} and its local Studio files?`)) return;
    await readJson(await fetch(`/api/control/studio/project/${project.id}`, { method: 'DELETE' }));
    setProject(null);
    rememberWatchedProject(null);
    setEditorText('');
    setBaseline('');
    setAnalysisDraft(EMPTY_ANALYSIS);
    setAnalysisBaseline(EMPTY_ANALYSIS);
    const available = await loadProjects();
    if (available.length) {
      const next = await fetchProject(available[0].id);
      applyProject(next);
      rememberWatchedProject(next.id);
    }
  };

  const switchMode = (mode) => {
    if (mode === editorMode) return;
    if (hasUnsavedChanges && !window.confirm('Discard unsaved changes?')) return;
    if (mode === 'analysis') {
      const nextAnalysis = {
        tone: project?.analysis?.tone || '',
        schema: project?.analysis?.schema || '',
      };
      setEditorMode(mode);
      setAnalysisDraft(nextAnalysis);
      setAnalysisBaseline(nextAnalysis);
      return;
    }
    const text = mode === 'subtitle'
      ? (project?.subtitleText || '')
      : (mode === 'context' ? (project?.contextMd || '') : (project?.transcriptMd || ''));
    setEditorMode(mode);
    setEditorText(text);
    setBaseline(text);
    setAnalysisDraft(analysisBaseline);
  };

  const seekFromEditor = (event) => {
    const seconds = nearestTimestamp(editorText, event.currentTarget.selectionStart);
    if (seconds === null || !videoRef.current) return;
    videoRef.current.currentTime = seconds;
    setCurrentTime(seconds);
  };

  const frameItems = project?.frameManifest?.slice(0, 8) || [];
  const selectedStageCount = STAGES.filter((stage) => selectedStages[stage.id]).length;
  const remoteRunningStage = STAGES.find((stage) => stageState(project, stage.id).status === 'running')?.id || '';
  const watchedPipelineJob = project?.id ? pipelineJobs[project.id] : null;
  const watchedPipelineRunning = isActivePipelineJob(watchedPipelineJob) || Boolean(remoteRunningStage);
  const effectiveBusy = busy || watchedPipelineJob?.stage || remoteRunningStage;
  const activeStage = STAGES.find((stage) => stage.id === effectiveBusy);
  const uploadJob = pipelineJobs[NEW_UPLOAD_JOB_KEY] || null;
  const activePipelineCount = Object.values(pipelineJobs).filter(isActivePipelineJob).length;
  const contextReady = Boolean(contextStatus?.configured && contextStatus?.backend === 'kimiVision');
  const selectedAnalysisProvider = analysisStatus?.providers?.find((item) => item.id === analysisProvider);
  const analysisFieldsReady = Boolean(project?.analysis?.generatedAt);
  const analysisDraftComplete = Boolean(analysisDraft.tone.trim() && analysisDraft.schema.trim());
  const editorStateLabel = editorMode === 'analysis'
    ? (analysisDirty ? 'Draft changes' : (analysisFieldsReady ? 'Analyzed' : 'Not analyzed'))
    : (dirty ? 'Unsaved' : 'Saved');
  const pipelineButtonLabel = file
    ? (isActivePipelineJob(uploadJob) ? 'Uploading & transcribing in background...' : 'Process new video in background')
    : (watchedPipelineRunning
      ? `Running ${activeStage?.label.replace(/^\d+\.\s*/, '') || 'pipeline'} in background...`
      : `Run ${selectedStageCount} checked step${selectedStageCount === 1 ? '' : 's'} in background`);
  const canUseStudioTranslation = Boolean(project?.subtitleText)
    || (project?.transcriptMd && project?.sourceLang === project?.targetLang);
  const publishStepSelected = publishOptions.voiceover || publishOptions.metadata || publishOptions.upload;
  const canPublish = Boolean(project?.hasVideo && project?.transcriptMd && publishStepSelected)
    && (!publishOptions.voiceover || canUseStudioTranslation)
    && (!publishOptions.upload
      || usableYouTubeAuthorizations.some((authorization) => authorization.id === publishOptions.authorizationId)
      || publishOptions.channelId
      || (usableYouTubeAuthorizations.length === 0 && channels.length === 0));

  return (
    <div className={styles.studioWorkspace}>
      <section className={styles.studioColumn}>
        <div className={styles.studioPanelHeader}>
          <h2>Watch & Process</h2>
          <span className={styles.studioModeTag}>
            {activePipelineCount ? `${activePipelineCount} in background` : 'Player stays available'}
          </span>
        </div>

        <div className={styles.studioProjectHeader}>
          <span>Watch library</span>
          {project ? (
            <button className={styles.tabDelete} onClick={deleteProject} title="Delete watched project"
              disabled={watchedPipelineRunning || Boolean(busy)}>×</button>
          ) : null}
        </div>
        <div className={styles.studioProjectList}>
          {projects.map((item) => (
            <ProjectRow key={item.id} item={item} active={String(project?.id || '') === String(item.id)}
              job={pipelineJobs[item.id]} watchDisabled={Boolean(busy)}
              onWatch={(id) => { void watchProject(id); }}
              onProcess={queueExistingProject} />
          ))}
          {!projects.length ? <span className={styles.muted}>Add your first video to begin.</span> : null}
        </div>

        <div className={styles.studioAddVideo}>
          <button className={styles.studioAddVideoToggle} type="button"
            onClick={() => setShowAddVideo((current) => !current)}>
            <span>Add video</span>
            <small>{file ? file.name : 'Upload only when you need another project'}</small>
          </button>
          {(!projects.length || file || showAddVideo) ? (
            <label className={styles.studioDropZone} onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => { event.preventDefault(); setFile(event.dataTransfer.files?.[0] || null); }}>
              <input ref={fileInputRef} type="file" accept="video/*" onChange={(event) => setFile(event.target.files?.[0] || null)} />
              <strong>{file?.name || 'Choose video'}</strong>
              <span>{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : 'Drop or browse'}</span>
            </label>
          ) : null}
          {uploadJob ? (
            <span className={`${styles.studioUploadStatus} ${styles[`studioProjectStatus_${uploadJob.status}`] || ''}`}>
              {uploadJob.stageLabel}: {uploadJob.detail}
            </span>
          ) : null}
        </div>

        <div className={styles.studioSettingsRow}>
          <label><span>Source</span><select className={styles.select} value={sourceLang} onChange={(event) => updateSourceLanguage(event.target.value)}><option value="zh">Chinese</option><option value="en">English</option><option value="ja">Japanese</option><option value="ko">Korean</option><option value="auto" disabled>Auto (choose a language for context)</option></select></label>
          <label><span>Target</span><select className={styles.select} value={targetLang} onChange={(event) => updateTargetLanguage(event.target.value)}><option value="en">English</option><option value="zh">Chinese</option><option value="ja">Japanese</option></select></label>
        </div>

        <div className={styles.viewTabs}>
          {QUALITY_OPTIONS.map(([id, label]) => (
            <button key={id} className={`${styles.viewTab} ${quality === id ? styles.activeViewTab : ''}`} onClick={() => setQuality(id)}>{label}</button>
          ))}
        </div>
        <div className={styles.studioHealth}>
          <span className={`${styles.checkDot} ${health?.ready ? styles.check_ok : styles.check_fail}`} />
          <span>{health?.ready ? `${health.model?.label} ${health.model?.cached ? 'cached' : `downloads from ${health.model?.downloadSource || 'model host'}`}` : 'Local Whisper unavailable'}</span>
        </div>

        <details className={styles.studioContextSettings} open>
          <summary>Screenshot context settings</summary>
          <div className={styles.studioSettingsRow}>
            <label>
              <span>Capture interval</span>
              <select className={styles.select} value={captureIntervalSeconds}
                onChange={(event) => setCaptureIntervalSeconds(Number(event.target.value))}>
                <option value="5">Every 5 seconds</option>
                <option value="10">Every 10 seconds</option>
                <option value="15">Every 15 seconds</option>
                <option value="30">Every 30 seconds</option>
                <option value="60">Every 60 seconds</option>
                <option value="120">Every 2 minutes</option>
              </select>
            </label>
            <label>
              <span>Frame safety limit</span>
              <select className={styles.select} value={maxContextFrames}
                onChange={(event) => setMaxContextFrames(Number(event.target.value))}>
                <option value="30">30 frames</option>
                <option value="60">60 frames</option>
                <option value="120">120 frames</option>
                <option value="240">240 frames</option>
              </select>
            </label>
          </div>
          <div className={styles.studioHealth}>
            <span className={`${styles.checkDot} ${contextReady ? styles.check_ok : styles.check_fail}`} />
            <span>{contextReady
              ? `${contextStatus.model} · screenshots and matched transcript excerpts are sent to Kimi`
              : 'Kimi Vision unavailable · set KIMI_API_KEY and VISION_BACKEND=kimiVision'}</span>
          </div>
          <p>Each screenshot owns a time window in a per-video context Markdown file. Only overlapping cues receive its vocabulary.</p>
        </details>

        <div className={styles.studioStages}>
          {STAGES.map((stage) => (
            <StageRow key={stage.id} stage={stage} project={project} busy={effectiveBusy}
              checked={Boolean(selectedStages[stage.id])}
              onToggle={(id, checked) => setSelectedStages((current) => ({ ...current, [id]: checked }))}
              disabled={Boolean(effectiveBusy)} />
          ))}
        </div>
        <button className={styles.buttonPrimary} onClick={runSelectedPipeline}
          disabled={Boolean(busy) || (file ? isActivePipelineJob(uploadJob) : watchedPipelineRunning)
            || !selectedStageCount || (!file && !project?.hasVideo)
            || ((selectedStages.transcribe || selectedStages.correct) && !health?.ready)}>
          {pipelineButtonLabel}
        </button>
      </section>

      <section className={styles.studioColumn}>
        <div className={styles.studioPanelHeader}>
          <div className={styles.viewTabs}>
            <button className={`${styles.viewTab} ${editorMode === 'transcript' ? styles.activeViewTab : ''}`} onClick={() => switchMode('transcript')}>Transcript</button>
            <button className={`${styles.viewTab} ${editorMode === 'context' ? styles.activeViewTab : ''}`} onClick={() => switchMode('context')} disabled={!project?.contextMd}>Context</button>
            <button className={`${styles.viewTab} ${editorMode === 'subtitle' ? styles.activeViewTab : ''}`} onClick={() => switchMode('subtitle')} disabled={!project?.subtitleText}>Subtitles</button>
            <button className={`${styles.viewTab} ${editorMode === 'analysis' ? styles.activeViewTab : ''}`} onClick={() => switchMode('analysis')} disabled={!project?.transcriptMd}>Analysis</button>
          </div>
          <span className={(dirty || analysisDirty) ? styles.studioUnsaved : styles.muted}>{editorStateLabel}</span>
        </div>
        {editorMode === 'analysis' ? (
          <div className={styles.studioAnalysis}>
            <div className={styles.studioAnalysisToolbar}>
              <label className={styles.studioAnalysisProvider}>
                <span>Provider</span>
                <select className={styles.select} value={analysisProvider} onChange={(event) => setAnalysisProvider(event.target.value)}>
                  {(analysisStatus?.providers || []).map((item) => (
                    <option key={item.id} value={item.id}>{item.label}{item.configured ? '' : ' (not configured)'}</option>
                  ))}
                </select>
              </label>
              <button className={styles.buttonPrimary} onClick={runTranscriptAnalysis}
                disabled={!project?.transcriptMd || !selectedAnalysisProvider?.configured || Boolean(busy) || watchedPipelineRunning}>
                {busy === 'analyze' ? 'Analyzing...' : 'Analyze transcript'}
              </button>
            </div>

            {!selectedAnalysisProvider?.configured && (
              <div className={styles.studioAnalysisStatus}>No transcript analysis provider is configured.</div>
            )}

            {project?.analysis?.summary && (
              <div className={styles.studioAnalysisSummary}>
                <span>Summary</span>
                <p>{project.analysis.summary}</p>
                <small>{project.analysis.providerLabel} · {project.analysis.model}</small>
              </div>
            )}

            <label className={styles.studioAnalysisField}>
              <span>Tone</span>
              <textarea value={analysisDraft.tone} disabled={!analysisFieldsReady}
                onChange={(event) => setAnalysisDraft((current) => ({ ...current, tone: event.target.value }))}
                placeholder="Run transcript analysis to identify tone" />
            </label>
            <label className={styles.studioAnalysisField}>
              <span>Overall schema</span>
              <textarea value={analysisDraft.schema} disabled={!analysisFieldsReady}
                onChange={(event) => setAnalysisDraft((current) => ({ ...current, schema: event.target.value }))}
                placeholder="Run transcript analysis to identify structure and subtitle conventions" />
            </label>

            <div className={styles.studioAnalysisActions}>
              <button className={styles.buttonSecondary} onClick={() => setAnalysisDraft(analysisBaseline)}
                disabled={!analysisDirty || Boolean(busy)}>Reset draft</button>
              <button className={styles.buttonPrimary} onClick={useAnalysisInRefine}
                disabled={!analysisDirty || !analysisFieldsReady || !analysisDraftComplete || Boolean(busy) || watchedPipelineRunning}>
                {busy === 'analysis-save' ? 'Preparing...' : 'Use changes in refine'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <textarea className={styles.studioEditor} value={editorText} spellCheck="false" onChange={(event) => setEditorText(event.target.value)}
              onSelect={seekFromEditor} placeholder={editorMode === 'context' ? 'Timestamped screenshot context' : 'Timestamped transcript'} disabled={!project} />
            <div className={styles.studioEditorFooter}>
              <span>{watchedPipelineRunning && dirty
                ? 'Draft protected locally · save after processing'
                : (project?.name || 'No project selected')}</span>
              <button className={styles.buttonPrimary} onClick={saveEditor}
                disabled={!dirty || busy === 'save' || watchedPipelineRunning}>
                {busy === 'save' ? 'Saving...' : 'Save'}
              </button>
            </div>
          </>
        )}
      </section>

      <section className={styles.studioColumn}>
        <div className={styles.studioPanelHeader}>
          <div>
            <h2>Now watching</h2>
            <span className={styles.studioWatchingName}>{project?.name || 'No project selected'}</span>
          </div>
          <div className={styles.studioHeaderActions}>
            <span className={styles.studioTime}>{currentTime.toFixed(1)}s</span>
            <button className={styles.buttonSecondary} onClick={() => { if (project) void watchProject(project.id, { reload: true }); }}
              disabled={!project || watchedPipelineRunning || Boolean(busy)}>
              Reload latest
            </button>
          </div>
        </div>
        <div className={styles.studioPreview}>
          {project?.hasVideo ? (
            <video ref={videoRef} controls preload="metadata" src={project.mediaUrl}
              onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)} />
          ) : (frameItems.length ? (
            <>
              <img className={styles.studioPreviewFallback}
                src={`/api/control/studio/media/${project.id}?frame=${encodeURIComponent(frameItems[0].file)}`}
                alt={`Saved frame from ${project.name}`} />
              <span className={styles.studioPreviewFallbackLabel}>Source video missing · saved frame</span>
            </>
          ) : <span className={styles.muted}>No video</span>)}
          {activeCue && <div className={styles.studioSubtitleOverlay}><span>{activeCue.text}</span><strong>{activeCue.textEn}</strong></div>}
        </div>

        {activeContext && (
          <div className={styles.studioContextNow}>
            <strong>{activeContext.topic || 'Screenshot context'}</strong>
            <span>{activeContext.summary || 'Timestamp-matched visual evidence'}</span>
            {activeContextTerms && <small>{activeContextTerms}</small>}
          </div>
        )}

        {frameItems.length > 0 && (
          <div className={styles.studioFrameStrip}>
            {frameItems.map((frame) => (
              <button key={`${frame.file}-${frame.timeMs}`} title={`${(frame.timeMs / 1000).toFixed(1)}s`} onClick={() => {
                if (videoRef.current) videoRef.current.currentTime = frame.timeMs / 1000;
              }}>
                <img src={`/api/control/studio/media/${project.id}?frame=${encodeURIComponent(frame.file)}`} alt="" />
              </button>
            ))}
          </div>
        )}

        <div className={styles.studioRefine}>
          <textarea className={styles.textarea} value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="Refine instruction" />
          <details className={styles.studioAdvanced}>
            <summary>Model settings</summary>
            <label><span>Model</span><input className={styles.input} value={model} onChange={(event) => setModel(event.target.value)} /></label>
            <label><span>Temperature</span><input className={styles.input} type="number" min="0" max="1" step="0.05" value={temperature} onChange={(event) => setTemperature(event.target.value)} /></label>
          </details>
          <div className={styles.studioActionRow}>
            <button className={styles.buttonPrimary} onClick={refine}
              disabled={!instruction.trim() || !project?.subtitleText || Boolean(busy) || watchedPipelineRunning}>
              {busy === 'refine' ? 'Refining...' : 'Send'}
            </button>
            <button className={styles.buttonSecondary} onClick={resetHistory}
              disabled={!project?.chatHistory?.length || Boolean(busy) || watchedPipelineRunning}>
              Reset history
            </button>
          </div>
          <div className={styles.studioHistory}>
            {(project?.chatHistory || []).slice().reverse().map((item, index) => <span key={`${item.createdAt}-${index}`}>{item.instruction}</span>)}
          </div>
        </div>

        <div className={styles.studioPublish}>
          <div className={styles.studioProjectHeader}>
            <span>Publish</span>
            <span>{project?.stageStatus?.publish?.detail || 'Not queued'}</span>
          </div>
          <div className={styles.studioPublishGrid}>
            <label><input type="checkbox" checked={publishOptions.voiceover}
              onChange={(event) => updatePublishOption('voiceover', event.target.checked)} /><span>Voiceover dub</span></label>
            <label><input type="checkbox" checked={publishOptions.burnSubtitles} disabled={!publishOptions.voiceover}
              onChange={(event) => updatePublishOption('burnSubtitles', event.target.checked)} /><span>Burn subtitles</span></label>
            <label><input type="checkbox" checked={publishOptions.metadata}
              onChange={(event) => updatePublishOption('metadata', event.target.checked)} /><span>Auto metadata</span></label>
            <label><input type="checkbox" checked={publishOptions.reviewMetadata} disabled={!publishOptions.metadata}
              onChange={(event) => updatePublishOption('reviewMetadata', event.target.checked)} /><span>Review metadata</span></label>
            <label><input type="checkbox" checked={publishOptions.upload}
              onChange={(event) => updatePublishOption('upload', event.target.checked)} /><span>Upload to YouTube</span></label>
            <label><input type="checkbox" checked={autoPublishEnabled} disabled={busy === 'auto-publish'}
              onChange={(event) => saveAutoPublish(event.target.checked)} /><span>Auto after translation</span></label>
          </div>
          {publishOptions.upload && (
            <label className={styles.studioPublishChannel}>
              <span>{usableYouTubeAuthorizations.length ? 'Authorized account' : 'Channel'}</span>
              {usableYouTubeAuthorizations.length ? (
                <select className={styles.select} value={publishOptions.authorizationId}
                  onChange={(event) => updatePublishOption('authorizationId', event.target.value)}>
                  {usableYouTubeAuthorizations.map((authorization) => (
                    <option key={authorization.id} value={authorization.id}>
                      {authorization.channelTitle || authorization.channelId} · {authorization.emailAddress}
                    </option>
                  ))}
                </select>
              ) : (
                <select className={styles.select} value={publishOptions.channelId}
                  onChange={(event) => updatePublishOption('channelId', event.target.value)}>
                  {!channels.length && <option value="">Environment default</option>}
                  {channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
                </select>
              )}
            </label>
          )}
          <button className={styles.buttonPrimary} onClick={sendToPipeline}
            disabled={!canPublish || Boolean(busy) || watchedPipelineRunning}>
            {busy === 'publish' ? 'Queuing...' : 'Send to pipeline'}
          </button>
        </div>

        <div className={styles.studioDownloads}>
          <select className={styles.select} value={downloadFormat} onChange={(event) => setDownloadFormat(event.target.value)}>
            <option value="md">Transcript Markdown</option><option value="context">Context Markdown</option><option value="ass">ASS</option><option value="srt">SRT</option><option value="video">Video</option>
          </select>
          <a className={styles.buttonSecondary} aria-disabled={!project} href={project ? `/api/control/studio/project/${project.id}?download=${downloadFormat}` : undefined}>Download</a>
        </div>

        {(notice || error) && <div className={error ? styles.errorText : styles.studioNotice}>{error || notice}</div>}
      </section>
    </div>
  );
}
