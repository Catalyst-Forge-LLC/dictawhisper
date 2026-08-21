/**
 * Stamp phone-dump leftovers in __inbox/_unfiled with MediaTuna MTIME_ names,
 * then they can file into __inbox/YYYY/MM/.
 *
 * Only Record* / Video* (QCP + 3G2 dumps). Forces filesystem mtime so a
 * date-only ID3 tag cannot drop the clock or the MTIME_ marker.
 *
 *   node scripts/inbox-stamp-mtime.mjs --dry-run
 *   node scripts/inbox-stamp-mtime.mjs --apply
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyStampPlan, buildStampedName, formatStampPrefix } from '../../mediatuna/lib/stamp-dates.js';
import { assertInsideInbox } from './inbox-organize.mjs';

const DEFAULT_INBOX = 'C:\\Users\\acmegeek\\VoiceNotes\\__inbox';
const PHONE_DUMP = /^(record|video)\d+/i;
const STAMP_EXT = new Set(['.mp3', '.qcp', '.3g2', '.amr']);

function fromLocalMtime(mtime) {
  return {
    year: String(mtime.getFullYear()).padStart(4, '0'),
    month: String(mtime.getMonth() + 1).padStart(2, '0'),
    day: String(mtime.getDate()).padStart(2, '0'),
    hour: String(mtime.getHours()).padStart(2, '0'),
    minute: String(mtime.getMinutes()).padStart(2, '0'),
    second: String(mtime.getSeconds()).padStart(2, '0'),
    hasTime: true,
  };
}

export function isPhoneDumpName(basename) {
  return PHONE_DUMP.test(path.basename(basename, path.extname(basename)));
}

export function stampedNameFromMtime(basename, mtime) {
  const prefix = formatStampPrefix(fromLocalMtime(mtime), { source: 'mtime' });
  return buildStampedName(basename, prefix) || basename;
}

export function collectStampFiles(unfiledDir, { only = '' } = {}) {
  return fs.readdirSync(unfiledDir)
    .filter((name) => {
      if (name.startsWith('.')) return false;
      const ext = path.extname(name).toLowerCase();
      if (!STAMP_EXT.has(ext)) return false;
      if (only) return name.toLowerCase().includes(only);
      return isPhoneDumpName(name);
    })
    .map((name) => path.join(unfiledDir, name));
}

export function planMtimeStamps(files) {
  const taken = new Set();
  const plans = [];
  for (const input of files) {
    const mtime = fs.statSync(input).mtime;
    const destName = stampedNameFromMtime(path.basename(input), mtime);
    if (destName === path.basename(input)) {
      plans.push({
        input,
        output: input,
        action: 'skip',
        reason: 'already stamped',
        source: 'mtime',
      });
      continue;
    }
    let output = path.join(path.dirname(input), destName);
    if (taken.has(output.toLowerCase()) || (fs.existsSync(output) && path.resolve(output) !== path.resolve(input))) {
      const parsed = path.parse(output);
      let i = 2;
      let candidate = output;
      while (taken.has(candidate.toLowerCase()) || fs.existsSync(candidate)) {
        candidate = path.join(parsed.dir, `${parsed.name}-${i}${parsed.ext}`);
        i += 1;
      }
      output = candidate;
    }
    taken.add(output.toLowerCase());
    plans.push({
      input,
      output,
      action: 'rename',
      reason: 'mtime',
      source: 'mtime',
      created: mtime.toISOString(),
    });
  }
  return plans;
}

function parseArgs(argv) {
  const apply = argv.includes('--apply');
  const dirArg = argv.find((a) => a.startsWith('--dir='));
  const onlyArg = argv.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.slice('--only='.length).toLowerCase() : '';
  const inboxRoot = path.resolve(dirArg ? dirArg.slice('--dir='.length) : DEFAULT_INBOX);
  return { apply, only, inboxRoot };
}

function main() {
  const { apply, only, inboxRoot } = parseArgs(process.argv.slice(2));
  if (path.basename(inboxRoot) !== '__inbox') {
    throw new Error(`expected an __inbox folder, got ${inboxRoot}`);
  }
  const unfiled = path.join(inboxRoot, '_unfiled');
  assertInsideInbox(unfiled, inboxRoot);
  const files = collectStampFiles(unfiled, { only });
  const plans = planMtimeStamps(files);
  console.log(`[inbox-stamp-mtime] ${unfiled} ${apply ? 'APPLY' : 'dry-run'} files=${files.length}`);
  for (const plan of plans) {
    if (plan.action !== 'rename') continue;
    console.log(`rename   ${path.basename(plan.input)} -> ${path.basename(plan.output)}`);
  }
  const result = applyStampPlan(plans, { dryRun: !apply });
  console.log(
    `[inbox-stamp-mtime] renamed=${result.renamed} skipped=${result.skipped} failed=${result.failed}${apply ? '' : ' (dry-run)'}`,
  );
  if (result.errors.length) {
    for (const err of result.errors) console.error(err);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
