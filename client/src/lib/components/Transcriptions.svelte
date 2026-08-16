<script>
  export let transcriptions = [];
  export let socket;

  const MONTHS = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  let expanded = {};
  let openGroups = {};

  function folderOf(jsonFile) {
    const norm = String(jsonFile || '').replace(/\\/g, '/');
    const inPath = norm.match(/\/(\d{4})\/(\d{2})(?:\/|$)/);
    if (inPath) return { year: inPath[1], month: inPath[2], key: `${inPath[1]}-${inPath[2]}` };
    const base = norm.split('/').pop() || '';
    const inName = base.match(/^(\d{4})-(\d{2})-\d{2}/);
    if (inName) return { year: inName[1], month: inName[2], key: `${inName[1]}-${inName[2]}` };
    return { year: null, month: null, key: 'other' };
  }

  function groupLabel(group) {
    if (group.key === 'other') return 'Other';
    const monthName = MONTHS[Number(group.month) - 1] || group.month;
    return `${monthName} ${group.year}`;
  }

  function displayName(jsonFile) {
    return String(jsonFile || '').replace(/\\/g, '/').split('/').pop();
  }

  function groupTranscriptions(list) {
    const map = new Map();
    for (const item of list) {
      const folder = folderOf(item.jsonFile);
      if (!map.has(folder.key)) map.set(folder.key, { ...folder, items: [] });
      map.get(folder.key).items.push(item);
    }
    for (const group of map.values()) {
      group.items.sort((a, b) => displayName(b.jsonFile).localeCompare(displayName(a.jsonFile)));
    }
    const dated = [...map.values()].filter((group) => group.key !== 'other');
    dated.sort((a, b) => b.key.localeCompare(a.key));
    const other = map.get('other');
    return other ? [...dated, other] : dated;
  }

  $: groups = groupTranscriptions(transcriptions);
  $: newestKey = groups[0]?.key;

  function isOpen(key) {
    if (Object.prototype.hasOwnProperty.call(openGroups, key)) return openGroups[key];
    return key === newestKey;
  }

  function onToggle(key, event) {
    openGroups[key] = event.currentTarget.open;
    openGroups = openGroups;
  }

  function toggleExpanded(jsonFile) {
    expanded[jsonFile] = !expanded[jsonFile];
    expanded = expanded;
  }

  function deleteTranscription(jsonFile) {
    if (confirm('Are you sure you want to delete this transcription?')) {
      transcriptions = transcriptions.filter((transcription) => transcription.jsonFile !== jsonFile);
      socket.emit('delete-transcription', { jsonFile });
    }
  }

  function copyTranscription(transcription) {
    const json = transcription.transcriptionJson || {};
    const text =
      json.cleanedTranscription ||
      (json.segments || []).map((segment) => segment.text).join('\n');
    navigator.clipboard.writeText(text);
  }

  socket.on('transcription', (data) => {
    const i = transcriptions.findIndex((t) => t.jsonFile === data.jsonFile);
    if (i >= 0) {
      transcriptions[i] = data;
      transcriptions = transcriptions;
    } else {
      transcriptions = [...transcriptions, data];
    }
  });
</script>

<section class="transcriptions">
  {#each groups as group}
    <details class="folder" open={isOpen(group.key)} on:toggle={(event) => onToggle(group.key, event)}>
      <summary>
        <span class="folder-name">{groupLabel(group)}</span>
        <span class="folder-count">{group.items.length}</span>
      </summary>
      <table>
        <thead>
          <tr>
            <th>Note</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each group.items as transcription}
            <tr class="transcription" class:expanded={expanded[transcription.jsonFile]}>
              <td
                title={transcription.jsonFile}
                tabindex="0"
                on:click={() => toggleExpanded(transcription.jsonFile)}
                on:keydown={(event) => event.key === 'Enter' && toggleExpanded(transcription.jsonFile)}
              >
                {displayName(transcription.jsonFile)}
                {#if transcription.transcriptionJson?.elapsed}
                  <span class="elapsed">{transcription.transcriptionJson.elapsed}</span>
                {/if}
              </td>
              <td class="actions">
                <button type="button" on:click={() => deleteTranscription(transcription.jsonFile)}>DEL</button>
                <button type="button" on:click={() => copyTranscription(transcription)}>COPY</button>
              </td>
            </tr>
            {#if expanded[transcription.jsonFile]}
              {#each transcription.transcriptionJson?.segments || [] as segment}
                <tr class="segment">
                  <td colspan="2">
                    <span class="times">{segment.start}–{segment.end}</span>
                    {segment.text}
                  </td>
                </tr>
              {/each}
            {/if}
          {/each}
        </tbody>
      </table>
    </details>
  {/each}
</section>

<style lang="scss">
  .transcriptions {
    padding: 0.5rem 0 1.5rem;
  }

  .folder {
    margin: 0.5rem 0;
    border-top: 1px solid #ddd;
  }

  summary {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    padding: 0.6rem 0.15rem;
    cursor: pointer;
    list-style: none;
    font-size: 1rem;
  }

  summary::-webkit-details-marker {
    display: none;
  }

  .folder-name {
    font-weight: 600;
  }

  .folder-count {
    color: #666;
    font-size: 0.8rem;
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }

  th {
    text-align: left;
    border-bottom: 1px solid #ccc;
    padding: 0.25rem;
    font-weight: 600;
  }

  td {
    padding: 0.35rem 0.25rem;
  }

  tr.transcription:hover {
    cursor: pointer;
    background-color: #f1f1f1;
  }

  tr.expanded {
    background-color: #ebb;
    font-weight: 600;
  }

  .elapsed {
    color: #666;
    font-weight: 400;
    margin-left: 0.4rem;
  }

  .actions {
    width: 8rem;
    text-align: right;
    white-space: nowrap;
  }

  .actions button {
    font-size: 0.75rem;
    padding: 0.25rem 0.45rem;
  }

  .segment td {
    font-weight: 400;
    color: #333;
    padding-left: 0.75rem;
  }

  .times {
    display: inline-block;
    min-width: 6rem;
    color: #666;
    font-variant-numeric: tabular-nums;
  }
</style>
