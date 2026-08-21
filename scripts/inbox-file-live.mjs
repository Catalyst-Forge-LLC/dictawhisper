/**
 * File dated MP3s from VoiceNotes/__inbox into the live YYYY/MM journal.
 * Skips _unfiled. Leaves non-MP3 in inbox. Collision → _holding.
 *
 *   node scripts/inbox-file-live.mjs --dry-run
 *   node scripts/inbox-file-live.mjs --apply
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFilenameDate } from '../../mediatuna/lib/filename-dates.js';
import { copyAndRepairTimestamps, repairCreatedIfMoved } from '../../mediatuna/lib/timestamps.js';
import { monthFromFolder, parseEmbeddedUnderscoreDate, uniqueDest } from './inbox-organize.mjs';

const DEFAULT_INBOX = 'C:\\Users\\acmegeek\\VoiceNotes\\__inbox';
const SKIP_DIR = new Set(['__sync', '.stfolder', '.stversions', '_unfiled']);

export function watchRootFromInbox(inboxRoot) {
  const inbox = path.resolve(inboxRoot);
  if (path.basename(inbox) !== '__inbox') {
    throw new Error(`expected an __inbox folder, got ${inbox}`);
  }
  return path.dirname(inbox);
}

function isMp3(filePath) {
  return path.extname(filePath).toLowerCase() === '.mp3' && !path.basename(filePath).startsWith('.');
}

function walkMp3(inboxRoot) {
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
      if (isMp3(full)) files.push(full);
    }
  };
  walk(inboxRoot);
  return files;
}

function validMonth(month) {
  const n = Number(month);
  return Number.isInteger(n) && n >= 1 && n <= 12;
}

export function planLiveFile(filePath, inboxRoot) {
  const inbox = path.resolve(inboxRoot);
  const watchRoot = watchRootFromInbox(inbox);
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
  } else if (folder && validMonth(folder.month)) {
    year = folder.year;
    month = folder.month;
    dateSource = folder.source;
  } else {
    return { src, dest: src, action: 'skip', dateSource: 'none' };
  }
  if (!validMonth(month)) {
    return { src, dest: src, action: 'skip', dateSource };
  }

  const destDir = path.join(watchRoot, year, month);
  const dest = path.join(destDir, path.basename(src));
  if (path.resolve(dest) === src) {
    return { src, dest, action: 'already', dateSource, year, month };
  }
  return { src, dest, action: 'move', dateSource, year, month };
}

function assertUnder(filePath, root, label) {
  const resolved = path.resolve(filePath);
  const base = path.resolve(root);
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) {
    throw new Error(`refusing ${label} outside ${base}: ${resolved}`);
  }
}

function sidecarPath(audioPath) {
  return `${audioPath.slice(0, -path.extname(audioPath).length)}.json`;
}

function movePreservingTimes(src, dest) {
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
  if (path.resolve(dir) === path.resolve(inboxRoot)) return;
  try {
    entries = fs.readdirSync(dir);
    if (entries.length === 0) fs.rmdirSync(dir);
  } catch {
    // not empty or in use
  }
}

function parseArgs(argv) {
  const apply = argv.includes('--apply');
  const limitArg = argv.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.slice('--limit='.length)) : Infinity;
  const dirArg = argv.find((a) => a.startsWith('--dir='));
  const inboxRoot = path.resolve(dirArg ? dirArg.slice('--dir='.length) : DEFAULT_INBOX);
  return { apply, limit, inboxRoot };
}

export function planLiveInbox(inboxRoot) {
  const watchRoot = watchRootFromInbox(inboxRoot);
  const taken = new Set();
  const plans = [];
  for (const src of walkMp3(inboxRoot)) {
    let plan = planLiveFile(src, inboxRoot);
    if (plan.action === 'move') {
      let dest = plan.dest;
      if (fs.existsSync(dest) || taken.has(dest.toLowerCase())) {
        dest = uniqueDest(path.join(watchRoot, '_holding', path.basename(src)), taken, src);
        plan = { ...plan, dest, action: 'holding', collision: true };
      }
      taken.add(plan.dest.toLowerCase());
    }
    plans.push(plan);
  }
  return plans;
}

function main() {
  const { apply, limit, inboxRoot } = parseArgs(process.argv.slice(2));
  const watchRoot = watchRootFromInbox(inboxRoot);
  console.log(`[inbox-file-live] ${inboxRoot} → ${watchRoot} ${apply ? 'APPLY' : 'dry-run'}`);
  const plans = planLiveInbox(inboxRoot);
  const counts = { move: 0, already: 0, skip: 0, holding: 0 };
  let applied = 0;
  for (const plan of plans) {
    counts[plan.action] += 1;
    const relSrc = path.relative(inboxRoot, plan.src);
    const relDest = path.relative(watchRoot, plan.dest);
    if (plan.action !== 'already') {
      console.log(`${plan.action.padEnd(8)} ${plan.dateSource.padEnd(22)} ${relSrc} -> ${relDest}`);
    }
    if (!apply) continue;
    if (plan.action === 'already' || plan.action === 'skip') continue;
    if (applied >= limit) continue;
    assertUnder(plan.src, inboxRoot, 'src');
    assertUnder(plan.dest, watchRoot, 'dest');
    if (path.relative(watchRoot, plan.dest).split(path.sep)[0].toLowerCase() === '__inbox') {
      throw new Error(`refusing dest back into inbox: ${plan.dest}`);
    }
    if (path.resolve(plan.src) === path.resolve(plan.dest)) continue;
    movePreservingTimes(plan.src, plan.dest);
    const srcJson = sidecarPath(plan.src);
    if (fs.existsSync(srcJson)) {
      const destJson = sidecarPath(plan.dest);
      movePreservingTimes(srcJson, destJson);
    }
    applied += 1;
  }
  if (apply) removeEmptyDirs(inboxRoot, inboxRoot);
  console.log(
    `[inbox-file-live] ${plans.length} mp3  move=${counts.move} holding=${counts.holding} skip=${counts.skip} already=${counts.already}${apply ? ` applied=${applied}` : ''}`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
