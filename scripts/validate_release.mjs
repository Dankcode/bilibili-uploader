import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Deliberately do not load .env or inherit app credentials, database paths,
// NODE_OPTIONS preload hooks, or npm's lifecycle environment from the host.
export function validationEnvironment(environment = process.env) {
  const allowed = new Set(['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'SYSTEMROOT',
    'COMSPEC', 'PATHEXT', 'TMP', 'TEMP', 'TMPDIR', 'LANG', 'LC_ALL', 'TZ', 'CI',
    'NO_COLOR', 'PYTHON_TEST_BIN']);
  return Object.fromEntries(Object.entries(environment).filter(([key]) => allowed.has(key)));
}

async function execute(command, args, { cwd, env, logPath }) {
  const fd = fs.openSync(logPath, 'wx', 0o600);
  try {
    return await new Promise((resolve) => {
      const child = spawn(command, args, { cwd, env, stdio: ['ignore', fd, fd], shell: false });
      child.once('error', (error) => resolve({ exitCode: null, signal: null, error: error.code || 'SPAWN_FAILED' }));
      child.once('close', (exitCode, signal) => resolve({ exitCode, signal }));
    });
  } finally { fs.closeSync(fd); }
}

export async function validateSteps({ releaseDirectory, stateDirectory, revision,
  environment = process.env, runner = execute, install = true }) {
  const base = validationEnvironment(environment);
  const reportPath = path.join(stateDirectory, 'validation.json');
  const report = { revision, releaseDirectory, startedAt: new Date().toISOString(),
    workerStarted: false, eligibleForDeployment: false, checks: {} };
  const persist = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  persist();
  for (const stage of install ? ['dependencies', 'test', 'build'] : ['test', 'build']) {
    const env = { ...base };
    if (stage === 'build') {
      // Only build subprocesses share disposable state. NEVER export these
      // overrides before npm test: its bootstrap isolates each test process.
      env.NODE_ENV = 'production';
      env.VIDEO_SQLITE_PATH = path.join(stateDirectory, 'build.db');
      env.VIDEO_RUNTIME_SETTINGS_PATH = path.join(stateDirectory, 'build-runtime.json');
      env.STUDIO_SECRET_KEY = randomBytes(32).toString('base64');
      env.VIDEO_PROCESS_ROLE = 'frontend';
      env.VIDEO_ACCESS_MODE = 'tailscale';
      env.VIDEO_BIND_HOST = '127.0.0.1';
      fs.writeFileSync(env.VIDEO_RUNTIME_SETTINGS_PATH, JSON.stringify({
        connectionMode: 'server', sqlitePath: env.VIDEO_SQLITE_PATH, workerEnabled: false,
      }) + '\n', { flag: 'wx', mode: 0o600 });
    }
    const args = stage === 'dependencies' ? ['ci'] : stage === 'test' ? ['test'] : ['run', 'build'];
    console.log(`[Validate] ${stage} started`);
    report.checks[stage] = await runner(npm, args, {
      cwd: releaseDirectory, env, logPath: path.join(stateDirectory, `${stage}.log`),
    });
    persist();
    console.log(`[Validate] ${stage} exitCode=${report.checks[stage].exitCode} signal=${report.checks[stage].signal || 'none'}`);
    if (report.checks[stage].exitCode !== 0 || report.checks[stage].signal || report.checks[stage].error) return { ...report, reportPath };
  }
  const buildId = path.join(releaseDirectory, '.next', 'BUILD_ID');
  if (!fs.existsSync(buildId)) {
    report.error = 'Build reported success but .next/BUILD_ID is missing'; persist();
    return { ...report, reportPath };
  }
  report.buildId = fs.readFileSync(buildId, 'utf8').trim();
  report.finishedAt = new Date().toISOString();
  report.eligibleForDeployment = true;
  persist();
  return { ...report, reportPath };
}

export async function validateRelease({ source, revision, outputRoot = os.tmpdir(), dependencies,
  environment = process.env }) {
  if (!source || !revision) throw new Error('Specify --source and an exact --revision');
  const git = (args, cwd = source) => execFileSync('git', args, { cwd, encoding: 'utf8', env: validationEnvironment(environment) }).trim();
  const commit = git(['rev-parse', '--verify', `${revision}^{commit}`]);
  if (commit !== git(['rev-parse', 'refs/heads/main'])) throw new Error('The intended revision must match source main; fetch/update main first, without merging local patches');
  if (dependencies && !fs.statSync(path.join(path.resolve(dependencies), 'next/package.json')).isFile()) throw new Error('Dependencies must be an installed node_modules directory on this host');
  const stateDirectory = fs.mkdtempSync(path.join(path.resolve(outputRoot), 'videops-release-'));
  fs.chmodSync(stateDirectory, 0o700);
  const releaseDirectory = path.join(stateDirectory, 'source');
  // Copy committed source only. No old .next, .env, runtime config, SQL, media,
  // browser profiles, or local auth patches enter this release checkout.
  git(['clone', '--no-hardlinks', '--no-checkout', '--single-branch', '--branch', 'main', '--', path.resolve(source), releaseDirectory]);
  git(['checkout', '--detach', commit], releaseDirectory);
  if (git(['rev-parse', 'HEAD'], releaseDirectory) !== commit) throw new Error('Release revision mismatch');
  if (dependencies) fs.symlinkSync(path.resolve(dependencies), path.join(releaseDirectory, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const report = await validateSteps({ releaseDirectory, stateDirectory, revision: commit,
    environment, install: !dependencies });
  if (git(['rev-parse', 'HEAD'], releaseDirectory) !== commit || git(['status', '--porcelain', '--untracked-files=normal'], releaseDirectory)) {
    report.eligibleForDeployment = false;
    report.error = 'Validation changed the committed source; refusing deployment';
    fs.writeFileSync(report.reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = {};
    for (let index = 2; index < process.argv.length; index += 2) {
      const key = { '--source': 'source', '--revision': 'revision', '--output-root': 'outputRoot', '--dependencies': 'dependencies' }[process.argv[index]];
      if (!key || !process.argv[index + 1]) throw new Error('Usage: node scripts/validate_release.mjs --source REPO --revision SHA [--output-root DIRECTORY] [--dependencies NODE_MODULES]');
      options[key] = process.argv[index + 1];
    }
    const report = await validateRelease(options);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.eligibleForDeployment ? 0 : 1;
  } catch (error) { console.error(`[Validate] ${error.message}`); process.exitCode = 1; }
}
