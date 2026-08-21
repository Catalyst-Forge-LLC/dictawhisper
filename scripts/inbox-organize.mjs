/**
 * File audio inside a VoiceNotes __inbox into __inbox/YYYY/MM/.
 * Does not touch the live YYYY/MM journal beside __inbox.
 * Convert/stamp stay in MediaTuna — this script only files.
 *
 *   node scripts/inbox-organize.mjs --dry-run
 *   node scripts/inbox-organize.mjs --apply
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFilenameDate, normalizeDatedBasename } from '../../mediatuna/lib/filename-dates.js';
import { copyAndRepairTimestamps, repairCreatedIfMoved } from '../../mediatuna/lib/timestamps.js';
import { AUDIO_EXTS } from '../../mediatuna/lib/constants.js';

const DEFAULT_INBOX = 'C:\\Users\\acmegeek\\VoiceNotes\\__inbox';

const SKIP_DIR = new Set(['__sync', '.stfolder', '.stversions']);
const SKIP_EXT = new Set([
  '.txt',
  '.srt',
  '.tsv',
  '.vtt',
  '.json',
  '.log',
  '.md',
  '.xml',
  '.xn',
  '.csv',
  '.sta',
]);

/** Phone video that is often a voicenote; file it, convert later. */
const EXTRA_MEDIA = new Set(['.3gp', '.3g2', '.webm', '.dss', '.dvf']);

export function isInboxMedia(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (SKIP_EXT.has(ext)) return false;
  if (path.basename(filePath).startsWith('.')) return false;
  return AUDIO_EXTS.has(ext) || EXTRA_MEDIA.has(ext);
}

function monthFromFolder(dir, inboxRoot) {
  const rel = path.relative(inboxRoot, dir).replace(/\\/g, '/');
  const nested = rel.match(/(?:^|\/)(\d{4})\/(\d{2})(?:\/|$)/);
  if (nested) return { year: nested[1], month: nested[2], source: 'folder:YYYY/MM' };
  const flat = rel.match(/(?:^|\/)(\d{4})-(\d{2})(?:\/|$)/);
  if (flat) return { year: flat[1], month: flat[2], source: 'folder:YYYY-MM' };
  const day = rel.match(/(?:^|\/)(\d{4})-(\d{2})-(\d{2})(?:\/|$)/);
  if (day) return { year: day[1], month: day[2], source: 'folder:YYYY-MM-DD' };
  return null;
}

/** Call dumps: …_2019_12_03_18_59_40_in. Tape labels: …_2007_08_07 */
export function parseEmbeddedUnderscoreDate(basename) {
  const ext = path.extname(basename);
  const stem = path.basename(basename, ext);
  const clock = stem.match(/^(.*?)(?:^|_)(\d{4})_(\d{2})_(\d{2})_(\d{2})_(\d{2})_(\d{2})(?:_|$)/);
  if (clock) {
    const rest = (clock[1] || '').replace(/_+$/, '');
    const rewritten = `${clock[2]}-${clock[3]}-${clock[4]}_${clock[5]}-${clock[6]}-${clock[7]}${rest ? `_${rest}` : ''}${ext}`;
    return parseFilenameDate(rewritten);
  }
  const day = stem.match(/^(.*)_(\d{4})_(\d{2})_(\d{2})$/);
  if (day) {
    const rest = day[1].replace(/_+$/, '');
    return parseFilenameDate(`${day[2]}-${day[3]}-${day[4]}_${rest}${ext}`);
  }
  return null;
}

export function planFile(filePath, inboxRoot) {
  const inbox = path.resolve(inboxRoot);
  const src = path.resolve(filePath);
  if (src !== inbox && !src.startsWith(`${inbox}${path.sep}`)) {
    throw new Error(`refusing path outside inbox: ${src}`);
  }
  const parsed = parseFilenameDate(path.basename(src)) || parseEmbeddedUnderscoreDate(path.basename(src));
  const folder = monthFromFolder(path.dirname(src), inbox);
  let year;
  let month;
  let dateSource;
  if (parsed) {
    year = parsed.parsed.year;
    month = parsed.parsed.month;
    dateSource = `filename:${parsed.source}`;
  } else if (folder) {
    year = folder.year;
    month = folder.month;
    dateSource = folder.source;
  } else {
    const dest = path.join(inbox, '_unfiled', path.basename(src));
    if (path.resolve(dest) === src) {
      return { src, dest, action: 'already', dateSource: 'none' };
    }
    return { src, dest, action: 'unfiled', dateSource: 'none' };
  }

  const destDir = path.join(inbox, year, month);
  const embedded = parseEmbeddedUnderscoreDate(path.basename(src));
  let destName = parsed ? normalizeDatedBasename(path.basename(src)) : path.basename(src);
  if (embedded && !parseFilenameDate(path.basename(src))) {
    destName = normalizeDatedBasename(
      `${embedded.parsed.year}-${embedded.parsed.month}-${embedded.parsed.day}${embedded.parsed.hasTime ? `_${embedded.parsed.hour}-${embedded.parsed.minute}-${embedded.parsed.second}` : ''}${embedded.rest ? `_${embedded.rest}` : ''}${path.extname(src)}`,
    );
  }
  let dest = path.join(destDir, destName);
  if (path.resolve(dest) === src) {
    return { src, dest, action: 'already', dateSource };
  }
  return { src, dest, action: 'move', dateSource, year, month };
}

