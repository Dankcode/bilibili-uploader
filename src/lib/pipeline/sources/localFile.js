import fs from 'fs';
import path from 'path';

export const id = 'localFile';

/**
 * When the planner knows which path the job will use, check that path — a
 * blanket "adapter is available" tells the operator nothing they can act on.
 */
export async function testConnection(credentials = {}, context = {}) {
  const sourceInput = String(context.sourceInput || '').trim();
  if (!sourceInput) return { ok: true, detail: 'Local file adapter is available' };
  try {
    await resolveInput(sourceInput);
    return { ok: true, detail: `Readable: ${path.basename(sourceInput)}` };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

export async function resolveInput(filePath) {
  const resolved = path.resolve(String(filePath || ''));
  if (!path.isAbsolute(String(filePath || '')) || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(`Local source file not found: ${filePath}`);
  }
  return { items: [{ title: path.basename(resolved), path: resolved }] };
}

export async function download(item, destDir, onProgress = () => {}) {
  if (!item?.path || !fs.existsSync(item.path)) throw new Error('Local source file is missing.');
  fs.mkdirSync(destDir, { recursive: true });
  const destination = path.join(destDir, `local-${path.basename(item.path)}`);
  onProgress(10, 'Copying local source');
  fs.copyFileSync(item.path, destination);
  onProgress(100, 'Local source ready');
  return {
    filePath: destination,
    meta: { title: path.basename(item.path, path.extname(item.path)), sourcePath: item.path, platform: 'local' },
  };
}
