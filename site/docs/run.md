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

If ollanet is down, leave `--reclean` off. The raw transcript stays in the JSON. The inbox **Retry** button queues cleanup without a new Whisper pass.

## Site

Marketing site (FilePress): [`site/`](https://github.com/Catalyst-Forge-LLC/dictawhisper/tree/master/site). From the package root: `pnpm site:dev` / `pnpm site:build` / `pnpm ship`. Live: [dictawhisper.com](https://dictawhisper.com).

## Settings, Help, and recovery

The header Settings view reports the effective config; edit the loaded file and restart to change it. There are no unsaved editable fields. The UI origin and API binding can differ in a checkout; use the actual URLs printed by the launcher. On narrow screens Help is available through Settings → General/About.

Data and maintenance contains Trash, scoped MayDo extraction, reviewed cleanup retries, tag merging, pending-audio checks, and explicit legacy entry-ID backfill. Accepted processing retries appear in Activity. Closing a view does not stop a model job; use Stop after current entry for MayDo backfill. Words-index rebuild is under Search and changes only the derived cache.

Move to Trash retains every audio variant and the sidecar. The eight-second Undo calls the server restore operation. Later restore is available in Settings; collisions keep both. Permanent deletion is per entry, names the retained audio/transcript, and requires typing the confirmation. There is no Empty Trash shortcut.

Doctor separates runtime/folder checks, required transcription setup, cleanup (optional unless configured as required), and search readiness. Optional failures leave Original reading and words search available. Checks can contact configured model services. Select another config through the `DICTA_CONFIG` environment variable; the CLI has no `--config` option.

For a packaged inbox (`DICTA_SERVE_UI=1`), `DICTA_UI_PORT` can explicitly choose the shared UI/API listener. Valid ports are 1–65535. Without this override, the packaged listener uses the LocalSlip UI lease or port 7777. Checkout development retains its separate API binding; setting this UI override does not change that API port. Startup and Settings show the actual listener.
