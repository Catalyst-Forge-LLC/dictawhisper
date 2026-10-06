<script>
  // Compatibility component; SettingsDrawer owns maintenance and effective config.
  import SettingsDrawer from './SettingsDrawer.svelte';
  export let open=false,connected=false,noteFilter='all';
</script>
<SettingsDrawer bind:open bind:noteFilter {connected} on:help on:activity on:job />
