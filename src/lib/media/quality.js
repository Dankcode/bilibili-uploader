/** Describe measured dimensions, not an assertion about the source's maximum quality. */
export function describeDimensions(width, height) {
  const w = Number(width); const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 'Resolution unavailable';
  return `${w} × ${h} · ${Math.min(w, h)}p`;
}

export function formatMediaSize(bytes) {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size <= 0) return '';
  return size >= 1024 ** 3 ? `${(size / 1024 ** 3).toFixed(2)} GB` : `${(size / 1024 ** 2).toFixed(1)} MB`;
}

export function versionLabel(kind) {
  const labels = { original: 'Downloaded source', videoEditor: 'Video editor output', sam3_inpaint: 'SAM3 mask and inpainting', sam3_light_blur: 'SAM3 light mask', sam3_adaptive_blur: 'Adaptive mask', sam3_logo_blur: 'SAM3 logo mask', logo_blur: 'Logo blur', bilibili_logo_name_blur: 'Logo and name blur' };
  return labels[kind] || String(kind || 'Video version').replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
}

export function formatBitrate(bitsPerSecond) {
  const value = Number(bitsPerSecond);
  if (!Number.isFinite(value) || value <= 0) return '';
  return value >= 1e6 ? `${(value / 1e6).toFixed(2)} Mb/s` : `${Math.round(value / 1e3)} kb/s`;
}

/**
 * How the source was obtained, from the download's stream selection. States
 * what Bilibili offered this session; it does not claim the upload's master
 * quality, and an upscale is never described as a better source.
 */
export function describeSourceSelection(selection) {
  if (!selection?.selected) return '';
  const picked = selection.selected;
  const label = (selection.listedQualities || []).find((item) => item.qualityId === picked.qualityId)?.label;
  const parts = [`Bilibili quality ${picked.qualityId}${label ? ` (${label})` : ''}`, `${picked.width} × ${picked.height}`, picked.codecs];
  parts.push(selection.session === 'signed-in' || selection.signedIn ? 'signed-in session' : 'public access — a signed-in session may be offered more');
  if (selection.highestOffered) parts.push('highest quality offered');
  const withheld = (selection.unavailableQualities || []).map((item) => item.label || `qn ${item.qualityId}`);
  if (withheld.length) parts.push(`listed but not offered: ${withheld.join(', ')}`);
  return parts.filter(Boolean).join(' · ');
}

/** "Matches source …" or the differences an edited version has from its input. */
export function describeSourceMatch(validation) {
  const comparison = validation?.comparison;
  if (!comparison) return 'not compared with source';
  if (comparison.ok) return `matches source size, frame rate and audio; duration Δ ${comparison.durationDeltaSeconds}s (±${comparison.durationToleranceSeconds}s allowed)`;
  return `differs from source: ${comparison.differences.join('; ')}`;
}
