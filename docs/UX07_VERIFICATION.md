# UX07 verification — organization and recoverable removal

Status: **Verified**, 2026-10-06. PH03 also includes completed UX08.

## Delivered

- Optional additive `entryId` in sidecars, index schema 5, browse/search summaries, and reader responses. Legacy entries remain readable without migration. New writes assign IDs; explicit backfill is available in Settings. Cleanup preserves identity, confirmed date, title, star, tags, and MayDo decisions.
- Whole-entry bundles include the JSON sidecar, working audio, and all recognized `_original`/`_clean` variants. Moves copy with exclusive destination creation, verify SHA-256 against source and destination, and remove originals only after verification. Runtime failure restores removed sources from intact copies; uncertain bytes stay retained with exact recovery paths.
- Durable per-entry Trash manifests and idempotent removal/restore receipts. Normal UI removal waits for acknowledgment before removing the card/reader. Eight-second Undo uses the restore API. Later restore is available under Settings → Data and maintenance → Trash. Restore defaults to Keep both when any bundle path collides.
- Permanent removal requires a separate per-bundle action and exact audio/transcript confirmation. Recovery bundles cannot be purged. Trash paths are checked against redirected folders/junctions; the legacy irreversible socket deletion no longer removes files.
- Conflict preview compares incoming/existing title, date, speech, full paths, total bytes, and all bundle files. Keep both is the primary default; Keep existing sends incoming to Trash; replacement requires a checkbox and first preserves the existing bundle in Trash.
- Date assignment records the user-confirmed calendar date without fabricating an exact time. Moves reconcile index paths transactionally, cache, Activity, selected reader, and URL. An entry that leaves current results stays open with the existing outside-results explanation.
- Tag changes have conditional five-second Undo: restoration refuses to overwrite a newer edit. Recovery toasts remain visible without changing list geometry.

## Automated evidence

`pnpm test`: **164 passed, 0 failed**. `pnpm typecheck`, runtime TypeScript compilation, and client production build passed. `git diff --check` passed.

Eight focused recovery tests cover actual on-disk bundle retention and byte-identical restore; idempotent receipts; collision suffixes; copy/removal failure rollback; changed source/backup retention; typed purge; explicit identity backfill; confirmed date/human metadata; replacement backup; stale previews; write locks; nonexistent destinations under escaped junctions; failed index reconciliation rollback; conditional tag Undo; and redirected Trash directory protection.

HTTP tests exercise actual API validation, durable Trash/restore, replacement gating, path reconciliation, and derived-cache rebuilding. Existing MCP/read/search and legacy sidecar compatibility tests pass.

## Browser evidence

Isolated 204-entry fixture on port 17778; model inference/queues disabled. No real journal bundle was moved, removed, migrated, or backfilled for these checks.

- **A28:** Date assignment moved an Unfiled entry, updated its open reader and URL, and retained content. Trash waited for acknowledgment, closed the reader after success, and server Undo restored it. Later Settings restore required preview/confirmation and removed the restored item from Trash.
- **A28 failure:** A deliberately failed HTTP removal retained the selected transcript and showed an actionable failure. Retrying with the same request identity succeeded; Undo restored through the real bundle service.
- **A29:** Holding conflict preview showed both four-file bundles (270 B and 279 B), included full paths and distinct transcripts, defaulted to Keep both, and disabled replacement until confirmation. Actual Keep both produced both original and `-2` bundles with all audio variants intact; the selected entry stayed readable outside Needs attention with its new path.
- **A33:** Legacy sidecars read before identity migration. Moving/Trash/restore preserve the assigned ID and human fields in tests. Fixture tag removal followed by Undo restored both tags; concurrent-edit rejection is separately tested through the production patch service.
- Native modal behavior, Escape/Close, reachable 44px controls, and reader/list continuity were checked. Proof: `Z:/workspace/__tmp/dictawhisper-ux07.jpg`.

## Issue corrected during final verification

Undo notices initially rendered in normal flow and shifted the list. They now render as fixed, opaque notices with 44px action targets; browser inspection confirmed fixed position, solid background, and successful tag Undo after rebuilding.

## Limits and next work

Ordinary date/file moves have verified runtime rollback and transactional index reconciliation; they are **not claimed power-loss atomic**. Trash receipts retain interrupted states and checksum recovery, but ambiguous partial copies are kept for inspection rather than guessed away. Crash/power-loss durability is not a replacement for backups. Organization requests do not yet have the idempotent response-loss receipt contract of Trash; refresh/reconcile before retrying a moved source if acknowledgment is lost.

No open UX07 implementation blocker. Physical touch/actual 200% zoom remain UX02-V01. Cross-app synchronization remains separately scoped UX09.
