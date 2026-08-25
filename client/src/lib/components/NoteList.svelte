<script>
  import NoteCard from './NoteCard.svelte';
  import VirtualList from './VirtualList.svelte';

  export let items = [];
  export let variant = 'note';
  export let query = '';
  export let selectedTags = [];
  export let expanded = {};
  export let showRaw = {};
  export let noteBusy = {};
  export let landFile = '';
  export let landCue = null;
</script>

<VirtualList {items} let:item>
  <NoteCard
    transcription={item}
    {variant}
    {query}
    {selectedTags}
    expanded={!!expanded[item.jsonFile]}
    showRaw={!!showRaw[item.jsonFile]}
    busy={!!noteBusy[item.jsonFile]}
    playing={!!expanded[item.jsonFile] && typeof item.transcriptionJson?._currentTime === 'number'}
    landCue={landFile === item.jsonFile ? landCue : null}
    on:toggle
    on:star
    on:tag
    on:savetags
    on:raw
    on:time
    on:copy
    on:retry
    on:skip
    on:resolve
    on:delete
  />
</VirtualList>
