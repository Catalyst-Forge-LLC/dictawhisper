export function buildConsolidateTagsPrompt(
  tags: { tag: string; count: number }[],
  localGroups: { keep: string; drop: string[] }[]
): string {
  const inventory = tags.map((item) => `${item.tag}\t${item.count}`).join('\n');
  const already = localGroups.length
    ? localGroups.map((group) => `${group.keep} <- ${group.drop.join(', ')}`).join('\n')
    : '(none)';

  return `
<AGENT_ROLE>
You consolidate topic tags from a personal voice journal.
The inventory is existing tags with how many notes use them.
A local pass already merged obvious spelling, hyphen, and plural twins.
Your job is only the leftovers that are the same topic in different words.
</AGENT_ROLE>

<RULES>
- Merge only when a person would treat the tags as one filter: typos the local pass missed, obvious synonyms, or the same phrase with a tiny wording change.
- Do not merge related-but-different topics. family-discussion and family-conflict stay separate. new-york and new-york-city stay separate. work and workplace-conflict stay separate.
- Do not invent a new canonical name. keep must be one of the existing tags in that group, usually the more common one.
- Do not repeat merges already listed in LOCAL_MERGES.
- If nothing else should merge, return {"merges":[]}.
</RULES>

<OUTPUT_JSON_FORMAT>
{"merges":[{"keep":"canonical-tag","drop":["alias-one","alias-two"]}]}
</OUTPUT_JSON_FORMAT>

<LOCAL_MERGES>
${already}
</LOCAL_MERGES>

<TAG_INVENTORY>
${inventory}
</TAG_INVENTORY>
`;
}
