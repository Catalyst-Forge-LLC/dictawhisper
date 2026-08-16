import fs from 'fs';
import z from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { emitTranscription, transcriptions } from './transcriptionLib.ts';
import { cleanWithOllanet } from './ollanetLib.ts';
import { parseJSON } from './jsonLib.ts';
import { resolveAllowedPath } from './pathAllowLib.ts';
import { buildConsolidateTagsPrompt } from '../prompts/consolidateTags.ts';

export type TagCount = { tag: string; count: number };

export type MergeGroup = {
  keep: string;
  drop: string[];
  reason: 'spelling' | 'similar' | 'synonym';
  counts: Record<string, number>;
};

export type ConsolidatePlan = {
  unique: number;
  notes: number;
  groups: MergeGroup[];
  modelUsed: boolean;
  modelError?: string;
};

export type ApplyResult = {
  ok: true;
  filesChanged: number;
  tagsRewritten: number;
  uniqueBefore: number;
  uniqueAfter: number;
  mapping: Record<string, string>;
};

export function normalizeTag(tag: string): string {
  return String(tag || '')
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function stemToken(token: string): string {
  if (token.length < 4) return token;
  if (token.endsWith('ies') && token.length > 5) return `${token.slice(0, -3)}y`;
  if (/(?:ches|shes|xes|zes|ses)$/.test(token) && token.length > 5) return token.slice(0, -2);
  if (token.endsWith('s') && !token.endsWith('ss') && token.length > 4) return token.slice(0, -1);
  return token;
}

export function stemKey(tag: string): string {
  return normalizeTag(tag).split('-').map(stemToken).filter(Boolean).join('-');
}

export function compactKey(tag: string): string {
  return stemKey(tag).replace(/-/g, '');
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j];
  }
  return prev[b.length];
}

function tagTokens(tag: string): string[] {
  return stemKey(tag).split('-').filter(Boolean);
}

const INFLECTION_SUFFIX = /^(er|ers|or|ing|ed|tion)$/;

function tokenAlmostEqual(a: string, b: string): boolean {
  if (a === b) return true;
  const min = Math.min(a.length, b.length);
  const max = Math.max(a.length, b.length);
  if (min < 5 || max - min > 3) return false;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (longer.startsWith(shorter) && INFLECTION_SUFFIX.test(longer.slice(shorter.length))) return true;
  if (levenshtein(a, b) !== 1) return false;
  let prefix = 0;
  const limit = Math.min(a.length, b.length);
  while (prefix < limit && a[prefix] === b[prefix]) prefix += 1;
  return prefix >= 3;
}

/** Same token count, exactly one long token is a near-typo. Skips unigrams (andrew/andrea). */
function tokensClose(a: string[], b: string[]): boolean {
  if (a.length !== b.length || a.length < 2) return false;
  let diffs = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === b[i]) continue;
    diffs += 1;
    if (diffs > 1 || !tokenAlmostEqual(a[i], b[i])) return false;
  }
  return diffs === 1;
}

class UnionFind {
  parent = new Map<string, string>();

  add(item: string) {
    if (!this.parent.has(item)) this.parent.set(item, item);
  }

  find(item: string): string {
    this.add(item);
    const parent = this.parent.get(item)!;
    if (parent !== item) {
      const root = this.find(parent);
      this.parent.set(item, root);
      return root;
    }
    return item;
  }

  union(a: string, b: string) {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent.set(rootA, rootB);
  }

  clusters(): string[][] {
    const groups = new Map<string, string[]>();
    for (const item of this.parent.keys()) {
      const root = this.find(item);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root)!.push(item);
    }
    return [...groups.values()].filter((group) => group.length > 1);
  }
}

export function collectTagInventory(): { notes: number; counts: Map<string, number> } {
  const counts = new Map<string, number>();
  let notes = 0;
  for (const json of Object.values(transcriptions)) {
    const tags = Array.isArray(json?.tags) ? json.tags : [];
    const seen = new Set<string>();
    let any = false;
    for (const raw of tags) {
      const tag = normalizeTag(String(raw));
      if (!tag || seen.has(tag)) continue;
      seen.add(tag);
      counts.set(tag, (counts.get(tag) || 0) + 1);
      any = true;
    }
    if (any) notes += 1;
  }
  return { notes, counts };
}

