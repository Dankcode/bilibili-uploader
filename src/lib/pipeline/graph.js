import db from '../db/sqlite.js';
import { getPreset } from './presets.js';
import { getProcessor, getSource, getUploader, validateProcessorChain } from './registry.js';

function parseJson(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function adapterLabel(role, adapterId) {
  return ({ source: getSource, processor: getProcessor, uploader: getUploader })[role]?.(adapterId)?.label || adapterId;
}

function durationMs(step) {
  if (!step.started_at) return null;
  const end = step.finished_at ? new Date(step.finished_at) : new Date();
  return Math.max(0, end.getTime() - new Date(step.started_at).getTime());
}

function edgeStatus(from, to) {
  if (to.status === 'running') return 'active';
  if (from.status === 'failed' || from.status === 'review') return 'blocked';
  if (from.status === 'ok' && ['ok', 'running', 'review'].includes(to.status)) return 'ok';
  return 'pending';
}

function assetNodeId(asset, nodes) {
  if (nodes.some((node) => node.id === `processor:${asset.kind}`)) return `processor:${asset.kind}`;
  if (asset.kind === 'original') return nodes.find((node) => node.role === 'source')?.id;
  if (['transcript', 'frames'].includes(asset.kind)) return 'processor:videoContext';
  if (['glossary', 'onscreen', 'corrections'].includes(asset.kind)) return 'processor:ocrContext';
  if (asset.kind === 'context') return parseJson(asset.meta_json, {}).merged ? 'processor:ocrContext' : 'processor:videoContext';
  if (asset.kind === 'remote') return nodes.find((node) => node.role === 'uploader')?.id;
  return null;
}

export function graphFromJob(job) {
  const assets = Array.isArray(job.assets) ? job.assets : [];
  const nodes = (job.steps || []).map((step, index) => {
    const [role, adapterId] = String(step.step).split(':');
    return {
      id: step.step,
      stepId: step.id,
      role,
      adapterId,
      label: adapterLabel(role, adapterId),
      status: step.status,
      progress: Number(step.progress) || 0,
      progressNote: step.progress_note || '',
      startedAt: step.started_at || null,
      finishedAt: step.finished_at || null,
      durationMs: durationMs(step),
      attempt: Number(step.attempt) || 1,
      metrics: parseJson(step.metrics_json, {}),
      assets: [],
      hasLog: Boolean(String(step.log || '').trim()),
      error: step.status === 'failed' ? (step.progress_note || job.error || '') : '',
      position: { x: index, y: 0 },
    };
  });
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  for (const asset of assets) {
    const node = nodeMap.get(assetNodeId(asset, nodes));
    if (node) node.assets.push({
      id: asset.id,
      kind: asset.kind,
      createdAt: asset.created_at,
      href: `/api/control/pipeline/assets/${asset.id}`,
      path: asset.file_path,
    });
  }
  return {
    nodes,
    edges: nodes.slice(1).map((node, index) => {
      const from = nodes[index];
      return { id: `e:${from.id}->${node.id}`, from: from.id, to: node.id, status: edgeStatus(from, node) };
    }),
    meta: { jobId: job.id, editable: false },
  };
}

export function graphFromPreset(presetId, { sourceId = 'localFile' } = {}) {
  const preset = getPreset(presetId);
  const template = preset?.template || {};
  const steps = [
    `source:${sourceId}`,
    ...(template.processorIds || []).map((id) => `processor:${id}`),
    ...(template.uploaderId ? [`uploader:${template.uploaderId}`] : []),
  ].map((step, index) => ({ id: -(index + 1), step, status: 'pending', progress: 0, attempt: 1 }));
  return graphFromJob({ id: null, steps, assets: [] });
}

export function buildProcessGraph(videoId) {
  const job = db.prepare('SELECT * FROM video_jobs WHERE video_record_id = ? ORDER BY created_at DESC, id DESC LIMIT 1').get(String(videoId));
  if (!job) return null;
  return graphFromJob({
    ...job,
    steps: db.prepare('SELECT * FROM video_job_steps WHERE job_id = ? ORDER BY id ASC').all(job.id),
    assets: db.prepare('SELECT * FROM video_assets WHERE job_id = ? ORDER BY id ASC').all(job.id),
  });
}

export function validateGraph(graph) {
  const processors = (graph?.nodes || []).filter((node) => node.role === 'processor').map((node) => node.adapterId);
  return validateProcessorChain(processors);
}

export function graphToJobInput(graph, overrides = {}) {
  const validation = validateGraph(graph);
  if (!validation.ok) throw new Error(validation.errors.join(' '));
  const source = graph.nodes.find((node) => node.role === 'source');
  const uploader = graph.nodes.find((node) => node.role === 'uploader');
  return {
    sourceId: source?.adapterId || overrides.sourceId,
    sourceInput: overrides.sourceInput || graph.meta?.sourceInput || '',
    processorIds: graph.nodes.filter((node) => node.role === 'processor').map((node) => node.adapterId),
    uploaderId: uploader?.adapterId || '',
    options: overrides.options || graph.meta?.options || {},
    ...overrides,
  };
}

function notImplemented(name) {
  const error = new Error(`${name} is reserved for the editable pipeline graph phase.`);
  error.code = 'NOT_IMPLEMENTED';
  throw error;
}

/** Add a validated adapter node after another node; future write targets pipeline_graphs.nodes_json. */
export function addGraphNode() { return notImplemented('addGraphNode'); }
/** Remove a node and all incident edges while preserving a valid source-to-uploader chain. */
export function removeGraphNode() { return notImplemented('removeGraphNode'); }
/** Persist a free-form {x,y} position without changing execution order. */
export function moveGraphNode() { return notImplemented('moveGraphNode'); }
/** Connect two compatible roles without cycles or duplicate edges. */
export function connectGraphNodes() { return notImplemented('connectGraphNodes'); }
/** Remove one edge while retaining a connected executable graph. */
export function disconnectGraphNodes() { return notImplemented('disconnectGraphNodes'); }
/** Merge adapter options after validating their serializable shape. */
export function updateGraphNodeOptions() { return notImplemented('updateGraphNodeOptions'); }
/** Persist layout to the deferred pipeline_graphs table, scoped to one video. */
export function saveGraphLayout() { return notImplemented('saveGraphLayout'); }
/** Load the latest pipeline_graphs row for a video or preset scope. */
export function loadGraphLayout() { return notImplemented('loadGraphLayout'); }
/** Validate and save a graph as a new user preset through savePreset(). */
export function cloneGraphToPreset() { return notImplemented('cloneGraphToPreset'); }

export function positionToPixels(position = {}, { nodeWidth = 208, gap = 24 } = {}) {
  return { x: (Number(position.x) || 0) * (nodeWidth + gap), y: (Number(position.y) || 0) * 116 };
}
