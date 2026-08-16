import fs from 'fs';
import path from 'path';
import { config } from '../src/config.ts';
import { slimOllamaMeta } from '../src/lib/ollanetLib.ts';
import { isSkippedWatchPath } from '../src/lib/fileSettleLib.ts';

type Sidecar = {
  meta?: unknown;
  [key: string]: unknown;
};

function walkJsonFiles(dir: string, out: string[]) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (isSkippedWatchPath(full)) continue;
      walkJsonFiles(full, out);
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) out.push(full);
  }
}

function stripFile(filePath: string): { changed: boolean; before: number; after: number } {
  const before = fs.statSync(filePath).size;
  let parsed: Sidecar;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Sidecar;
  } catch {
    return { changed: false, before, after: before };
  }

  if (!parsed.meta || typeof parsed.meta !== 'object' || Array.isArray(parsed.meta)) {
    return { changed: false, before, after: before };
  }

  const slim = slimOllamaMeta(parsed.meta);
  if (JSON.stringify(slim) === JSON.stringify(parsed.meta)) {
    return { changed: false, before, after: before };
  }

  parsed.meta = slim;
  fs.writeFileSync(filePath, JSON.stringify(parsed, null, 2), { encoding: 'utf-8' });
  const after = fs.statSync(filePath).size;
  return { changed: true, before, after };
}

const roots = [...config.watch.roots, config.watch.browserDropFolder];
const files: string[] = [];
for (const root of roots) walkJsonFiles(root, files);

let changed = 0;
let saved = 0;
for (const file of files) {
  const result = stripFile(file);
  if (!result.changed) continue;
  changed += 1;
  saved += result.before - result.after;
  console.log(
    `[strip-meta] ${file}  ${result.before} -> ${result.after}  (-${result.before - result.after} bytes)`
  );
}

console.log(`[strip-meta] scanned ${files.length} json files; stripped ${changed}; saved ${saved} bytes`);
