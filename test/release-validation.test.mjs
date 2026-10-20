import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { validationEnvironment, validateSteps, validateRelease } from '../scripts/validate_release.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-validation-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const releaseDirectory = path.join(root, 'source'); fs.mkdirSync(releaseDirectory);
  return { root, releaseDirectory, stateDirectory: root, revision: 'fixture-revision' };
}

test('release validation drops inherited production paths, fixture keys and preload hooks', () => {
  const env = validationEnvironment({ PATH: '/test/bin', PYTHON_TEST_BIN: '/test/python',
    VIDEO_SQLITE_PATH: '/production/sql.db', VIDEO_RUNTIME_SETTINGS_PATH: '/production/runtime.json',
    STUDIO_SECRET_KEY: 'production-key', OPENAI_API_KEY: 'production-provider-key',
    NODE_OPTIONS: '--import=/production/hook.mjs', NODE_ENV: 'production' });
  assert.deepEqual(env, { PATH: '/test/bin', PYTHON_TEST_BIN: '/test/python' });
});

test('web service launches only the loopback frontend behind Tailscale Serve', () => {
  const unit = fs.readFileSync(new URL('../deploy/systemd/video-ops-web.service', import.meta.url), 'utf8');
  assert.match(unit, /^Environment=VIDEO_ACCESS_MODE=tailscale$/m);
  assert.match(unit, /^Environment=VIDEO_BIND_HOST=127\.0\.0\.1$/m);
  assert.match(unit, /^ExecStart=\/usr\/bin\/node \/srv\/bilibili-uploader\/scripts\/run_server\.mjs start --web-only$/m);
  assert.doesNotMatch(unit, /--shared|--tailscale|server_worker/);
});

test('test subprocess has no database/runtime/key override; only build uses disposable state', async (t) => {
  const options = fixture(t); const calls = [];
  const report = await validateSteps({ ...options, install: false,
    environment: { ...process.env, VIDEO_SQLITE_PATH: '/production/sql.db',
      VIDEO_RUNTIME_SETTINGS_PATH: '/production/runtime.json', STUDIO_SECRET_KEY: 'production-key' },
    runner: async (command, args, context) => {
      calls.push({ command, args, ...context });
      if (args.includes('build')) {
        fs.mkdirSync(path.join(context.cwd, '.next'));
        fs.writeFileSync(path.join(context.cwd, '.next/BUILD_ID'), 'fresh-build');
      }
      return { exitCode: 0, signal: null };
    } });
  assert.deepEqual(calls[0].args, ['test']);
  for (const key of ['VIDEO_SQLITE_PATH', 'VIDEO_RUNTIME_SETTINGS_PATH', 'STUDIO_SECRET_KEY']) assert.equal(calls[0].env[key], undefined);
  const build = calls[1].env;
  assert.equal(build.VIDEO_SQLITE_PATH, path.join(options.root, 'build.db'));
  assert.equal(build.VIDEO_RUNTIME_SETTINGS_PATH, path.join(options.root, 'build-runtime.json'));
  assert.equal(Buffer.from(build.STUDIO_SECRET_KEY, 'base64').length, 32);
  assert.notEqual(build.STUDIO_SECRET_KEY, 'production-key');
  assert.equal(JSON.parse(fs.readFileSync(build.VIDEO_RUNTIME_SETTINGS_PATH)).workerEnabled, false);
  assert.equal(report.workerStarted, false);
  assert.equal(report.eligibleForDeployment, true);
  assert.equal(report.buildId, 'fresh-build');
  assert.equal(JSON.parse(fs.readFileSync(report.reportPath)).checks.test.exitCode, 0);
});

test('a nonzero test exit prevents build and deployment; build failures also block deployment', async (t) => {
  for (const failureStage of ['test', 'build']) {
    const options = fixture(t); const calls = [];
    const report = await validateSteps({ ...options, install: false, runner: async (_command, args) => {
      const stage = args.includes('build') ? 'build' : 'test'; calls.push(stage);
      return { exitCode: stage === failureStage ? 7 : 0, signal: null };
    } });
    assert.equal(report.eligibleForDeployment, false);
    assert.equal(report.checks[failureStage].exitCode, 7);
    assert.deepEqual(calls, failureStage === 'test' ? ['test'] : ['test', 'build']);
  }
});

test('records real npm test failure status rather than a log-pipeline exit code', async (t) => {
  const options = fixture(t);
  fs.writeFileSync(path.join(options.releaseDirectory, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(9)"' } }));
  const report = await validateSteps({ ...options, install: false });
  assert.equal(report.checks.test.exitCode, 9);
  assert.equal(report.checks.build, undefined);
  assert.equal(report.eligibleForDeployment, false);
});

test('release checkout ignores dirty auth patches, compiled output and private host state', async (t) => {
  const { root, releaseDirectory: source } = fixture(t);
  const git = (args) => execFileSync('git', args, { cwd: source, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '--initial-branch=main']);
  fs.writeFileSync(path.join(source, '.gitignore'), '.next/\n.env\nconfig/\nnode_modules/\n');
  fs.writeFileSync(path.join(source, 'auth.js'), 'export const required = false;\n');
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ scripts: {
    test: 'node -e "process.exit(8)"',
  } }));
  git(['add', '.']);
  git(['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'Fixture main']);
  const revision = git(['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(source, 'auth.js'), 'obsolete local auth patch\n');
  fs.mkdirSync(path.join(source, '.next')); fs.writeFileSync(path.join(source, '.next/BUILD_ID'), 'old-build');
  fs.mkdirSync(path.join(source, 'config')); fs.writeFileSync(path.join(source, 'config/retained.json'), 'private training');
  fs.writeFileSync(path.join(source, '.env'), 'STUDIO_SECRET_KEY=production-key\n');
  const dependencies = path.join(root, 'dependencies'); fs.mkdirSync(path.join(dependencies, 'next'), { recursive: true });
  fs.writeFileSync(path.join(dependencies, 'next/package.json'), '{}');
  const report = await validateRelease({ source, revision, outputRoot: root, dependencies });
  assert.equal(report.revision, revision);
  assert.equal(fs.readFileSync(path.join(report.releaseDirectory, 'auth.js'), 'utf8'), 'export const required = false;\n');
  for (const entry of ['.next', '.env', 'config']) assert.equal(fs.existsSync(path.join(report.releaseDirectory, entry)), false);
  assert.equal(fs.readFileSync(path.join(source, 'config/retained.json'), 'utf8'), 'private training');
  assert.equal(fs.readFileSync(path.join(source, '.next/BUILD_ID'), 'utf8'), 'old-build');
  assert.equal(report.checks.test.exitCode, 8);
  assert.equal(report.eligibleForDeployment, false);
});
