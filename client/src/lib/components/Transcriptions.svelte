<script>
  export let transcriptions = [];
  export let socket;

  const expandedRows = [];

  function toggleExpandedRow(i) {
    return function () {
      expandedRows[i] = !!!expandedRows[i];
    };
  }

  function deleteTranscription(jsonFile) {
    if (confirm('Are you sure you want to delete this transcription?')) {
      transcriptions = transcriptions.filter((transcription) => transcription.jsonFile !== jsonFile);
      socket.emit('delete-transcription', { jsonFile });
    }
  }

  function copyTranscription(transcription) {
    const text = transcription.transcriptionJson.segments.map((segment) => segment.text).join(`\n`);
    navigator.clipboard.writeText(text);
  }

  socket.on('transcription', (data) => {
    console.log('transcription', { data });
    transcriptions = [...transcriptions, data];
  });
</script>

<section class="transcriptions">
  <table>
    <tr>
      <th>Start</th>
      <th>End</th>
      <th>Text</th>
      <th></th>
    </tr>
    {#each transcriptions as transcription, i}
      <tr class="transcription" class:expanded={expandedRows[i]}>
        <td colspan="3" on:click={toggleExpandedRow(i)}>
          {transcription.jsonFile}
          {transcription.transcriptionJson.elapsed}
        </td>
        <td align="center">
          <button on:click={() => deleteTranscription(transcription.jsonFile)}> DEL</button>
          <button on:click={() => copyTranscription(transcription)}> COPY</button>
        </td>
      </tr>
      {#if expandedRows[i]}
        {#each transcription.transcriptionJson.segments as segment}
          <tr>
            <td>{segment.start}</td>
            <td>{segment.end}</td>
            <td>{segment.text}</td>
            <td></td>
          </tr>
        {/each}
      {/if}
    {/each}
  </table>
</section>

<style lang="scss">
  .transcriptions {
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th {
      border-bottom: 2px solid red;
    }
    td {
      padding: 0.25rem;
    }
    tr:hover {
      cursor: pointer;
      background-color: #f1f1f1;
    }
    tr:nth-child(even) {
      background-color: #f9f9f9;
    }
    tr.expanded {
      background-color: #ebb;
      font-weight: 600;
    }
  }
</style>
