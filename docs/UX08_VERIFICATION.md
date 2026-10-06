# UX08 verification — Settings, Help, and maintenance

Status: **Verified**, 2026-10-06. PH03 is Verified; editable Settings remain UX08b.

## Delivered

- Eight-section native Settings drawer: General, Folders, Transcription, Cleanup and MayDos, Search, Data and maintenance, Integrations, About. Values come from an explicit effective-settings API, including actual config path, runtime/worker/queues, folder availability, model destination, search config, listener/exposure, and runnable local MCP configuration. No placeholder Save controls or unsolicited capability probes.
- Task Help explains finding/filtering, reading/listening/copying, capture, MayDo decisions/backfill, organization, recovery, and the shortcuts actually implemented. Contextual buttons route to Settings/Help/Activity while preserving workspace context. On narrow headers, Help remains available through Settings.
- Explicit capability/diagnostic checks separate required transcription, optional cleanup, search readiness, and runtime/folders. Reports can be copied with visible outcome and selectable fallback. Optional cleanup failure leaves Original/read-only journal use available.
- Advanced maintenance has one home. MayDo durable jobs and cleanup retries link to Activity; tag consolidation previews affected counts and starts model-based synonym suggestions unselected; applying requires reviewed selection and acknowledgment. Errors remain visible. Ordinary tag Undo is conditional; bulk consolidation explicitly has no Undo.
- Audio checking is read-only first. Only reviewed hits from a completed check can be marked unreadable; stale/changed/active files are skipped with reasons, and all audio remains retained. Explicit identity backfill and derived words-index rebuild are separate actions; rebuilding the derived index does not launch embeddings.
- Startup/doctor report actual config and API/inbox endpoints with grouped readiness. Fixed packaged UI root masking and added validated `DICTA_UI_PORT` override for the shared packaged listener, preserving checkout API binding behavior.
- Updated README and HTTP/run/MCP docs cover effective Settings, maintenance, sidecar metadata, scoped page cursors, job behavior, recovery, explicit CLI/env configuration, local MCP startup, and the planned ExoMetaCortex integration.

## Automated evidence

`pnpm test`: **164 passed, 0 failed**, including recovery, Settings/API, capture, reader, paging, status filters, durable jobs, pipeline behavior, and a real MCP client. `pnpm typecheck` and runtime/client production builds passed; `git diff --check` passed.

Settings/API tests verify read-only effective config without folder creation; valid source MCP entrypoint; actual recovery endpoints; derived index rebuild without models; rejection of unscanned audio marking before writes; byte-preserved audio; current indexed tag counts and preserved human metadata.

Startup integration tests compile the runtime, then start both source and compiled servers with disposable explicit configurations/ephemeral ports. Processing queues and model destinations are disabled; Python is deliberately unavailable. Both modes show the exact config/endpoints, distinguish optional cleanup, report transcription blocked, and successfully serve the built inbox plus effective Settings. No real microphone or real journal processing is exercised. The test builds missing UI output so a fresh checkout can run the same check after dependency setup.

The packaged homepage initially returned the API welcome page, and explicit UI-port override initially bound 7777. Both defects were recorded during verification, fixed, and retested successfully. New port tests cover valid/invalid overrides and unchanged checkout API binding.

## Browser evidence

Isolated fixture on 17778 with simulated readiness, disabled model inference, and real backend recovery/maintenance services where mounted.

- **A26/A34:** Settings renders actual configuration and folder availability. Diagnostics are triggered explicitly, show an optional-cleanup warning while reading remains available, and Copy diagnostic report reports success. Actual process startup is covered separately by the source/compiled integration test.
- **A31:** Eight sections have distinct labels. Native modal makes the workspace inert, retains focus, and returns focus to the invoker or visible header fallback on dismissal. Help → Settings dismissal was corrected during verification. Phone header retains five usable controls; Help is discoverable in Settings.
- At 390×844, document width was 390 and Settings client/scroll widths both 384; Close was 44px high and remained visible. At 800×900, document width was 800 and Settings client/scroll widths both 613. Desktop was checked at 1440×900. No new horizontal overflow was found. This is viewport verification, not a physical touch or actual browser zoom claim.
- Trash recovery from Settings, explicit fixture ID backfill, and reader tag Undo were exercised. Model-consuming maintenance and actual unreadable marking are verified with disposable service tests rather than modifying the user's journal.
- **A35:** Existing read-only MCP search/get/recent/tag calls pass in the regression suite. Settings emits the correct executable/source-or-compiled entrypoint and `DICTA_CONFIG`; ExoMetaCortex clearly says Not connected/planned.
- Proof: `Z:/workspace/__tmp/dictawhisper-ux08.jpg`.

## Remaining boundaries

No open UX08 implementation blocker. Settings are intentionally read-only; atomic editing/restart behavior belongs to deferred UX08b. Live model quality/throughput, hardware microphone, physical touch, and actual 200% browser zoom are not claimed by these checks. UX02-V01 remains the manual review item. UX09 integrations/enhancements remain Deferred. Existing uncommitted work and the pre-existing lockfile change are preserved. Verification servers are temporary; unrelated existing listeners are left alone.
