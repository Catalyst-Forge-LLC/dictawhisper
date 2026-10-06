# UX03 entry identity and reader actions — verification

2026-10-05. **Verified.** Next implementation packet: UX04 query continuity and pagination. UX02-V01 remains open for physical touch and actual 200% browser zoom; this packet does not claim to resolve that separate manual review.

## Changes

- Deterministic title precedence: sidecar `displayTitle`, meaningful filename label after a validated date/time prefix, then a dated Recording title for generic recording labels. Invalid/uncertain prefixes remain intact. Month precision and unknown recording time are preserved. File-derived fallback dates say inferred from file.
- Title editing through POST `/note`, trimmed and limited to 160 characters; blank resets to the filename-derived title. No file rename. Full path and recording sequence remain under Processing details.
- Cache schema 4 adds display title to summaries and lexical search. Existing derived FTS caches migrate and rebuild from sidecars without rewriting source files or needing new embeddings merely for title edits.
- Actual audio metadata supplies duration. Processing `elapsed` appears only in Processing details.
- Readable/Original and Copy transcript appear before the text. Original-only speech is immediately readable, including sidecars with plain text and no segments. Readable fallback passages have no fabricated zero timestamp.
- Transcript text is selectable; separate timestamp buttons seek/play. Copy passage excludes timing. Whole copy follows the chosen transcript view. Success is announced without changing paragraph layout; failure offers manual text selection.
- Sticky native player remains mounted across entry sections. Playback speed is remembered; Follow audio defaults off, scrolls only the reader, and turns off with manual scrolling. New entry selection pauses the previous source; refresh/return do not autoplay. Recorder start emits a pause event after recording starts.
- Local Find in entry has literal escaped highlighting, counts, previous/next, Enter/Shift+Enter, and Close/Escape focus return. It leaves the library query unchanged. Search-passage navigation lives in More and never starts audio.
- More includes title editing, downloads, JSON export, processing information, reprocessing, and existing file operations. Mobile More stays in the pane; mobile audio gets full width, with speed/follow options in More. Escape returns focus to More. Reader sections remain a correctly labeled button group.
- Cards show active MayDo counts only; their badge opens MayDos, and +N opens Tags. Ordinary selection preserves a previously chosen reader section. Keyboard selection focuses the heading; title changes during Previous/Next are announced.
- Cleanup rereads disk before committing output and retains title/star/current tag edits and MayDo decisions. Human tag edits receive an ownership marker. For older unmarked sidecars, existing tags are retained alongside generated tags so cleanup cannot silently remove an older human tag. Extraction continues to update only its own fields from a fresh sidecar.

## Automated checks

- `pnpm test`: **125 passed**.
- `pnpm typecheck`: passed.
- `pnpm build:runtime`: passed.
- `pnpm --dir client build`: passed, with no Svelte accessibility or unused-selector warnings in the final build.
- `git -c core.whitespace=cr-at-eol diff --check`: passed.

New tests cover title/date precision and uncertain prefixes, Original and untimed fallback, active counts, literal highlighting/escaping, unsupported/rejected clipboard fallback, cleanup human edits, additive title patch/clear/validation, title search, and migration of an old cached title/FTS schema without source rewrites. The extraction concurrency test now asserts preservation of the human display title too.

## Browser acceptance

Used the actual built client and isolated `scripts/ux01-fixture.mjs`, with real JournalIndex filtering and 202 sample entries. No real journal, workers, models, or production server were used.

| Case | Evidence |
| --- | --- |
| A14 Original-only | Fixture 198 immediately shows its original plain speech, Original selected, Readable unavailable, and Retry cleanup. Whole Copy succeeds. |
| A15 text selection | Clicking and drag-selecting passage text left audio paused at zero. The selected text contained speech and excluded the timestamp. |
| A15 copy feedback | Whole transcript Copy announced Transcript copied. A fixture response with `Permissions-Policy: clipboard-write=()` produced the visible alert “Could not copy. Select transcript text and copy manually.” The check waits for the asynchronous copy result. |
| A16 timestamp | A 0:31 timestamp sought to about 31.65s and played only after the explicit click. |
| A16 tab/player | Switching from Transcript to Tags retained one playing audio element: 31.65s before, 32.14s afterward, at the chosen 1.5× speed. Returning to Transcript kept that player. |
| A16 entry change | Selecting Original-only Fixture 198 paused/replaced the previous source, with one paused player at zero. Reload also remained paused. |
| A17 missing audio | Fixture 197 returns 404 for audio; a visible audio error appeared while passages and successful Copy remained available. Error messages distinguish missing/unsupported, decode, and network failures. |
| A18 Follow | Off by default; enabling Follow brought the playing passage into view. Wheel scrolling turned Follow off while playback continued. Sticky controls remained at the reader's top edge. |
| A31 Find | Finding Passage 40 navigated and highlighted that passage, with a match count, while library query stayed Fixture 199 and audio stayed paused. Closing Find returned focus to Find in entry. |
| A31 More | Escape closed More and returned focus to its summary. Mobile menu bounds were inside the screen (x56–356 at 390px), with independently scrollable content. |
| A31 card controls/session | +20 more opened Tags 22; active MayDo badge opened MayDos. Closing/reopening Fixture 196 restored MayDos, and keyboard Enter focused H2 without playing audio. |
| Title editing/search | Renaming Fixture 198 to Kitchen fixture plan updated its heading; title patch and title-search correctness are also covered against the real index in automated tests. |
| Geometry regression | 390/768/1024/1440/1920px widths had no horizontal page overflow and retained visible Copy/Back controls. At 1440×900 the two-line title with 22 tags had first passage y203.06, about 142.4px of reader chrome. |
| Provenance | More showed Audio duration 1:30 separately from Processing time 73.645s. Full path stayed in Details. |

Two defects found during checks were fixed: a forwarded scroll event was treated as a pause flag, and mobile More could open off-screen. Their corrected behavior is covered above. Search landing now accounts for sticky controls so a matching passage is not hidden underneath them. Initial clipboard snapshots were too early; the completed denial check verified the actual alert rather than inferring success/failure from an intermediate state.

Screenshot: `Z:/workspace/__tmp/dictawhisper-ux03.jpg` (sample data).

## Boundaries and follow-up

- Recoverable Move to Trash requires UX07's bundle/restore backend. This packet retains the existing deletion under the precise label Delete permanently… and an explicit irreversible confirmation; it does not present permanent removal as Trash. No deletion was executed during checks.
- Real microphone/recorder-start playback pause should be exercised with the capture checks in UX05. No microphone permission or recording was initiated in this packet.
- Actual physical-touch/200% browser zoom checks remain UX02-V01. Viewport/reflow checks are not substituted for those claims.
- No real-model quality assessment was attempted. Tests inject deterministic output for integrity/concurrency checks.
- The production server remains stopped, and the existing lockfile changes are preserved.

## Reproduction

Build the client; run `node --experimental-strip-types scripts/ux01-fixture.mjs`; open `http://127.0.0.1:17778/`. Search Fixture 199 for a long title/22 tags, Fixture 198 for Original-only, or Fixture 197 for missing audio. For denied clipboard, launch a fresh document at `http://127.0.0.1:17778/?q=Fixture%20198&clipboardDenied=1`, open the entry, and Copy transcript. Wait for the visible copy result; clipboard denial does not hide or erase the text. Stop the fixture afterward.