export function preferredTagsForCleanup(limit = 80): string[] {
  const { counts } = collectTagInventory();
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([tag]) => tag);
}

function pickCanonical(tags: string[], counts: Map<string, number>): string {
  return [...tags].sort((a, b) => {
    const byCount = (counts.get(b) || 0) - (counts.get(a) || 0);
    if (byCount) return byCount;
    if (a.length !== b.length) return a.length - b.length;
    return a.localeCompare(b);
  })[0];
}

function toGroup(
  members: string[],
  counts: Map<string, number>,
  reason: MergeGroup['reason']
): MergeGroup | null {
  const unique = [...new Set(members.map(normalizeTag).filter(Boolean))];
  if (unique.length < 2) return null;
  const keep = pickCanonical(unique, counts);
  const drop = unique.filter((tag) => tag !== keep).sort((a, b) => a.localeCompare(b));
  const groupCounts: Record<string, number> = {};
  for (const tag of unique) groupCounts[tag] = counts.get(tag) || 0;
  return { keep, drop, reason, counts: groupCounts };
}

export function clusterTagsLocally(counts: Map<string, number>): MergeGroup[] {
  const tags = [...counts.keys()].filter(Boolean);
  const union = new UnionFind();
  const byCompact = new Map<string, string>();

  for (const tag of tags) {
    union.add(tag);
    const key = compactKey(tag);
    if (!key) continue;
    const existing = byCompact.get(key);
    if (existing) union.union(existing, tag);
    else byCompact.set(key, tag);
  }

  const tokenized = tags.map((tag) => tagTokens(tag));
  for (let i = 0; i < tags.length; i += 1) {
    if (tokenized[i].length < 2) continue;
    for (let j = i + 1; j < tags.length; j += 1) {
      if (tokensClose(tokenized[i], tokenized[j])) union.union(tags[i], tags[j]);
    }
  }

  const groups: MergeGroup[] = [];
  for (const members of union.clusters()) {
    const sameCompact = new Set(members.map(compactKey)).size === 1;
    const reason: MergeGroup['reason'] = sameCompact ? 'spelling' : 'similar';
    const group = toGroup(members, counts, reason);
    if (group) groups.push(group);
  }
  groups.sort((a, b) => a.keep.localeCompare(b.keep));
  return groups;
}

function knownSet(counts: Map<string, number>): Set<string> {
  return new Set(counts.keys());
}

function sanitizeModelMerges(
  raw: unknown,
  counts: Map<string, number>
): { keep: string; drop: string[] }[] {
  const known = knownSet(counts);
  const parsed = z
    .object({
      merges: z
        .array(
          z.object({
            keep: z.string(),
            drop: z.array(z.string()).default([]),
          })
        )
        .default([]),
    })
    .safeParse(raw);
  if (!parsed.success) return [];

  const out: { keep: string; drop: string[] }[] = [];
  for (const merge of parsed.data.merges) {
    const members = [merge.keep, ...merge.drop]
      .map(normalizeTag)
      .filter((tag) => known.has(tag));
    const unique = [...new Set(members)];
    if (unique.length < 2) continue;
    const keep = known.has(normalizeTag(merge.keep))
      ? pickCanonical(
          [normalizeTag(merge.keep), ...unique.filter((tag) => tag !== normalizeTag(merge.keep))],
          counts
        )
      : pickCanonical(unique, counts);
    const drop = unique.filter((tag) => tag !== keep);
    if (drop.length) out.push({ keep, drop });
  }
  return out;
}

function unionGroups(
  local: MergeGroup[],
  extra: { keep: string; drop: string[] }[],
  counts: Map<string, number>
): MergeGroup[] {
  const union = new UnionFind();
  const localMember = new Set<string>();
  for (const group of local) {
    for (const tag of [group.keep, ...group.drop]) {
      union.add(tag);
      localMember.add(tag);
    }
    for (const tag of group.drop) union.union(group.keep, tag);
  }
  for (const group of extra) {
    union.add(group.keep);
    for (const tag of group.drop) {
      union.add(tag);
      union.union(group.keep, tag);
    }
  }

  const localReason = new Map<string, MergeGroup['reason']>();
  for (const group of local) {
    for (const tag of [group.keep, ...group.drop]) localReason.set(tag, group.reason);
  }

  const groups: MergeGroup[] = [];
  for (const members of union.clusters()) {
    const allLocal = members.every((tag) => localMember.has(tag));
    const reason: MergeGroup['reason'] = allLocal
      ? localReason.get(members[0]) || 'spelling'
      : 'synonym';
    const group = toGroup(members, counts, reason);
    if (group) groups.push(group);
  }
  groups.sort((a, b) => a.keep.localeCompare(b.keep));
  return groups;
}

