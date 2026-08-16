import fs from 'fs';
import path from 'path';
import { config } from '../config.ts';

function normalizePath(filePath: string): string {
  return path.resolve(filePath).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

export function allowedRoots(): string[] {
  return [...config.watch.roots, config.watch.browserDropFolder].map((root) => path.resolve(root));
}

export function resolveAllowedPath(
  input: string
): { ok: true; path: string } | { ok: false; error: string } {
  if (!input || typeof input !== 'string') {
    return { ok: false, error: 'missing path' };
  }

  const resolved = path.resolve(input.trim());
  let candidate = resolved;
  try {
    if (fs.existsSync(resolved)) {
      candidate = fs.realpathSync(resolved);
    }
  } catch {
    return { ok: false, error: 'unreadable path' };
  }

  const cand = normalizePath(candidate);
  for (const root of allowedRoots()) {
    let rootPath = root;
    try {
      if (fs.existsSync(root)) rootPath = fs.realpathSync(root);
    } catch {
      rootPath = path.resolve(root);
    }
    const prefix = normalizePath(rootPath);
    if (cand === prefix || cand.startsWith(`${prefix}/`)) {
      return { ok: true, path: candidate };
    }
  }

  return { ok: false, error: 'path is outside configured watch roots' };
}
