function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function markPreview(text, query) {
  const source = String(text || '');
  const tokens = String(query || '')
    .replace(/^filename:\s*/i, '')
    .split(/\s+/)
    .map((token) => token.replace(/[^\p{L}\p{N}_*-]/gu, ''))
    .filter((token) => token.length > 1);
  if (!tokens.length) return escapeHtml(source);
  const pattern = new RegExp(`(${tokens.map(escapeRegExp).join('|')})`, 'gi');
  return escapeHtml(source).replace(pattern, '<mark>$1</mark>');
}

export function displayName(jsonFile) {
  const base = String(jsonFile || '').replace(/\\/g, '/').split('/').pop() || '';
  return base.replace(/\.json$/i, '');
}
