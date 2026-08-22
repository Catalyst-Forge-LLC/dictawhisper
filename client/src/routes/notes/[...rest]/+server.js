import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');

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

/** SvelteKit can claim /notes before Vite's proxy; forward to the API. */
export async function GET({ url, params }) {
  const rest = params.rest ? `/${params.rest}` : '';
  const target = `${apiOrigin()}/notes${rest}${url.search}`;
  const response = await fetch(target);
  return new Response(await response.text(), {
    status: response.status,
    headers: { 'content-type': response.headers.get('content-type') || 'application/json' },
  });
}
