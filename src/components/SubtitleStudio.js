'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseSubtitle, parseSubtitleTimestamp } from '@/lib/studio/subtitles';
import styles from '../app/page.module.css';

const QUALITY_OPTIONS = [
  ['fast', 'Fast'], ['balanced', 'Balanced'], ['best', 'Best'],
];

const STAGES = [
  { id: 'transcribe', label: '1. Transcribe' },
  { id: 'frames', label: '2. Screenshots' },
  { id: 'correct', label: '3. Vision correction' },
  { id: 'translate', label: '4. Translate' },
];

const EMPTY_ANALYSIS = { tone: '', schema: '' };

function stageState(project, id) {
  return project?.stageStatus?.[id] || { status: 'pending', detail: '' };
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

export default function SubtitleStudio({ channels = [], onPublished }) {
  const [projects, setProjects] = useState([]);
  const [project, setProject] = useState(null);
  const [file, setFile] = useState(null);
  const [quality, setQuality] = useState('fast');
  const [sourceLang, setSourceLang] = useState('zh');
  const [targetLang, setTargetLang] = useState('en');
  const [health, setHealth] = useState(null);
  const [busy, setBusy] = useState('');
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
    channelId: '',
  });
  const [autoPublishEnabled, setAutoPublishEnabled] = useState(false);
  const fileInputRef = useRef(null);
  const videoRef = useRef(null);

  const dirty = editorText !== baseline;
  const analysisDirty = analysisDraft.tone !== analysisBaseline.tone
    || analysisDraft.schema !== analysisBaseline.schema;
  const hasUnsavedChanges = dirty || analysisDirty;

  const applyProject = useCallback((next, preferredMode) => {
    setProject(next);
    const nextSourceLang = next?.sourceLang || 'zh';
    const nextTargetLang = next?.targetLang || 'en';
    setSourceLang(nextSourceLang);
    setTargetLang(nextTargetLang);
    if (nextSourceLang === nextTargetLang) {
      setSelectedStages((current) => ({ ...current, translate: false }));
    }
    setQuality(next?.quality || 'fast');
    const mode = preferredMode || (next?.subtitleText ? 'subtitle' : 'transcript');
    const text = mode === 'subtitle' ? (next?.subtitleText || '') : (next?.transcriptMd || '');
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

  const loadProjects = useCallback(async () => {
    const data = await readJson(await fetch('/api/studio/project?limit=50', { cache: 'no-store' }));
    setProjects(data.projects || []);
  }, []);

  const loadProject = useCallback(async (id, preferredMode) => {
    const data = await readJson(await fetch(`/api/studio/project/${id}`, { cache: 'no-store' }));
    applyProject(data.project, preferredMode);
    return data.project;
  }, [applyProject]);

  useEffect(() => {
    loadProjects().catch((nextError) => setError(nextError.message));
  }, [loadProjects]);

  useEffect(() => {
    let active = true;
    fetch('/api/studio/analyze', { cache: 'no-store' })
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
    fetch('/api/studio/publish', { cache: 'no-store' })
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
    if (!publishOptions.channelId && channels[0]?.id) {
      setPublishOptions((current) => ({ ...current, channelId: String(channels[0].id) }));
    }
  }, [channels, publishOptions.channelId]);

  useEffect(() => {
    let active = true;
    fetch(`/api/studio/transcribe?quality=${quality}`, { cache: 'no-store' })
      .then(readJson)
      .then((data) => { if (active) setHealth(data); })
      .catch((nextError) => { if (active) setHealth({ ready: false, error: nextError.message }); });
    return () => { active = false; };
  }, [quality]);

  const cues = useMemo(() => {
    const text = editorMode === 'subtitle' ? editorText : project?.subtitleText;
    if (!text) return [];
    try { return parseSubtitle(text, 'ass'); } catch { return []; }
  }, [editorMode, editorText, project?.subtitleText]);

  const activeCue = useMemo(
    () => cues.find((cue) => currentTime >= cue.start && currentTime < cue.end) || null,
    [cues, currentTime],
  );

  const resetMessages = () => { setError(''); setNotice(''); };

  const updateSourceLanguage = (value) => {
    setSourceLang(value);
    if (value === targetLang) setSelectedStages((current) => ({ ...current, translate: false }));
  };

  const updateTargetLanguage = (value) => {
    setTargetLang(value);
    if (value === sourceLang) setSelectedStages((current) => ({ ...current, translate: false }));
  };

  const executeTranscription = async (currentProject) => {
    const uploadedFile = file;
    let request;
    if (uploadedFile) {
      const form = new FormData();
      form.set('file', uploadedFile);
      form.set('quality', quality);
      form.set('sourceLang', sourceLang);
      form.set('targetLang', targetLang);
      request = fetch('/api/studio/transcribe', { method: 'POST', body: form });
    } else if (currentProject?.hasVideo) {
      request = fetch('/api/studio/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: currentProject.id, quality, sourceLang, targetLang }),
      });
    } else {
      throw new Error('Choose a video or load a project with an uploaded video.');
    }
    const data = await readJson(await request);
    applyProject(data.project, 'transcript');
    if (uploadedFile) {
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
    await loadProjects();
    return data.project;
  };

  const executeStage = async (stage, currentProject) => {
    const endpoints = { frames: 'frames', correct: 'correct', translate: 'translate' };
    const data = await readJson(await fetch(`/api/studio/${endpoints[stage]}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: currentProject.id,
        from: sourceLang,
        to: targetLang,
        model,
        temperature,
      }),
    }));
    applyProject(data.project, stage === 'translate' ? 'subtitle' : editorMode);
    await loadProjects();
    return { project: data.project, skipped: Boolean(data.skipped), message: data.message || '' };
  };

  const runSelectedPipeline = async () => {
    resetMessages();
    const selected = STAGES.filter((stage) => selectedStages[stage.id]);
    if (!selected.length) { setError('Check at least one pipeline step.'); return; }
    if (file && !selectedStages.transcribe) { setError('Check Transcribe to process the selected video.'); return; }
    let currentProject = project;
    const completed = [];
    const notes = [];
    try {
      if (selectedStages.transcribe) {
        setBusy('transcribe');
        currentProject = await executeTranscription(currentProject);
        completed.push('Transcribe');
      }
      if (!currentProject) throw new Error('Choose a video or load a project before running the pipeline.');

      for (const stage of selected.filter((item) => item.id !== 'transcribe')) {
        if (stage.id === 'frames' && !currentProject.hasVideo) throw new Error('Screenshots require an uploaded video.');
        if (stage.id === 'correct' && !currentProject.frameManifest?.length) {
          throw new Error('Check Screenshots before Vision correction, or load a project that already has frames.');
        }
        if (stage.id === 'translate' && !currentProject.transcriptMd) {
          throw new Error('Translation requires a completed transcript.');
        }
        setBusy(stage.id);
        try {
          const result = await executeStage(stage.id, currentProject);
          currentProject = result.project;
          if (result.skipped) notes.push(result.message);
          else completed.push(stage.label.replace(/^\d+\.\s*/, ''));
        } catch (nextError) {
          if (nextError.code !== 'VISION_NOT_CONFIGURED') throw nextError;
          notes.push(nextError.message);
          currentProject = await loadProject(currentProject.id, editorMode).catch(() => currentProject);
          await loadProjects();
        }
      }
      setNotice([completed.length ? `Completed: ${completed.join(', ')}.` : '', ...notes].filter(Boolean).join(' '));
    } catch (nextError) {
      setError(nextError.message);
      if (nextError.projectId) {
        await loadProject(nextError.projectId, 'transcript').catch(() => {});
        await loadProjects().catch(() => {});
      } else if (currentProject?.id) {
        await loadProject(currentProject.id, editorMode).catch(() => {});
      }
    } finally {
      setBusy('');
    }
  };

  const saveEditor = async () => {
    if (!project || !dirty) return;
    resetMessages();
    setBusy('save');
    try {
      const body = editorMode === 'transcript'
        ? { transcriptMd: editorText }
        : { subtitleText: editorText, format: 'ass' };
      const data = await readJson(await fetch(`/api/studio/project/${project.id}`, {
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
      const data = await readJson(await fetch('/api/studio/analyze', {
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
      const data = await readJson(await fetch('/api/studio/analyze', {
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
        await readJson(await fetch(`/api/studio/project/${project.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subtitleText: editorText, format: 'ass' }),
        }));
      }
      const data = await readJson(await fetch('/api/studio/refine', {
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
      const data = await readJson(await fetch('/api/studio/refine', {
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
      fetch('/api/studio/publish', {
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
      const data = await readJson(await fetch('/api/studio/publish', {
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
      const data = await readJson(await fetch('/api/studio/publish', {
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
    await readJson(await fetch(`/api/studio/project/${project.id}`, { method: 'DELETE' }));
    setProject(null);
    setEditorText('');
    setBaseline('');
    setAnalysisDraft(EMPTY_ANALYSIS);
    setAnalysisBaseline(EMPTY_ANALYSIS);
    await loadProjects();
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
    const text = mode === 'subtitle' ? (project?.subtitleText || '') : (project?.transcriptMd || '');
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
  const effectiveBusy = busy || remoteRunningStage;
  const activeStage = STAGES.find((stage) => stage.id === effectiveBusy);
  const selectedAnalysisProvider = analysisStatus?.providers?.find((item) => item.id === analysisProvider);
  const analysisFieldsReady = Boolean(project?.analysis?.generatedAt);
  const analysisDraftComplete = Boolean(analysisDraft.tone.trim() && analysisDraft.schema.trim());
  const editorStateLabel = editorMode === 'analysis'
    ? (analysisDirty ? 'Draft changes' : (analysisFieldsReady ? 'Analyzed' : 'Not analyzed'))
    : (dirty ? 'Unsaved' : 'Saved');
  const pipelineButtonLabel = activeStage
    ? (activeStage.id === 'transcribe' && file ? 'Uploading & transcribing...' : `Running ${activeStage.label.replace(/^\d+\.\s*/, '')}...`)
    : `Run ${selectedStageCount} checked step${selectedStageCount === 1 ? '' : 's'}`;
  const canUseStudioTranslation = Boolean(project?.subtitleText)
    || (project?.transcriptMd && project?.sourceLang === project?.targetLang);
  const publishStepSelected = publishOptions.voiceover || publishOptions.metadata || publishOptions.upload;
  const canPublish = Boolean(project?.hasVideo && project?.transcriptMd && publishStepSelected)
    && (!publishOptions.voiceover || canUseStudioTranslation)
    && (!publishOptions.upload || publishOptions.channelId || channels.length === 0);

  return (
    <div className={styles.studioWorkspace}>
      <section className={styles.studioColumn}>
        <div className={styles.studioPanelHeader}>
          <h2>Source & Pipeline</h2>
          <span className={styles.studioModeTag}>Test mode</span>
        </div>

        <label className={styles.studioDropZone} onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => { event.preventDefault(); setFile(event.dataTransfer.files?.[0] || null); }}>
          <input ref={fileInputRef} type="file" accept="video/*" onChange={(event) => setFile(event.target.files?.[0] || null)} />
          <strong>{file?.name || 'Choose video'}</strong>
          <span>{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : 'Drop or browse'}</span>
        </label>

        <div className={styles.studioSettingsRow}>
          <label><span>Source</span><select className={styles.select} value={sourceLang} onChange={(event) => updateSourceLanguage(event.target.value)}><option value="zh">Chinese</option><option value="en">English</option><option value="ja">Japanese</option><option value="ko">Korean</option><option value="auto">Auto</option></select></label>
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

        <div className={styles.studioStages}>
          {STAGES.map((stage) => (
            <StageRow key={stage.id} stage={stage} project={project} busy={effectiveBusy}
              checked={Boolean(selectedStages[stage.id])}
              onToggle={(id, checked) => setSelectedStages((current) => ({ ...current, [id]: checked }))}
              disabled={Boolean(effectiveBusy)} />
          ))}
        </div>
        <button className={styles.buttonPrimary} onClick={runSelectedPipeline}
          disabled={Boolean(effectiveBusy) || !selectedStageCount || (!file && !project?.hasVideo) || (selectedStages.transcribe && !health?.ready)}>
          {pipelineButtonLabel}
        </button>

        <div className={styles.studioProjectHeader}><span>Projects</span>{project && <button className={styles.tabDelete} onClick={deleteProject} title="Delete project">×</button>}</div>
        <div className={styles.studioProjectList}>
          {projects.map((item) => (
            <button key={item.id} className={`${styles.studioProjectItem} ${project?.id === item.id ? styles.studioProjectActive : ''}`}
              onClick={() => { if (!hasUnsavedChanges || window.confirm('Discard unsaved changes?')) loadProject(item.id); }}>
              <strong>{item.name}</strong><span>{new Date(item.updatedAt).toLocaleString()}</span>
            </button>
          ))}
          {!projects.length && <span className={styles.muted}>No projects</span>}
        </div>
      </section>

      <section className={styles.studioColumn}>
        <div className={styles.studioPanelHeader}>
          <div className={styles.viewTabs}>
            <button className={`${styles.viewTab} ${editorMode === 'transcript' ? styles.activeViewTab : ''}`} onClick={() => switchMode('transcript')}>Transcript</button>
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
                disabled={!project?.transcriptMd || !selectedAnalysisProvider?.configured || Boolean(busy)}>
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
                disabled={!analysisDirty || !analysisFieldsReady || !analysisDraftComplete || Boolean(busy)}>
                {busy === 'analysis-save' ? 'Preparing...' : 'Use changes in refine'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <textarea className={styles.studioEditor} value={editorText} spellCheck="false" onChange={(event) => setEditorText(event.target.value)}
              onSelect={seekFromEditor} placeholder="Timestamped transcript" disabled={!project} />
            <div className={styles.studioEditorFooter}>
              <span>{project?.name || 'No project selected'}</span>
              <button className={styles.buttonPrimary} onClick={saveEditor} disabled={!dirty || busy === 'save'}>{busy === 'save' ? 'Saving...' : 'Save'}</button>
            </div>
          </>
        )}
      </section>

      <section className={styles.studioColumn}>
        <div className={styles.studioPanelHeader}><h2>Preview & Refine</h2><span className={styles.studioTime}>{currentTime.toFixed(1)}s</span></div>
        <div className={styles.studioPreview}>
          {project?.hasVideo ? (
            <video ref={videoRef} controls preload="metadata" src={project.mediaUrl}
              onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)} />
          ) : <span className={styles.muted}>No video</span>}
          {activeCue && <div className={styles.studioSubtitleOverlay}><span>{activeCue.text}</span><strong>{activeCue.textEn}</strong></div>}
        </div>

        {frameItems.length > 0 && (
          <div className={styles.studioFrameStrip}>
            {frameItems.map((frame) => (
              <button key={`${frame.file}-${frame.timeMs}`} title={`${(frame.timeMs / 1000).toFixed(1)}s`} onClick={() => {
                if (videoRef.current) videoRef.current.currentTime = frame.timeMs / 1000;
              }}>
                <img src={`/api/studio/media/${project.id}?frame=${encodeURIComponent(frame.file)}`} alt="" />
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
            <button className={styles.buttonPrimary} onClick={refine} disabled={!instruction.trim() || !project?.subtitleText || busy === 'refine'}>{busy === 'refine' ? 'Refining...' : 'Send'}</button>
            <button className={styles.buttonSecondary} onClick={resetHistory} disabled={!project?.chatHistory?.length}>Reset history</button>
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
              <span>Channel</span>
              <select className={styles.select} value={publishOptions.channelId}
                onChange={(event) => updatePublishOption('channelId', event.target.value)}>
                {!channels.length && <option value="">Environment default</option>}
                {channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
              </select>
            </label>
          )}
          <button className={styles.buttonPrimary} onClick={sendToPipeline}
            disabled={!canPublish || Boolean(busy)}>{busy === 'publish' ? 'Queuing...' : 'Send to pipeline'}</button>
        </div>

        <div className={styles.studioDownloads}>
          <select className={styles.select} value={downloadFormat} onChange={(event) => setDownloadFormat(event.target.value)}>
            <option value="md">Markdown</option><option value="ass">ASS</option><option value="srt">SRT</option><option value="video">Video</option>
          </select>
          <a className={styles.buttonSecondary} aria-disabled={!project} href={project ? `/api/studio/project/${project.id}?download=${downloadFormat}` : undefined}>Download</a>
        </div>

        {(notice || error) && <div className={error ? styles.errorText : styles.studioNotice}>{error || notice}</div>}
      </section>
    </div>
  );
}
