# UX06 verification — MayDo review and resilient backfill

Status: **Verified**, 2026-10-05. Next packet: UX07 organization and recoverable removal.

## Delivered

- Shared status/count contract for full sidecars, browse/search summaries, cards, reader tabs, and filter defaults. Counts distinguish active actions (Suggested + Selected) from all saved actions.
- Selected-first review, Suggested second, and collapsed Completed/Dismissed groups. Each action has a direct primary action and an accessible alternative status selector under More. Only the affected action waits for a save.
- Five-second Undo in the review, with an expected-status check that refuses to overwrite a newer decision. Failed Undo remains visible even if its action is in a collapsed group.
- Selectable source quote disclosures, visible copy feedback/fallback, and Play source only for a grounded timestamp. Re-extraction remains explicit. None, current, stale, failed, unavailable, and missing-readable-transcript cases have distinct explanations.
- Stable IDs and decided actions survive re-extraction and omitted candidates. Extraction rereads the sidecar after the model returns, preserving concurrent human edits; changed source text rejects stale output. Concurrent callers, including backfill/manual requests and Windows path case variants, join one extraction.
- Atomic durable backfill checkpoints under `.dictawhisper/maydo-job.json` beside the journal index. Persisted scope and per-entry outcomes retain full paths, including duplicate basenames. Server restart marks unfinished work Interrupted and never starts it automatically.
- Explicit Resume, Retry failed, and Stop after current entry. Refresh skips an output already written by the same job, covering a crash between sidecar save and job checkpoint. Persistence failures prevent additional model calls and expose a storage error.
- Separate already-current, no-transcript, unreadable, and failed counts. Retry updates outcomes rather than double-counting them. The legacy numeric `skipped` total stays compatible; `skipReasons` supplies the breakdown.
- Scope/model preview and explicit Start from MayDos → More → Extract from older entries and Tools. Activity offers recovery, and the MayDos view has a nonblocking progress/recovery link. Closing a panel does not stop the job. A remaining saved scope must be resumed before a new scope starts; the UI explains this restriction.
- Manual extraction has its own actual Activity stage and explicit interrupted recovery. Internal default runtime history is ignored by Git; existing history was preserved.

## Automated evidence

`pnpm test`: **150 passed, 0 failed**. `pnpm typecheck`, `pnpm build:runtime`, and the client production build passed. Final focused MayDo tests: **12 passed** after the last backend changes. Whitespace checks passed.

New tests exercise shared counts, all extraction presentation states, concurrent human edits and conditional Undo, duplicate request joining, stop-after-current, persisted scope/outcomes, full-path failure identity, failed-only retry, restart without replay, refresh crash-window skipping, storage failure, and production route intent/year/model/scope validation. Existing search/status OR, reader, capture, Activity, and pipeline tests passed.

## Browser evidence

Used `scripts/ux01-fixture.mjs` on port 17778 with 202 isolated entries, simulated model responses, and real extraction merging/durable job logic. No real microphone or model request was made, and the production server remained stopped.

- **A08 / A19:** MayDos view defaults to active statuses. A four-status entry showed 2 active / 4 saved consistently on its card, tab, and heading. Selected preceded Suggested; Completed and Dismissed started collapsed. Select → Undo restored Suggested and focus. Re-extraction kept all three omitted decided actions and their IDs/statuses. A failed extraction kept all saved actions and offered Retry; a successful retry cleared the failure.
- Source quote disclosure exposed selectable text, Copy source quote, and grounded Play source. Copy feedback was visible in the final build. Saved action controls remained enabled when extraction capability was disabled. The configuration remedy opened Tools and explained the required configuration keys. Stale extraction appeared inside the MayDos tab without starting extraction.
- **A20:** Started a 2010 scope with 67 entries, then stopped after the current entry: 1 processed, 1 extracted. Closing extraction retained its Activity summary and Resume. Resuming with a simulated model failure, then stopping, produced 2 processed, 1 extracted, 1 failed. Retry failed processed only that failed entry: 2 processed, 2 extracted, 0 failed; 65 remained untouched. The fixture recorded exactly three model attempts. The view progress link reopened the saved scope. Restart/interruption and crash-window behavior were verified with persisted-store tests.
- **A31:** Native disclosure/status controls, Escape dismissal, focus restoration, and Undo focus were exercised. At 390, 800, and 1440px, document width matched viewport width. At 390px, the backfill dialog was 390px wide; the review was approximately 343px wide. Visible new buttons, summaries, and selectors all measured at least 44px tall.
- Final review tab had no browser console errors. Proof: `Z:/workspace/__tmp/dictawhisper-ux06.jpg`.

## Issues found and corrected

- Failed extraction initially retained the Extract again label until hydration; local failure now immediately offers Retry extraction.
- Svelte interpreted the year input's literal braces as interpolation, blocking valid four-digit years. The pattern is now an explicit string expression.
- Year selection originally depended on nonempty input, so clearing the field could remove it. Scope mode and year draft are now independent.
- Copy feedback was initially announced only to assistive technology; it is now visible as well.
- The fixture's Activity endpoint originally showed a separate idle job. It now reports the fixture's actual durable job, and stop/resume/retry were rerun successfully. This was a fixture issue.

## Remaining boundaries

No open UX06 implementation blocker. Live model quality, host throughput, and real process termination during an actual LLM call are not claimed by these fixture checks; restart behavior is covered by durable-store tests. Existing UX02-V01 (physical touch and actual 200% browser zoom) remains separate. Cross-entry action worklists/manual title editing and ExoMetaCortex synchronization remain UX09. Recoverable removal stays UX07; Settings/Help restructuring stays UX08.
