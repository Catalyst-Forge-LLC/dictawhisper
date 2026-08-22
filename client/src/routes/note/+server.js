import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

function apiOrigin() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'config.json'), 'utf8'));
    const port = cfg.http?.port ?? 8008;
    const host = cfg.http?.host && cfg.http.host !== '0.0.0.0' ? cfg.http.host : '127.0.0.1';
    return `http://${host}:${port}`;
  } catch {
    return 'http://127.0.0.1:8008';
  }
}

/** SvelteKit handles /note before Vite's proxy, so forward to the API here. */
export async function GET({ url }) {
  const file = url.searchParams.get('file');
  const download = url.searchParams.get('download');
  const target = new URL('/note', apiOrigin());
  if (file) target.searchParams.set('file', file);
  if (download) target.searchParams.set('download', download);
  const response = await fetch(target);
  const headers = {
    'content-type': response.headers.get('content-type') || 'application/json',
  };
  const disposition = response.headers.get('content-disposition');
  if (disposition) headers['content-disposition'] = disposition;
  return new Response(await response.arrayBuffer(), {
    status: response.status,
    headers,
  });
}

export async function POST({ request }) {
  const target = new URL('/note', apiOrigin());
  const response = await fetch(target, {
    method: 'POST',
    headers: { 'content-type': request.headers.get('content-type') || 'application/json' },
    body: await request.text(),
  });
  return new Response(await response.text(), {
    status: response.status,
    headers: { 'content-type': response.headers.get('content-type') || 'application/json' },
  });
}
