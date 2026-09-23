export function parseUploadResult(output, { structured = false, channelId } = {}) {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (structured) {
    let result;
    try { result = JSON.parse(lines.at(-1) || ''); } catch { throw new Error('GUI uploader returned no confirmed receipt'); }
    if (result.ok !== true || result.method !== 'gui' || result.privacyStatus !== 'private'
      || result.channelId !== channelId || !/^[A-Za-z0-9_-]{11}$/.test(result.remoteId || '')
      || result.url !== `https://www.youtube.com/watch?v=${result.remoteId}`) {
      throw new Error('GUI upload receipt failed validation');
    }
    return result.url;
  }
  for (const line of [...lines].reverse()) {
    const match = line.match(/^https:\/\/(?:youtu\.be\/|(?:www\.)?youtube\.com\/watch\?v=)([A-Za-z0-9_-]{11})(?:[?&].*)?$/);
    if (match) return `https://www.youtube.com/watch?v=${match[1]}`;
    if (/^[A-Za-z0-9_-]{11}$/.test(line)) return `https://www.youtube.com/watch?v=${line}`;
  }
  throw new Error('Uploader completed without a valid YouTube URL or video ID');
}
