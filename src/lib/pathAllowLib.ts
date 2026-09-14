import fs from 'fs';
import path from 'path';
import { config } from '../config.ts';

export type AllowedPath =
  | { ok: true; path: string; root: string; relative: string }
  | { ok: false; error: string };

export function allowedRoots(): string[] {
  return [...config.watch.roots, config.watch.browserDropFolder].map((root) => path.resolve(root));
}

function existingRealPath(filePath: string): string {
  const resolved = path.resolve(filePath);
  try {
    if (fs.existsSync(resolved)) return fs.realpathSync(resolved);
  } catch {
    // keep the resolved path
  }
  return resolved;
}

/** Relative path under `root`, or null if `candidate` escapes it. */
export function containedRelative(candidate: string, root: string): string | null {
  const rel = path.relative(root, candidate);
  if (rel === '') return '.';
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
  return rel;
}

export function resolveAllowedPath(input: string): AllowedPath {
  if (!input || typeof input !== 'string') {
    return { ok: false, error: 'missing path' };
  }
  if (input.includes('\0')) {
    return { ok: false, error: 'unreadable path' };
  }

  let candidate: string;
  try {
    candidate = existingRealPath(input.trim());
  } catch {
    return { ok: false, error: 'unreadable path' };
  }

  for (const root of allowedRoots()) {
    let rootPath = root;
    try {
      rootPath = existingRealPath(root);
    } catch {
      rootPath = path.resolve(root);
    }
    const relative = containedRelative(candidate, rootPath);
    if (relative) {
      return { ok: true, path: candidate, root: rootPath, relative };
    }
  }

  return { ok: false, error: 'path is outside configured watch roots' };
}
