---
title: HTTP
---

Force/delete/read only accept realpaths under configured watch roots.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Shared doctor report, queues, Whisper worker, ollanet reachability (`?fresh=1` to skip cache) |
| GET | `/status` | pending / raw / done counts |
| GET | `/notes/index` | Inbox summaries (path, tags, preview, search body) |
| GET | `/note?file=` | Full sidecar (allowlisted) |
| GET | `/audio?file=` | Stream allowlisted audio (sidecar or audio path) |
| POST | `/audio` | Multipart `file` (or `audio`) + optional `clipName` → drop folder, process immediately |
| POST | `/transcribe/force` | `{ "file": "..." }` retry transcription |
| POST | `/process/force` | Re-run cleanup on an existing note |
| POST | `/process/skip` | Leave the raw transcript; skip later cleanup |
| POST | `/holding/resolve` | `{ "file", "action": "overwrite" \| "rename" \| "unfile" }` |
| POST | `/tags/consolidate/preview` | Merge plan (`useModel`, default true) |
| POST | `/tags/consolidate/apply` | `{ "groups": [{ "keep", "drop" }] }` |
