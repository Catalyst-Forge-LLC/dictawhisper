/**
 * Set filesystem dates on __inbox media to the date in the filename.
 * Clock is kept from the current mtime (or the filename clock if it has one).
 * Does not touch the live journal.
 *
 *   node scripts/inbox-fix-mtime.mjs --dry-run
 *   node scripts/inbox-fix-mtime.mjs --apply
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseFilenameDate } from '../../mediatuna/lib/filename-dates.js';
import { parseEmbeddedUnderscoreDate, assertInsideInbox, isInboxMedia } from './inbox-organize.mjs';

const DEFAULT_INBOX = 'C:\\Users\\acmegeek\\VoiceNotes\\__inbox';
const SKIP_DIR = new Set(['__sync', '.stfolder', '.stversions']);

function ymd(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseNameDate(basename) {
  return parseFilenameDate(basename) || parseEmbeddedUnderscoreDate(basename);
}

export function plannedMtime(parsed, currentMtime) {
  const hour = parsed.parsed.hasTime ? Number(parsed.parsed.hour) : currentMtime.getHours();
  const minute = parsed.parsed.hasTime ? Number(parsed.parsed.minute) : currentMtime.getMinutes();
  const second = parsed.parsed.hasTime ? Number(parsed.parsed.second) : currentMtime.getSeconds();
  const args = [
    Number(parsed.parsed.year),
    Number(parsed.parsed.month) - 1,
    Number(parsed.parsed.day),
    hour,
    minute,
    second,
    currentMtime.getMilliseconds(),
  ];
  return parsed.hasZ ? new Date(Date.UTC(...args)) : new Date(...args);
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

export function planMtimeFixes(inboxRoot) {
  assertInsideInbox(inboxRoot, inboxRoot);
  const plans = [];
  for (const src of walkMedia(inboxRoot)) {
    const parsed = parseNameDate(path.basename(src));
    if (!parsed) continue;
    const current = fs.statSync(src).mtime;
    const next = plannedMtime(parsed, current);
    if (ymd(current) === ymd(next)) continue;
    plans.push({
      src,
      from: ymd(current),
      to: ymd(next),
      next,
      source: parsed.source,
    });
  }
  return plans;
}

function localStamp(mtime) {
  return `${ymd(mtime)} ${String(mtime.getHours()).padStart(2, '0')}:${String(mtime.getMinutes()).padStart(2, '0')}:${String(mtime.getSeconds()).padStart(2, '0')}`;
}

function applyLocalTimes(plans, inboxRoot) {
  for (const plan of plans) {
    fs.utimesSync(plan.src, plan.next, plan.next);
  }
  if (process.platform !== 'win32' || plans.length === 0) return;
  const ps1 = path.join(inboxRoot, '.mtime-fix.ps1');
  const lines = plans.map((p) => {
    const stamp = JSON.stringify(localStamp(p.next));
    const file = JSON.stringify(p.src);
    return `$f = Get-Item -LiteralPath ${file}; $d = [datetime]::ParseExact(${stamp}, 'yyyy-MM-dd HH:mm:ss', $null); $f.CreationTime = $d; $f.LastWriteTime = $d`;
  });
  fs.writeFileSync(ps1, lines.join('\n'));
  execFileSync('powershell', ['-NoProfile', '-File', ps1], { stdio: 'inherit' });
  fs.unlinkSync(ps1);
}

function parseArgs(argv) {
  const apply = argv.includes('--apply');
  const dirArg = argv.find((a) => a.startsWith('--dir='));
  const inboxRoot = path.resolve(dirArg ? dirArg.slice('--dir='.length) : DEFAULT_INBOX);
  return { apply, inboxRoot };
}

function main() {
  const { apply, inboxRoot } = parseArgs(process.argv.slice(2));
  if (path.basename(inboxRoot) !== '__inbox') {
    throw new Error(`expected an __inbox folder, got ${inboxRoot}`);
  }
  const plans = planMtimeFixes(inboxRoot);
  const byFromTo = new Map();
  for (const plan of plans) {
    const key = `${plan.from} -> ${plan.to}`;
    byFromTo.set(key, (byFromTo.get(key) || 0) + 1);
    console.log(`${plan.from} -> ${plan.to}  ${path.relative(inboxRoot, plan.src)}`);
  }
  if (apply) {
    for (const plan of plans) assertInsideInbox(plan.src, inboxRoot);
    applyLocalTimes(plans, inboxRoot);
  }
  console.log(`[inbox-fix-mtime] ${plans.length} date mismatches${apply ? ' applied' : ' (dry-run)'}`);
  for (const [key, n] of [...byFromTo.entries()].sort()) {
    console.log(`  ${n}  ${key}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
