import { spawn, spawnSync } from 'child_process';

export function commandExists(command) {
  const candidate = String(command || '').trim();
  if (!candidate) return false;
  if (candidate.includes('/')) {
    const result = spawnSync(candidate, ['--version'], { shell: false, stdio: 'ignore', timeout: 5_000 });
    return !result.error;
  }
  const result = spawnSync('sh', ['-lc', 'command -v "$1" >/dev/null 2>&1', 'sh', candidate], {
    shell: false,
    stdio: 'ignore',
    timeout: 5_000,
  });
  return result.status === 0;
}

export function runSubprocess(bin, args, {
  input = '',
  timeoutMs = 120_000,
  cwd = process.cwd(),
  env = process.env,
  label = bin,
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { shell: false, cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      settle(reject, new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
    }, Math.max(1_000, Number(timeoutMs) || 120_000));
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.once('error', (error) => settle(reject, new Error(`${label} could not start: ${error.message}`)));
    child.once('close', (code) => {
      if (code === 0) settle(resolve, { stdout, stderr });
      else settle(reject, new Error(`${label} exited with code ${code}: ${stderr.slice(-1_600) || stdout.slice(-1_600)}`));
    });
    child.stdin.end(String(input || ''));
  });
}
