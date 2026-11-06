/** Combine the shared category guidance with any video-specific instructions. */
export function titleContextForVideo(contexts, categoryId, videoPrompt = '') {
  const shared = String(contexts?.[String(categoryId || 'default')] || '').trim();
  const individual = String(videoPrompt || '').trim();
  return [shared && `Category title guidance: ${shared}`, individual && `Video-specific guidance: ${individual}`].filter(Boolean).join('\n\n');
}