export function uniqueDest(destPath, taken, srcPath) {
  if (srcPath && path.resolve(destPath) === path.resolve(srcPath)) return destPath;
  if (!fs.existsSync(destPath) && !taken.has(destPath.toLowerCase())) return destPath;
  const parsed = path.parse(destPath);
  for (let i = 2; i < 10000; i += 1) {
    const candidate = path.join(parsed.dir, `${parsed.name}-${i}${parsed.ext}`);
    if (!fs.existsSync(candidate) && !taken.has(candidate.toLowerCase())) return candidate;
  }
  return path.join(parsed.dir, `${parsed.name}-${Date.now()}${parsed.ext}`);
}

export function assertInsideInbox(filePath, inboxRoot) {
  const inbox = path.resolve(inboxRoot);
  const resolved = path.resolve(filePath);
  if (resolved !== inbox && !resolved.startsWith(`${inbox}${path.sep}`)) {
    throw new Error(`refusing path outside inbox: ${resolved}`);
  }
}

function walkMedia(inboxRoot) {
  const files = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIR.has(entry.name.toLowerCase())) continue;
        walk(full);
        continue;
      }
      if (isInboxMedia(full)) files.push(full);
    }
  };
  walk(inboxRoot);
  return files;
}

function movePreservingTimes(src, dest, inboxRoot) {
  assertInsideInbox(src, inboxRoot);
  assertInsideInbox(dest, inboxRoot);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.renameSync(src, dest);
    repairCreatedIfMoved(dest);
    return;
  } catch {
    fs.copyFileSync(src, dest);
    copyAndRepairTimestamps(src, dest);
    fs.unlinkSync(src);
  }
}

function removeEmptyDirs(dir, inboxRoot) {
  if (path.resolve(dir) === path.resolve(inboxRoot)) return;
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = path.join(dir, name);
    try {
      if (fs.statSync(full).isDirectory()) removeEmptyDirs(full, inboxRoot);
    } catch {
      // gone
    }
  }
  try {
    entries = fs.readdirSync(dir);
    if (entries.length === 0) fs.rmdirSync(dir);
  } catch {
    // not empty or in use
  }
}

function parseArgs(argv) {
  const apply = argv.includes('--apply');
  const dryRun = !apply;
  const limitArg = argv.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.slice('--limit='.length)) : Infinity;
  const dirArg = argv.find((a) => a.startsWith('--dir='));
  const onlyArg = argv.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.slice('--only='.length).toLowerCase() : '';
  const inboxRoot = path.resolve(dirArg ? dirArg.slice('--dir='.length) : DEFAULT_INBOX);
  return { apply, dryRun, limit, only, inboxRoot };
}

export function planInbox(inboxRoot, { only = '' } = {}) {
  assertInsideInbox(inboxRoot, inboxRoot);
  if (path.basename(inboxRoot) !== '__inbox') {
    throw new Error(`expected an __inbox folder, got ${inboxRoot}`);
  }
  const taken = new Set();
  const plans = [];
  for (const src of walkMedia(inboxRoot)) {
    if (only && !path.basename(src).toLowerCase().includes(only)) continue;
    let plan = planFile(src, inboxRoot);
    if (plan.action === 'move' || plan.action === 'unfiled') {
      const dest = uniqueDest(plan.dest, taken, plan.src);
      if (dest !== plan.dest) plan = { ...plan, dest, collision: true };
      taken.add(plan.dest.toLowerCase());
    }
    plans.push(plan);
  }
  return plans;
}

function main() {
  const { apply, limit, only, inboxRoot } = parseArgs(process.argv.slice(2));
  console.log(`[inbox-organize] root ${inboxRoot} ${apply ? 'APPLY' : 'dry-run'}${only ? ` only=${only}` : ''}`);
  const plans = planInbox(inboxRoot, { only });
  const counts = { move: 0, already: 0, unfiled: 0, collision: 0 };
  let applied = 0;
  for (const plan of plans) {
    counts[plan.action] += 1;
    if (plan.collision) counts.collision += 1;
    const relSrc = path.relative(inboxRoot, plan.src);
    const relDest = path.relative(inboxRoot, plan.dest);
    if (plan.action !== 'already') {
      console.log(`${plan.action.padEnd(8)} ${plan.dateSource.padEnd(22)} ${relSrc} -> ${relDest}`);
    }
    if (!apply) continue;
    if (plan.action === 'already') continue;
    if (applied >= limit) continue;
    assertInsideInbox(plan.src, inboxRoot);
    assertInsideInbox(plan.dest, inboxRoot);
    if (path.resolve(plan.src) === path.resolve(plan.dest)) continue;
    movePreservingTimes(plan.src, plan.dest, inboxRoot);
    applied += 1;
  }
  if (apply) removeEmptyDirs(inboxRoot, inboxRoot);
  console.log(
    `[inbox-organize] ${plans.length} media  move=${counts.move} already=${counts.already} unfiled=${counts.unfiled} collisions=${counts.collision}${apply ? ` applied=${applied}` : ''}`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
