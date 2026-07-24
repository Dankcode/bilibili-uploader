import { createJob } from '../pipeline/pipeline';
import { getAppSetting, setAppSetting } from '../pipeline/presets';
import { buildStudioPipelineInput } from './publishPayload';
import { getStudioProject, updateStudioProject } from './store';

export { buildStudioPipelineInput } from './publishPayload';

const DEFAULT_AUTO_PUBLISH = {
  enabled: false,
  options: {
    voiceover: true,
    burnSubtitles: true,
    metadata: true,
    upload: true,
    reviewMetadata: false,
    channelId: '',
    privacyStatus: 'private',
  },
};

function getSourceRevision(project) {
  if (project.sourceLang === project.targetLang) {
    return project.stageStatus.transcribe?.updatedAt || '';
  }
  return project.stageStatus.translate?.updatedAt || project.stageStatus.transcribe?.updatedAt || '';
}

export function publishStudioProject(projectId, options = {}) {
  const project = getStudioProject(projectId);
  if (!project) throw new Error('Studio project not found.');
  const job = createJob(buildStudioPipelineInput(project, options));
  updateStudioProject(project.id, {
    stageStatus: {
      ...project.stageStatus,
      publish: {
        status: 'queued',
        detail: `Pipeline job #${job.id}`,
        jobId: job.id,
        automatic: Boolean(options.automatic),
        sourceRevision: getSourceRevision(project),
        updatedAt: new Date().toISOString(),
      },
    },
  });
  return job;
}

export function getStudioAutoPublish() {
  const saved = getAppSetting('studioAutoPublish', DEFAULT_AUTO_PUBLISH);
  return {
    ...DEFAULT_AUTO_PUBLISH,
    ...(saved || {}),
    options: { ...DEFAULT_AUTO_PUBLISH.options, ...(saved?.options || {}) },
  };
}

export function setStudioAutoPublish(value = {}) {
  const next = {
    enabled: Boolean(value.enabled),
    options: { ...DEFAULT_AUTO_PUBLISH.options, ...(value.options || {}) },
  };
  return setAppSetting('studioAutoPublish', next);
}

export function maybeAutoPublishStudioProject(projectId) {
  const setting = getStudioAutoPublish();
  if (!setting.enabled) return { skipped: true, reason: 'disabled' };
  const project = getStudioProject(projectId);
  if (!project) throw new Error('Studio project not found.');
  const sourceRevision = getSourceRevision(project);
  if (project.stageStatus.publish?.automatic && project.stageStatus.publish?.sourceRevision === sourceRevision) {
    return { skipped: true, reason: 'already-published', jobId: project.stageStatus.publish.jobId };
  }
  try {
    return { skipped: false, job: publishStudioProject(projectId, { ...setting.options, automatic: true }) };
  } catch (error) {
    updateStudioProject(project.id, {
      stageStatus: {
        ...project.stageStatus,
        publish: {
          status: 'failed',
          detail: error.message,
          automatic: true,
          sourceRevision,
          updatedAt: new Date().toISOString(),
        },
      },
    });
    return { skipped: false, error: error.message };
  }
}
