import assert from 'node:assert/strict';
import test from 'node:test';

const { classifyError } = await import('../src/lib/pipeline/diagnostics.js');

const CASES = [
  ['invalid_grant: Token has been expired', 'authorization_expired', 'connections'],
  ['Bilibili returned risk-control HTML (-352)', 'source_blocked', 'connections'],
  ['spawn ffmpeg ENOENT', 'tool_missing', 'diagnostics'],
  ['ENOSPC: no space left on device', 'disk_full', 'overview'],
  ['HTTP 429 RESOURCE_EXHAUSTED quota', 'provider_limit', 'connections'],
  ['Whisper model load failure', 'local_model_unavailable', 'diagnostics'],
  ['context revision mismatch', 'stale_artifact', 'studio'],
];

test('pipeline errors are classified into a concrete next step', () => {
  for (const [error, category, view] of CASES) {
    const issue = classifyError(error, { serviceId: 'youtube', stepId: 'uploader:youtube' });
    assert.equal(issue.category, category, error);
    assert.equal(issue.action.view, view, error);
    assert.ok(issue.nextStep, `${error} must include a next step`);
  }
});

