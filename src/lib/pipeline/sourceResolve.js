async function mapWithConcurrency(items, limit, mapper) {
  const result = new Array(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      result[index] = await mapper(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return result;
}

/** Normalize source adapter previews without creating pipeline records. */
export async function resolveSourcePreview(source, sourceInput) {
  if (!source?.resolveInput) throw new Error('Source does not support resolving');
  const resolved = await source.resolveInput(String(sourceInput || '').trim());
  return mapWithConcurrency((resolved?.items || []).slice(0, 100), 4, async (item) => {
    const preview = source.resolvePreview ? await source.resolvePreview(item) : {};
    const normalized = {
      title: String(preview.title || item.title || ''),
      url: String(preview.url || item.url || ''),
      durationSeconds: Math.max(0, Number(preview.durationSeconds) || 0),
      uploader: String(preview.uploader || ''),
      thumbnailUrl: String(preview.thumbnailUrl || ''),
    };
    for (const key of ['description', 'uploadedAt', 'creatorId', 'bvid', 'scraped']) {
      if (preview[key] !== undefined || item[key] !== undefined) normalized[key] = preview[key] ?? item[key];
    }
    if (preview.selected !== undefined || item.selected !== undefined) normalized.selected = preview.selected ?? item.selected;
    return normalized;
  });
}