async function suggestModelMerges(
  counts: Map<string, number>,
  local: MergeGroup[]
): Promise<{ merges: { keep: string; drop: string[] }[]; error?: string }> {
  const inventory = [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  const prompt = buildConsolidateTagsPrompt(
    inventory,
    local.map((group) => ({ keep: group.keep, drop: group.drop }))
  );
  const format = zodToJsonSchema(
    z.object({
      merges: z.array(
        z.object({
          keep: z.string(),
          drop: z.array(z.string()),
        })
      ),
    })
  );
  try {
    const { completion } = await cleanWithOllanet(prompt, format as Record<string, unknown>);
    const json = await parseJSON(completion);
    return { merges: sanitizeModelMerges(json, counts) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { merges: [], error: message };
  }
}

export async function buildConsolidatePlan(options: { useModel?: boolean } = {}): Promise<ConsolidatePlan> {
  const { notes, counts } = collectTagInventory();
  const local = clusterTagsLocally(counts);
  let groups = local;
  let modelUsed = false;
  let modelError: string | undefined;
  if (options.useModel) {
    const suggested = await suggestModelMerges(counts, local);
    modelUsed = !suggested.error;
    modelError = suggested.error;
    groups = unionGroups(local, suggested.merges, counts);
  }
  return {
    unique: counts.size,
    notes,
    groups,
    modelUsed,
    modelError,
  };
}

export function mappingFromGroups(groups: { keep: string; drop: string[] }[]): Map<string, string> {
  const mapping = new Map<string, string>();
  for (const group of groups) {
    const keep = normalizeTag(group.keep);
    if (!keep) continue;
    for (const raw of group.drop || []) {
      const drop = normalizeTag(raw);
      if (drop && drop !== keep) mapping.set(drop, keep);
    }
  }
  return mapping;
}

export function rewriteTags(tags: unknown, mapping: Map<string, string>): string[] | null {
  if (!Array.isArray(tags)) return null;
  const next: string[] = [];
  const seen = new Set<string>();
  let changed = false;
  for (const raw of tags) {
    const rawStr = String(raw ?? '').trim();
    const tag = normalizeTag(rawStr);
    if (!tag) {
      changed = true;
      continue;
    }
    const mapped = mapping.get(tag) || tag;
    if (mapped !== rawStr) changed = true;
    if (seen.has(mapped)) {
      changed = true;
      continue;
    }
    seen.add(mapped);
    next.push(mapped);
  }
  if (!changed) return null;
  return next;
}

export function applyConsolidateGroups(groups: { keep: string; drop: string[] }[]): ApplyResult {
  const mapping = mappingFromGroups(groups);
  const uniqueBefore = collectTagInventory().counts.size;
  let filesChanged = 0;
  let tagsRewritten = 0;

  for (const [jsonFile, json] of Object.entries(transcriptions)) {
    const allowed = resolveAllowedPath(jsonFile);
    if (!allowed.ok) continue;
    const previous: unknown[] = Array.isArray(json?.tags) ? json.tags : [];
    const nextTags = rewriteTags(previous, mapping);
    if (!nextTags) continue;
    tagsRewritten += previous.filter((tag) => mapping.has(normalizeTag(String(tag)))).length;
    json.tags = nextTags;
    fs.writeFileSync(allowed.path, JSON.stringify(json, null, 2), { encoding: 'utf-8' });
    emitTranscription(null, allowed.path);
    filesChanged += 1;
  }

  return {
    ok: true,
    filesChanged,
    tagsRewritten,
    uniqueBefore,
    uniqueAfter: collectTagInventory().counts.size,
    mapping: Object.fromEntries(mapping),
  };
}
