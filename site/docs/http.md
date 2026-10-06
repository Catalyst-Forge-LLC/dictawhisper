---
title: HTTP
---

File paths are resolved against configured roots, including existing parent realpaths. Internal `.dictawhisper` data stays out of the journal index and watchers. File operations return acknowledgments; callers must retain visible state until success.

| Method | Path | Purpose |
|---|---|---|
| GET | `/settings` | Effective read-only configuration, runtime paths, folder existence, capabilities, endpoints, local MCP command. Does not test model connections or create folders. |
| GET | `/health` | Shared doctor report with runtime/transcription/cleanup/search groups; `?fresh=1` explicitly reruns environment and connection checks. |
| GET | `/status` | Processing counts. |
| GET | `/notes/index` | Entry summaries. UI uses the paged search contract for the entire active library; legacy default index scope remains compatible. `all=1` requests all entries. |
| GET | `/notes/search` | `q`, repeated AND `tag`, dates/year/month, `folder`, `attention=1`, `starred=1`, `unreadable=1`, `mayDos`, repeated OR `mayDoStatus`, `sort`, `mode`. `page=1` returns `{hits,total,totalKind,hasMore,nextCursor,indexing}`; continue with the same normalized scope plus cursor. Lexical/filter pages cover exact global results. Ranked pages are bounded snapshots, label counts ranked, expire after 60 seconds, and return `cursor_expired` (409) for refresh. Legacy nonpaged response remains capped. |
| GET | `/notes/years`, `/notes/tags`, `/notes/stats` | Date/tag counts and derived index/embedding coverage. |
| GET | `/note?file=` | Full sidecar; `download=1` exports JSON. |
| POST | `/note` | `{file,displayTitle?,starred?,tags?,expectedTags?,mayDo?:{id,status,expectedStatus?}}`. Title changes do not rename audio. Conditional Undo rejects newer tags/status decisions. |
| GET | `/audio?file=` | Allowlisted audio; `download=1` downloads it. Reading remains possible when audio is missing. |
| POST | `/audio` | Multipart `file`/`audio`, optional `clipName`, `uploadId`. 202 acknowledges saved audio and Activity identity; does not mean transcription finished. |
| GET | `/audio/upload?uploadId=`, `/audio/capabilities` | Recover an upload receipt; supported formats/size capabilities. |
| GET | `/notes/activity` | Durable capture/processing summaries and MayDo backfill state. |
| POST | `/notes/activity/retry`, `/notes/activity/process-now` | Explicit retry/quiet-write-guarded processing for a saved Activity ID. |
| POST | `/transcribe/force`, `/process/force`, `/process/skip` | Retry transcription, retry cleanup, or retain Original and skip cleanup. |
| GET | `/notes/may-dos/capabilities` | Extraction availability and configuration remedy. |
| POST | `/notes/may-dos/extract` | `{file}` explicitly extracts grounded suggestions, preserving decided actions and current human edits. |
| GET/POST | `/tools/may-dos/backfill` | Persisted scoped extraction job. POST Start `{year?,refresh?}`, or `{action:stop\|resume\|retry_failed,id}`. Stop finishes the current entry. Restart requires explicit Resume. |
| GET | `/notes/trash` | Retained bundles and recovery-needed receipts. |
| POST | `/notes/trash/remove` | `{file,requestId?}`. UUID receipt is idempotent for the same removal. Hash-verified bundle includes sidecar, working audio, `_original` and `_clean` variants. Acknowledgment supplies `trashId`, `entryId`, and original path. |
| POST | `/notes/trash/preview` | `{id}` restores to the original path or a collision-free Keep both name. |
| POST | `/notes/trash/restore` | `{id}` restores actual retained files. Keeps both on collision; no overwrite. |
| POST | `/notes/trash/recover` | `{id}` reconciles interrupted receipts only when retained bytes are accounted for; ambiguous copies are retained and full paths reported. |
| POST | `/notes/trash/purge` | `{id,confirmation:"DELETE AUDIO AND TRANSCRIPT"}`. Only acknowledged, unlocked Trash bundles; recovery bundles cannot be purged. |
| POST | `/notes/organization/preview` | `{file,date?,unfile?}` returns both entries, included files/sizes, destination, Keep both destination, and fingerprint. Recording date must be a real `YYYY-MM-DD`. |
| POST | `/notes/organization/apply` | Same scope plus `fingerprint`, `action:keep_both\|keep_existing\|replace`, and `confirmed:true` for replacement. Replacement first saves the existing bundle in Trash. Stale previews return 409. Moves preserve entry identity and reconcile the derived index. |
| POST | `/holding/resolve` | Compatibility `rename`/`unfile` move entire bundles; legacy `overwrite` is rejected in favor of reviewed preview/apply. |
| POST | `/tools/entries/identity` | Explicit legacy ID backfill; reports assigned/current/failed with paths. Busy entries remain retryable. |
| POST | `/tools/index/rebuild` | Rebuild words cache from configured roots; never retranscribes or calls an embedding model. |
| GET/POST | `/tools/probe` | Current pending-audio scan. UI uses check-only `{apply:false}`; legacy `{apply:true}` remains available to explicit API clients. |
| POST | `/tools/probe/mark` | `{files}` from the completed check-only scan, rechecked before unreadable metadata is written. Audio is retained. |
| POST | `/tags/consolidate/preview`, `/tags/consolidate/apply` | Proposed groups (including affected entry counts), then explicit reviewed groups. Model synonyms start unselected in Settings. Batch merge has no Undo. |

The irreversible `delete-transcription` socket event is deprecated and removes nothing. Use acknowledged Trash. Validation/conflict/file-operation failures report an error; retained-path details are included when reconciliation needs review.
