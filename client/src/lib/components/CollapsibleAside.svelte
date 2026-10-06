<script>
  // Compatibility component; HelpDrawer owns task help and keyboard reference.
  import HelpDrawer from './HelpDrawer.svelte';
  export let open=false;
</script>
<HelpDrawer bind:open on:settings />
