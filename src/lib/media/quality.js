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
