<script>
  // Small, local line-icon vocabulary. Labels belong to the containing control;
  // decorative SVGs never add a second accessible name or keyboard stop.
  export let name;
  export let size = 18;
  export let filled = false;
  const paths = {
    library: ['M4 4v16M9 4v16M14 4v16M18 4l3 16'],
    star: ['m12 3 2.8 5.7 6.3.9-4.6 4.5 1.1 6.3-5.6-3-5.6 3 1.1-6.3L3 9.6l6.2-.9Z'],
    maydos: ['M9 5h12M9 12h12M9 19h12M3 5l1 1 2-3M3 12l1 1 2-3M3 19l1 1 2-3'],
    tags: ['M20 13 13 20a2 2 0 0 1-3 0l-7-7V4h9l8 7a2 2 0 0 1 0 2ZM7 8h.01'],
    attention: ['M12 3 2 20h20ZM12 9v4M12 16h.01'],
    mic: ['M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8'],
    upload: ['M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5'],
    activity: ['M2 12h4l3-8 6 16 3-8h4'],
    settings: ['M4 7h16M4 17h16M8 4v6M16 14v6'],
    help: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM9 9a3 3 0 1 1 5 2c-2 1-2 2-2 3M12 17h.01'],
    transcript: ['M5 3h10l4 4v14H5ZM15 3v5h4M8 12h8M8 16h6'],
    copy: ['M9 9h12v12H9ZM5 15H3V3h12v2'],
    search: ['M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM16 16l5 5'],
    more: ['M5 12h.01M12 12h.01M19 12h.01'],
    select: ['M9 3h12v12M3 9h12v12H3Zm3 6 2 2 4-4'],
    check: ['m5 12 4 4L20 5'],
    rename: ['m14 5 5 5M4 20l5-1L21 7l-5-5L4 14ZM13 21h8'],
    download: ['M12 3v13m-5-5 5 5 5-5M4 15v5h16v-5'],
    json: ['M8 3H6v7l-3 2 3 2v7h2M16 3h2v7l3 2-3 2v7h-2M11 9l-1 6M14 9l-1 6'],
    info: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 11v6M12 7h.01'],
    refresh: ['M20 7a9 9 0 0 0-15-2L2 8m0-5v5h5M4 17a9 9 0 0 0 15 2l3-3m0 5v-5h-5'],
    waveform: ['M3 10v4M7 6v12M12 3v18M17 7v10M21 10v4'],
    play: ['m7 3 14 9-14 9Z'],
    stop: ['M5 5h14v14H5Z'],
    skip: ['m5 4 11 8L5 20ZM19 4v16'],
    folder: ['M3 6V4h6l3 3h9v13H3Z'],
    date: ['M4 5h16v16H4ZM4 10h16M8 3v4M16 3v4M8 14h2M14 14h2'],
    trash: ['M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7'],
    chevron: ['m8 5 7 7-7 7'],
    left: ['m15 5-7 7 7 7'],
    list: ['M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01'],
    filter: ['M4 7h16M7 12h10M10 17h4'],
    link: ['m9 15 6-6M8 16l-2 2a3 3 0 0 1-4-4l5-5a3 3 0 0 1 4 0M16 8l2-2a3 3 0 0 1 4 4l-5 5a3 3 0 0 1-4 0'],
  };
</script>
<svg class="dw-icon" width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" stroke-width={name === 'more' ? 3.5 : 1.75} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
  {#each paths[name] || paths.info as d}<path {d}/>{/each}
</svg>
<style>.dw-icon{display:inline-block;flex-shrink:0;vertical-align:middle;pointer-events:none;}</style>
