---
title: Run
---

```bash
pnpm dev     # API + UI  →  http://localhost:7777
pnpm start   # API only on 127.0.0.1:8008
pnpm ui      # UI only
pnpm turbo   # API with large-v3-turbo (bash)
```

The UI proxies `/socket.io` and API paths, so open **7777** only. API defaults to `127.0.0.1:8008`.

## Retranscribe

`pnpm retranscribe` is for a pile of existing notes, or when a transcript went wrong. Newest first; notes that already have word times are skipped unless you pass `--force`.

```bash
pnpm retranscribe
pnpm retranscribe --dir="./notes/2026/08" --limit=5 --reclean
pnpm retranscribe --force
```

`--reclean` runs ollanet again after the new transcript. Without it, cleaned text and tags are kept; only words/times/raw text update. Each successful cleanup writes a `cleanup` record (text, time, model, host, prompt version, app version). The previous record, if any, is prepended to `cleanupHistory` (capped). `cleanedTranscription` remains the current text.

## Site

Marketing site (FilePress): [`site/`](https://github.com/Catalyst-Forge-LLC/dictawhisper/tree/master/site). From the package root: `pnpm site:dev` / `pnpm site:build` / `pnpm ship`. Live: [dictawhisper.com](https://dictawhisper.com).
