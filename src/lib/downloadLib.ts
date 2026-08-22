import path from 'node:path';

export function contentDisposition(filePath: string, kind: 'inline' | 'attachment' = 'inline'): string {
  const base = path.basename(filePath).replace(/[\r\n"]/g, '_');
  const fallback = base.replace(/[^\x20-\x7E]/g, '_');
  const encoded = encodeURIComponent(base).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
