/** Photo URLs are browser-loaded. No private image is uploaded to the price service. */
export function safePhotoURL(value) {
  if (typeof value !== 'string' || value.length > 2000 || /[\u0000-\u001f\u007f]/.test(value)) return '';
  const input = value.trim();
  if (!input) return '';
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.href.length > 2000) return '';
    return url.href;
  } catch { return ''; }
}

function catalogueId(entry) {
  if (entry?.kind !== 'sealed') return '';
  const match = /^sealed-tcgp-([1-9]\d*)-eu$/.exec(entry.id || '');
  return match && Number.isSafeInteger(Number(match[1])) ? match[1] : '';
}

/** The validated catalogue identity supplies the photo ID, never an editable code. */
export function productImage(entry, quality = 'low') {
  if (entry?.kind !== 'sealed') return '';
  const custom = safePhotoURL(entry.image);
  if (custom) return custom;
  const id = catalogueId(entry);
  return id ? `https://tcgplayer-cdn.tcgplayer.com/product/${id}_${quality === 'high' ? 'in_1000x1000' : '400w'}.jpg` : '';
}

export function productPhotoSource(entry) {
  if (entry?.kind !== 'sealed') return '';
  if (safePhotoURL(entry.image)) return 'Custom image';
  return catalogueId(entry) ? 'TCGplayer catalogue image' : '';
}
