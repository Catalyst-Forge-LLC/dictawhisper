# UX01 verification evidence

Date: 2026-10-05. Packet status is maintained in [APP_UX_SPEC.md](APP_UX_SPEC.md#delivery-progress).

## Checks

- `pnpm test`: 117 passed, 0 failed.
- `pnpm typecheck`: passed.
- `pnpm build:runtime`: passed.
- `pnpm --dir client build`: passed; no Svelte accessibility warnings in the final build. The existing Node child-process deprecation and adapter fallback notices remain.
- `git -c core.whitespace=cr-at-eol diff --check`: passed. The existing Transcriptions file uses CRLF; the initial ordinary whitespace check treated those line endings as trailing whitespace.

The URL tests compare the client JavaScript and runtime TypeScript helpers. Index tests verify exact tag AND and status OR before the result cap, single-status compatibility, all-year active scope, explicit date precedence, and migration of cached cleanup-error metadata without rewriting sidecars. Session tests cover defaults, clear-filter semantics, identity anchors, per-entry reader state, and outside-results navigation.

## Browser fixture

Run from the repository root:

```sh
pnpm --dir client build
node --experimental-strip-types scripts/ux01-fixture.mjs
```

Open http://127.0.0.1:17778/. Stop with Ctrl+C. The fixture creates 202 sample sidecars in a new temporary folder: 200 dated entries across 2010, 2025, and 2026, one unfiled entry, and one holding entry. It uses the real SQLite index and filter parser through an isolated Express/Socket.IO adapter. It serves the built client, sample transcripts, and a silent 90-second WAV. It does not load production configuration, start watchers or model workers, or access the real journal. It deliberately delays one search by 1.4 seconds and entry 003 hydration by 1.6 seconds.

The fixture adapter is not a full production-server end-to-end test. Production route and service changes were checked through compilation, source review, and index/parser tests. The browser evidence below exercises the actual built Svelte client.

| Spec case | Evidence observed |
| --- | --- |
| A01 / A07 | Launch shows 201 active entries without a newest-year constraint. Filename search for 2010 returns older entries. Holding is excluded from Library; unfiled is included. |
| A08 | Suggested and Selected checkboxes produce repeated `mayDoStatus` parameters. Selecting home and budget produces both tag parameters in the same server request. The index test excludes prefix-only tags and completed actions before slicing. MayDos view defaults to Suggested/Selected; Clear filters restores those defaults. |
| A09 | Year 2010 followed by From 2025-09-01 clears year/month. Selecting 2010 again clears From/To. Chips and recorded request parameters agree. |
| A12 | Searching older entries keeps the selected newer reader with the outside-results message. Unstarring a selected entry in Starred removes its card, preserves its reader, and makes Next choose the first current result. |
| A13 | Back/Forward restores selection and chosen Tags tab. Mobile Close preserves query/date scope and restores card focus; Back reopens the reader with heading focus. Playback at approximately 8.7 seconds returns paused at the same position. Reader scroll returns to 512.67 pixels; another long-reader case returned to 1497.33 pixels. |
| A33 | A `view=recent&year=2010&file=...` link opens the original file and canonicalizes to Library with the explicit year. Unit tests also cover all, unfiled, holding, star, single-status, and cue links. Existing sidecar tests pass. |
| A31 state/focus | Desktop pointer selection retains card focus. Enter opens the reader with heading focus. Next retains focus on Next. Resizing a focused desktop card to 390 pixels moves focus to the visible reader heading. Filters use labeled native inputs; Escape and Close return focus to Filters. |

Additional observations:

- Delayed entry 003 followed immediately by entry 004 leaves 004 selected after the older response arrives; no audio starts.
- The delayed slow query cannot replace the final 2010 query. Prior successful cards remain visible during refresh.
- Direct pointer selection deep in the grid preserved the card's offset from 127.26 to 126.22 pixels when it became a list. Locator clicks can center an element before dispatching the click, so this comparison used a coordinate click against a freshly captured screenshot.
- Clearing search restored the same browse entry key, with offset -37.81 before and -38.06 after.
- Checked at 1440×900 and 390×844, with resize continuity between them. Earlier tab continuity also passed at the normal 1280×720 viewport. The full geometry/zoom matrix remains owned by UX02.
- Fixture request logs contain exactly one POST: the explicitly tested star edit. Back/Forward and selection did not replay it, upload audio, or request extraction/backfill.
- Browser console reported no runtime errors in the final checks. Temporary diagnostic logging was removed.

## Repairs made during verification

The first URL test still expected legacy view names; it now checks canonical names and equivalent folder constraints. Browser testing found lost pointer focus after row regrouping, an audio-position overwrite before metadata restoration, and stale history snapshots overriding the latest per-entry tab. Those were corrected and retested. Anchor restoration now waits for measured rows, cancels superseded restorations, and preserves the intended anchor through column changes.

## Remaining packet boundaries

UX02 still owns the pane width budgets, search placement, single reader heading, chrome reduction, and first-passage y≤220 target. UX03 owns presentation/title/date precision and the remaining playback/copy/find controls. UX04 owns full pagination, global ordering before paging, and total/ranked counts. Current filtered/search results remain capped at 50; the UI says up to 50 and Previous/Next describe the available boundary. Needs attention currently covers holding, unfiled, unreadable audio, and saved cleanup errors; pending job visibility belongs to UX05. No 20,000-entry performance budget was benchmarked in this packet.

Existing approved UI/MayDo changes and the pre-existing lockfile change were preserved. This packet does not commit, publish, or start the production app server.
