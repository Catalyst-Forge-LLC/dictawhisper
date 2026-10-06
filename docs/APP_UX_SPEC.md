# DictaWhisper complete app UX specification

Status: Core implementation delivered; manual accessibility review remains

Date: 2026-10-06

Scope: The complete DictaWhisper product, including the browser workspace, capture, processing, organization, maintenance, setup, CLI, HTTP, and MCP.

Implementation status: 7 of 8 core packets Verified. UX02 is Needs review for physical touch and actual 200% browser zoom (UX02-V01). UX08b editable settings and UX09 enhancements remain Deferred. Packet and phase evidence is recorded in the delivery tracker.

DictaWhisper should make three activities effortless: find something you said, read or listen to it without losing your place, and decide whether a possible action deserves follow-through. Capture and background processing should support those activities without occupying the reading workspace.

Keep the existing local journal architecture, audio playback, date navigation, sidecar files, stars, tags, and MayDos. Finish the interaction model across the app: give each action one predictable home, preserve context, show honest progress, and make recovery specific. The recommendations below are based on the current source and the friction identified in this conversation. The measurements are acceptance targets, not results from a usability study.

Reading guide: start with [Review decisions](#1-review-decisions) and the [layout](#3-product-structure-and-layout), then review individual flows as needed. For implementation, use the [progress tracker](#delivery-progress), [packets](#16-implementation-packets), [acceptance scenarios](#17-acceptance-scenarios), and [implementation-model prompt](#18-instructions-for-an-implementation-model). The [review guide](#19-review-guide-and-relationship-to-previous-specs) lists the five choices with the largest effect on daily use.

## 1 Review decisions

These are the main product decisions to review before implementation. The remaining requirements specify their consequences.

| Decision | Recommended behavior | Reason |
| --- | --- | --- |
| Default screen | Library containing all active entries, newest first; no implicit newest-year restriction | Search should not silently exclude older entries |
| Main navigation | Library, Starred, MayDos, Needs attention; dates and optional tags below | Reduce competing navigation concepts |
| Desktop reading | Library rail, compact entry list, full-height reader | Reading receives space; the list remains usable |
| Search location | Entry-list header while a reader is open; full browse header otherwise | Search controls should not push the transcript down |
| Entry presentation | Responsive cards before selection; one compact card column alongside the reader | Preserve the requested card browsing model while increasing reading space |
| Reader | Transcript first; MayDos and Tags as labeled tabs with counts | Secondary information remains one click away |
| Playback | Compact player; timestamps play passages; transcript text remains selectable | Avoid accidental playback while selecting or copying text |
| Entry names | Human title when supplied, otherwise a readable filename-derived label | Long timestamp-heavy filenames should not dominate scanning |
| MayDo meaning | Suggested possibilities become Selected, Done, or Dismissed through human choice | An extracted possibility is not automatically a commitment |
| Capture | Record and Import always available in the header, with compact contextual panels | Capture remains discoverable without consuming library height |
| Processing | One Activity surface with stages, jobs, outcomes, and recovery | Replace scattered queue and health details |
| Removal | Recoverable Trash before permanent deletion | Remove repeated confirmation friction without losing recordings |
| Advanced maintenance | Settings and Activity contain tag management, diagnostics, and maintenance jobs | Daily navigation should remain focused on the journal |
| Integration | Preserve local data and current read-only MCP; specify ExoMetaCortex preparation separately | Future integration must not complicate current daily use |

Recommended delivery order: first complete library and reading continuity, then capture and processing feedback, then organization and recovery, then setup and integration preparation. Do not make a new visual theme a prerequisite.

## 2 Current capability and friction audit

The current implementation already has a responsive card grid, a separate reader, transcript/MayDo/tag sections, per-passage copy, date and tag filtering, starred entries, lexical/hybrid search, recording/import, health/tools/help drawers, cleanup retries, holding resolution, and MayDo backfill. Those are the starting point.

| Finding in current code | User consequence | Required correction | Priority |
| --- | --- | --- | --- |
| Search header spans the list and reader | Large controls delay the selected transcript | Place search and filters over the list after selection | P0 |
| Reader contains an outer detail heading and an inner note heading | Repeated framing consumes space | Use one entry heading with navigation and actions | P0 |
| Card title is the basename, with date and elapsed metadata appended | Scanning requires decoding filenames; elapsed can be mistaken for audio length | Separate readable title, recording date, and actual audio duration | P0 |
| Search asks for 50 results, and JournalIndex caps search at 50 | A displayed count can look exhaustive; remaining entries cannot be reached | State limits honestly, then add server pagination | P0/P1 |
| Search ranking is sliced before recent/oldest sorting | Newest/oldest can mean sorting a ranked subset | Define global lexical sorting and explicit hybrid ranked-window semantics | P1 |
| Filter requests clear existing hits while loading | Results flicker and the reader context can appear unstable | Keep prior results until the replacement arrives; cancel stale requests | P0 |
| Multiple filters are stored, but their combination and navigation effects are not fully explicit | Hidden scope and unexpected filter carryover | Apply the scope rules in section 5 | P0 |
| Full-note Copy catches errors in the console | The user cannot tell whether the action worked | Visible success and actionable failure feedback | P0 |
| Paragraphs are buttons that also play audio | Selecting ordinary text risks playback | Make the timestamp/play affordance interactive and text selectable | P0 |
| Card heights formerly reset after hydration; keyed measurements now preserve them | Regression would recreate large gaps | Retain keyed measurements and add hydration/resize regression coverage | P0 |
| Recording Stop immediately initiates upload; upload status is a single string | Weak retry, review, cancellation, and per-file feedback | Keep a local draft until upload acknowledgment; add explicit capture states | P1 |
| Tools combines maintenance, counts, queues, and diagnostics | Users must interpret implementation details | Split Activity from Settings and keep diagnostics expandable | P1 |
| Delete optimistically removes an entry and emits a socket event that unlinks files | No acknowledgment or Undo; the confirmation understates audio deletion | Add acknowledged recoverable Trash and restore operations | P1 |
| Help is a short paragraph drawer | Actions, shortcuts, and recovery are difficult to discover | Task-based help with links into the relevant UI | P1 |
| Settings are currently config/CLI driven | Setup and model/folder changes require file editing | Start with readable settings and guided checks; add validated editing later | P1/P2 |

P0 means a foundation or frequent-flow correction. P1 means a complete daily-product capability. P2 means an enhancement that follows a reliable daily experience. The audit does not claim that any backend operation can be added through CSS alone.

## 3 Product structure and layout

### Primary surfaces

| Surface | Contains | Entry points |
| --- | --- | --- |
| Library workspace | Search, entry cards, date/tag filters, selected reader | App launch, navigation, result links |
| Starred | Library with starred filter active | Library rail and filter menu |
| MayDos | Library with Suggested/Selected action filters; reader MayDos tab | Library rail, card badge, entry tab |
| Needs attention | Processing failures, unreadable audio, holding collisions, unfiled entries, unfinished jobs | Library rail, actionable status indication |
| Capture panel | Recorder or import picker, draft, upload acknowledgment | Header Record/Import, file drop |
| Activity drawer | Current processing, recent outcomes, bulk jobs, retry actions | Header Activity and entry processing badges |
| Settings drawer | Folders, transcription, cleanup, search, preferences, maintenance, integrations | Header Settings |
| Help drawer | Task instructions, shortcuts, troubleshooting, version | Header Help and contextual Help links |
| Trash | Recoverable removed entries and restore | Settings/Data and entry Undo notification |

Use the existing root route and query parameters for the main workspace. Drawers do not require new page routes. Opening any drawer leaves the workspace mounted. A future dedicated MayDo worklist must be a workspace mode, not a separate unrelated task application.

### Desktop geometry

All measurements are CSS pixels. Use the browser content viewport width, not physical monitor resolution.

| Viewport | Library rail | Entry region | Reader |
| --- | --- | --- | --- |
| 1200 and wider | 200 wide, collapsible | 360 default with reader; flexible grid without reader | Remaining width, minimum 440 |
| 960 through 1199 | Drawer; collapsed by default | 320 default with reader | Remaining width |
| Below 960 | Drawer | Full width until selection | Replaces entry region after selection |

Center the shell at a maximum width of 1920. Use 12-pixel outside padding and 12-pixel pane gaps; use 8 pixels below 960. Global header target: 48 to 56 pixels. Avoid a second global toolbar beneath it.

Before selection, cards use one to three columns depending on the measured entry-region width. Minimum card width: 280. Gap: 8. Once the reader opens, the entry region uses one column of compact cards. Do not keep a broad two-column grid by taking width from the reader.

The library rail, entry list, and reader body have separate scroll containers. Scroll boundaries are visible on hover/focus and never create a fourth nested scroll area within the transcript. The reader content column is limited to approximately 72 characters per line; controls use the available pane width. Large monitors increase available reading area without stretching every sentence across the entire browser.

Recommended selected-entry arrangement:

~~~text
App header     DictaWhisper                 Record  Import  Activity  Settings  Help

Library        Search entries...           Entry title                Star  More
Starred        Scope and result count      Date/time    Previous  Next  Close
MayDos         Filters  Sort               Transcript  MayDos  Tags
Needs attention                            Play  elapsed/duration  seek  speed

Dates          Compact entry card          0:00   First transcript passage...
Tags           Compact entry card          0:25   Next transcript passage...
               Compact entry card
               ...                         ...
~~~

Search occupies the entry region. The reader starts at the same top edge as that search region. Reader title, tabs, and player share a compact header budget of at most 144 pixels in the ordinary desktop state. At 1440 by 900, the first transcript passage starts at or above y=220, with no tags, empty MayDo message, or cleanup metadata above it. This target allows a two-line title; long titles move to an ellipsis with a full-title tooltip and editable title field.

Avoid a glowing nested card inside a bordered reader. Use one reader surface, one heading, and a restrained selection indicator in the entry list. Retain amber branding; reduce decorative shadows and blur on repeated list items.

### Responsive continuity

Opening an entry on narrow screens displays a reader with a persistent Back to entries control. Returning restores the exact list position, query, filters, and focused card. A library drawer opened from the reader does not discard the selected entry.

When a resize crosses 960, retain the same selected entry, detail tab, playback position, and reading position. When a resize changes grid columns, restore the list anchor by entry identity and offset rather than a numeric scrollTop alone. At 200 percent browser zoom, use the resulting viewport breakpoint normally.

## 4 Navigation and interaction state

Use separate state for library scope, result selection, reader presentation, and transient UI. An entry's star and its MayDo status are persistent data, not navigation modes named Focus.

| State | Owner | Persistence |
| --- | --- | --- |
| Query, date range, tags, star, MayDo/status filters, sort, folder | URL-backed workspace state | Refresh and copied local link |
| Selected entry and passage | URL-backed selection | Refresh and browser navigation |
| Last browse position before starting search | Session workspace snapshot | Restore when query is cleared |
| List anchor, reader scroll, playback position | Per-entry/session state keyed by identity | Switching entries during a session |
| Default density, collapsed rail, playback speed | Versioned local preference | Across visits in the same browser |
| Reader tab | Per-entry session state | New entry defaults to Transcript; revisiting restores its chosen tab |
| Pending edits, recorder draft, open menu | Transient state with explicit loss handling | Never inferred from URL |
| MayDo status, tags, title, star | Sidecar | Across devices/files when those files are synchronized |

Entry selection opens or updates the reader without changing result order. The selected card has a border/rail, a selected semantic state, and no ongoing animation. Selecting the same card is a no-op. Close reader is an explicit control.

Focus follows the interaction, not hydration. Desktop pointer selection keeps focus on the selected card; keyboard Enter on its open control moves focus to the reader heading. Mobile selection moves focus to the reader heading because the list is hidden. Close restores focus to the invoking card, or the nearest remaining card/search control if that entry no longer matches. Previous/Next retains focus on its navigation button while announcing the new title. A resize that hides the focused pane moves focus to its visible counterpart. Programmatic heading focus may use tabindex=-1; do not add positive tab order values.

Preserve the list anchor when hydration, status edits, live notifications, or card metadata updates replace summary objects. If layout changes from cards to a compact list, anchor the selected entry at the same approximate viewport offset. Do not scroll both the list and reader through a page-wide scrollIntoView call.

If filtering removes the selected entry, keep its reader open and show one small message: This entry is outside the current results. Provide Close entry; do not pick a replacement automatically. If a user advances to Next, choose the first current result when the old entry is outside the result set. Star and MayDo edits that remove a card follow this same rule.

Browser history rules:

1. Replace the URL for query typing and repeated filter edits; do not add an entry for every keystroke.
2. Push a history entry when opening an entry from the list, closing it, or changing a named library view.
3. Previous/Next replaces the selected-entry history state to avoid hundreds of reader steps in browser Back.
4. Back from a mobile reader returns to its list state. Back and Forward never replay a write, start audio, or start a model job.
5. Legacy view=recent and view=all links map to Library; starred and existing folder/date filters retain their meaning.

These rules replace the current universal replaceState behavior. Keep desktop Previous/Next buttons adjacent to the entry title, disabled with a reason at the available result boundary. If there are more result pages, Next loads them before deciding that the last result has been reached.

## 5 Search and filtering

### Search behavior

The search field is visible on launch and whenever the list is visible. Placeholder: Search entries. A helper in Help explains that words, tags, and filenames are searched; the placeholder need not list everything.

Use a 180-millisecond debounce. Enter runs immediately. Abort the previous request when possible and also reject stale responses by request ID. Keep the last successful list visible with a subtle Searching indicator until new results arrive. Only the initial request uses skeleton cards. Never clear the reader as part of a search loading state.

Searching from Library spans all active entries unless the URL has explicit constraints. No implicit newest-year restriction. A year/month selected in the rail remains visible as a chip and scopes the query. Search from Starred, MayDos, or Needs attention preserves that named view's constraint.

Default sort is Newest when query is empty and Best match when it has text, unless the user explicitly chose a sort. Clearing the query restores the saved browse sort. Search method choices live in Settings/Search or an advanced filter section: Words and Words and meaning. Filename-specific searches use lexical matching. Show an unobtrusive explanation when the configured semantic method falls back to words, rather than blocking search.

Empty-result copy names the constraints: No entries match dentist in October 2025 with these tags. Offer Clear search and Clear filters as separate actions. Neither action clears a named view unless explicitly labeled Search all entries.

### Filter combination

| Control | Exact semantics |
| --- | --- |
| Multiple tags | AND: an entry must contain every selected tag |
| Starred | Restrict to starred entries; never a separate pinned group above results |
| MayDo status checkboxes | OR among selected action statuses; an entry qualifies if any action has one of them |
| Multiple different filter kinds | AND between kinds |
| Explicit start/end dates | Inclusive calendar dates in the displayed journal timezone; include an entry when its known date interval overlaps the range |
| Year/month rail | A date range; selecting it clears custom From/To, and vice versa |
| Folder condition | Normal library includes unfiled; holding is in Needs attention by default; Trash is excluded |
| Clear filters | Clears optional date/tag/status/folder constraints; keeps query and named view |
| Reset view | Clears query and optional constraints, restores that named view's default sort |

Default MayDos view includes Suggested and Selected actions. Done and Dismissed are available through explicit status filters. Has any MayDos remains available in Filters for entries containing even only completed/dismissed actions. Do not silently discard those saved actions.

Date precision must remain honest across display and search. An entry known only to March 2009 represents that calendar month for range filtering; it has no claimed March 1 recording time. Use the interval start as an internal chronological sort key if needed, then the stable entry key for ties. Explain month-only dates in Details.

Move tags to a searchable filter list with fixed-size text and counts. Display up to 12 common tags initially, selected tags first. Expand with Show more; never use font size to encode popularity. Consolidation is a maintenance operation in Settings/Data, not part of the tag picker.

Every active constraint has a removable chip. The Filters button shows the number of active optional filter groups, excluding named-view defaults. Chips remove only their own condition. The filter popover supports keyboard operation, Escape, and a visible Close button on mobile.

Selecting a year row selects its range; a distinct chevron expands available months. Do not nest a year button inside an interactive summary. Only populated months need to be listed; unavailable dates remain reachable through the custom range controls.

### Search limits and pagination

Until pagination exists, say Showing up to 50 results when the server supplies a capped result set. Never call that number the total matches.

For lexical search and filter-only browsing, implement stable server pagination of 50 summaries, with total matching count, hasMore, and nextCursor. Apply filters and global sort before slicing. Use a deterministic tie-breaker by recording date and stable entry key. A cursor is opaque and tied to query/filter/sort; a changed query invalidates it. Retain Load more as a keyboard-accessible alternative even if near-bottom loading is automatic.

For hybrid search, paginate a stable ranked candidate snapshot. Its count is the size of that ranked set, not every semantically related entry in the journal. Responses report countKind=ranked, candidateLimit, and hasMore. UI copy: 50 shown from 200 ranked results. Add Search words only as an explicit way to access the globally sortable lexical result set. Do not imply exhaustive semantic totals.

A first implementation may use a 60-second in-memory ranked snapshot and a maximum of 500 candidates. Define its cap and expiration in the server response. An expired cursor offers Refresh results while retaining the reader and query. This is a backend change, not a client-side filtering workaround.

## 6 Entry cards and reading

### Entry cards

Use a readable title, a separate date/time line, up to two preview lines, and one compact metadata row. The preview uses the search snippet during text search and opening transcript text otherwise. Search terms are highlighted as plain escaped text.

Title precedence:

1. User-supplied displayTitle from the sidecar.
2. A meaningful remaining filename label after stripping a recognized date/time prefix and extension.
3. Recording on Oct 1, 2026 when the remaining label is just an auto-generated recording number.

Keep the full filename and path under Details. Do not rename files to change the displayed title. Show a small sequence suffix only when it distinguishes multiple untitled recordings on the same day. Never run an LLM solely to obtain a title during browsing.

Examples for the presentation helper, after removing the extension:

| Stored basename / sidecar | Display title | Separate metadata |
| --- | --- | --- |
| 2026-10-01 21-16-02My recording 80 | Recording on Oct 1, 2026 | Oct 1, 9:16 PM; recording 80 where needed to disambiguate |
| 2010-12-16_Recording | Recording on Dec 16, 2010 | Dec 16; no invented time |
| 2009-03_Two Bit Tips | Two Bit Tips | March 2009; no invented first day |
| A sidecar with displayTitle=Planning the kitchen repair | Planning the kitchen repair | Recording date from supported metadata; original filename in Details |

Recognize only validated date/time prefixes; preserve the complete basename when parsing is uncertain. Generic-label matching is case-insensitive and limited to Recording, My recording, and an optional numeric suffix. Do not strip arbitrary words merely because they contain a number.

Use actual audio duration when known, formatted as 19:37. The existing elapsed field is processing time and belongs in Processing details. An unknown audio duration has no fabricated value. Recording date displays its provenance when inferred from file time; do not claim that a file modification date is definitely the recording date. Preserve source precision: a known month remains a month, and a date without a time remains a date. The journal timezone defaults to the system timezone and is visible in date settings. A filename with an unspecified timezone is a local calendar value, not an invented UTC instant.

Compact cards target 104 to 144 pixels for ordinary content; browse cards target 132 to 168. These are budgets, not fixed heights: larger text and wrapped labels may grow naturally. The vertical gap is 8 pixels after measured row height. No spacer should reflect an obsolete pre-hydration estimate.

Cards retain an always-visible star. Show at most two tags plus +N, and a MayDo badge only when there are active Suggested/Selected actions. The full action count appears in the reader. Card title/preview selects the entry; tag and badge controls are distinct siblings, never nested buttons. A card's +N opens the Tags tab; its MayDo badge opens the MayDos tab. Ordinary selection defaults to Transcript. If tags change the list's filter, retain the selected reader using section 4.

### Reader controls

Use one title/header: readable title, recording date/time, star, Previous, Next, Close, and More. Move Rename display title, Copy full transcript, Download audio, Export entry JSON, Processing details, Reprocess, and Move to Trash into More. Keep Copy full transcript as a labeled visible secondary control when the header has room; it must never require scrolling to the end of a long transcript.

Tabs are Transcript, MayDos with active count, and Tags with total count. Counts use the same definitions as cards. Implement proper accessible tab semantics and keyboard behavior, or use a correctly labeled button group without claiming tabs until that keyboard behavior exists. Empty MayDos are explained inside the tab, not above the transcript.

The Transcript tab has a compact Readable/Original selector beside the player, available before the first paragraph. Default to readable text when present. If cleanup is missing or failed, immediately show the original transcript with one small status and the appropriate Retry cleanup action. A readable transcript must not require a user to click through an error to see it.

Player requirements:

- Play/Pause, elapsed and actual duration, seek, and playback speed are discoverable without scrolling.
- Speed defaults to 1x; choices are 0.75x, 1x, 1.25x, 1.5x, and 2x; remember per browser.
- Clicking a timestamp starts the selected passage after metadata is available. Handle play rejection visibly and offer Play audio.
- Opening an entry, refreshing, and switching tabs never auto-play.
- Selecting another entry pauses the old player. Returning restores position but stays paused.
- At most one audio source plays. Recorder start pauses playback after the recording action is initiated.
- Missing/unreadable audio leaves transcript reading and copying available.
- Keep native audio controls as the implementation fallback until a custom player passes keyboard and seek testing.

Transcript paragraphs are selectable text. The timestamp/play button is separate; clicking or dragging text does not play audio. Copy appears on paragraph hover and keyboard focus, with an always-visible control on touch devices. Copy excludes the timestamp by default. A success indicator lasts about 1.5 seconds and is announced politely; failures offer a manual text-selection fallback. Whole-transcript Copy uses the currently chosen Readable/Original view.

Highlight the currently playing passage without moving focus. Follow audio is off by default. Its explicit toggle auto-scrolls only the reader while enabled; manual reader scrolling turns it off until re-enabled. Search deep links may scroll to a matching passage once, without starting playback. Respect reduced-motion preferences.

Add Find in entry as a labeled reader action: local text query, match count, Next match, Previous match, Close. It never changes the library query or launches a model call. Browser Find remains available through its normal shortcut.

## 7 MayDos across the app

MayDos are possible actions extracted from what the speaker said. Keep the name MayDos in navigation and explain it once in the empty tab: Possible actions mentioned in this entry. Nothing is selected automatically.

| Stored status | Visible meaning | Primary next action |
| --- | --- | --- |
| suggested | Candidate worth reviewing | Select |
| selected | User wants to keep it for possible action | Mark done |
| done | User considers it complete | Reopen as Selected |
| dismissed | User decided to ignore it | Restore as Suggested |

Inside the MayDos tab, group Selected first, Suggested next, then a collapsed Completed and dismissed section. Use a short action title, Select or Done button as appropriate, and More for alternate status transitions. A native Status select can remain as the first accessible implementation; direct buttons are the refinement. Successful status changes are reversible through Undo for 5 seconds. Only the affected action becomes busy.

Keep Source quote as a labeled disclosure under each action. Opening it shows the quoted text and Play source when its timing is grounded. No invented timestamp, owner, due date, or priority. The expanded source quote is selectable and copyable.

Empty states are distinct: Not extracted, No actions found, Extraction failed, and Extraction disabled. Offer Extract MayDos, Extract again, Retry extraction, or Configure cleanup respectively. Disabling cleanup does not hide already saved MayDos.

Preserve stable IDs and human status choices on re-extraction, including decided actions omitted by the new model output. Record source hash, extraction version, model, and time. If extraction is stale because transcript text changed, show a small Out of date indication inside this tab and an explicit refresh action. Do not automatically overwrite edited or selected actions during ordinary viewing.

The MayDos library view returns entries with actions; selecting an entry opens its MayDos tab. Keep its result card linked to the original entry. A later cross-entry action worklist is P2: each action must display its source entry/date and open the same reader. Editing action titles or creating manual MayDos is also P2 and requires an explicit humanEdited flag so extraction cannot overwrite the wording.

### MayDo backfill

Make the job reachable through MayDos view → More → Extract from older entries and through Settings/Maintenance. Use a small scope form: All active entries or Year; default to skipping unchanged entries. Refresh already extracted entries is an advanced checkbox with a brief explanation that statuses are preserved.

Before starting, display the chosen scope and whether the cleanup model is configured. Start is one explicit action. After starting, show progress in Activity and a small nonblocking status in the MayDos view. Closing either view does not stop the job.

Show Processed X of Y, extracted, already current, no transcript, failed, and currently processing entry. Split skip reasons rather than calling unreadable and current entries the same result. Progress is based on processed entries; do not fabricate an ETA. Stop after current entry keeps completed work. Starting again retries failures and skips current results. Retry failed entries is a separate action once the job ends.

Bulk job state should survive a server restart as Interrupted with completed per-entry outputs intact. Persist the job summary and remaining intent, not a stale running flag. Resume is explicit; startup must not unexpectedly submit every journal transcript to a model.

## 8 Recording and import

### Recording

Record is always visible in the app header but uses a secondary treatment while idle. Clicking it opens a compact capture panel and starts the permission/start flow in that panel. Do not ask for microphone permission at app launch.

~~~text
Idle → Requesting microphone → Recording → Draft → Uploading → Accepted
                              ↓            ↓         ↓
                          Discard       Discard   Upload failed → Retry
~~~

Recording displays elapsed capture time, input activity, a prominent Stop button, and Discard. Stop creates a local draft with playback, Save recording, and Record again. This deliberate review step prevents unintended uploads and supports retry. An optional Save immediately preference can come later; do not make it the default in the first revision.

Keep the recording draft until the server acknowledges its saved audio path. Upload failure leaves the same draft playable with Retry save and Download recording. Closing the panel while recording is not equivalent to discard: show Keep recording and Stop and review. Navigating away with an unsaved draft uses the browser's supported loss-warning behavior; do not promise draft persistence beyond the tab until an IndexedDB implementation exists.

On teardown, stop microphone tracks and visualization resources. Teardown must not trigger an unintended upload through a recorder stop callback. Separate the user intent to Save, Stop, and Discard from the recorder's lifecycle event.

Microphone failures distinguish permission denied, unavailable input, unsupported browser capability, and insecure context when detectable. Use an explanation and relevant action, not one generic permission message for every error. Offer Import audio in each case.

After a successful save, show Recording saved · Waiting to transcribe with Open entry or View activity. The server acknowledgment means audio was saved, not that transcription is finished. If no sidecar exists yet, Open entry shows a pending reader backed by the processing item: playable saved audio, its current stage, and Transcript not ready yet. Do not issue a doomed sidecar hydration request. Reconcile that temporary processing key with the resulting entry identity when transcription arrives, keeping the reader and playback position. Do not clear the user's current search or automatically replace their reader with the new recording.

### Import

Import opens a native multiple-file picker. A window-wide file drag displays a temporary drop target without shifting the layout; ordinary text dragging never activates it. The explicit Import button supports people who cannot drag.

Show the supported input formats and configured maximum size before submission. Derive them from server capabilities rather than hardcoding a second format list. Current multipart requests accept one file and enforce 80 × 1024 × 1024 bytes; display that as 80 MiB until the limit changes.

Show a per-file row with name, size, state, and Retry/Remove when applicable. States are Preparing, Uploading, Saved, and Failed; transcription states appear separately after Saved. Limit uploads to two concurrent requests and keep transcription at the configured backend concurrency.

Validate obvious unsupported files and oversize files before upload. A wrong extension is not the sole proof that audio is unreadable; the server validates the content. Individual failures never abort or erase the remaining batch. Upload progress uses real transferred bytes; if the implementation has only fetch completion, use Uploading without a fictional percentage.

Do not silently rename or timestamp every user-supplied label in the UI. Preserve the original import filename as metadata and use the readable title rules from section 6. Duplicate detection requires backend support: return an existing-entry match or a conflict choice; never silently overwrite. Content hashing/idempotency is a P2 enhancement, but an upload acknowledgment must already include the saved path.

## 9 Processing and Activity

### Entry processing states

Model pipeline state independently from organization, cleanup output, and MayDo extraction. Holding is an organization issue; Done is a MayDo decision. Neither should masquerade as a transcription stage.

| Stage | Visible copy | Available action |
| --- | --- | --- |
| waiting_for_file | Waiting for file to finish syncing | Details; Process now only when the file is currently stable |
| queued_transcription | Waiting to transcribe | View activity |
| transcribing | Transcribing | View activity |
| queued_cleanup | Transcript ready · Waiting to clean | Read original |
| cleaning | Cleaning transcript and extracting MayDos | Read original |
| ready | Ready | Open transcript |
| raw_only | Original transcript ready | Read original; Configure cleanup if unavailable |
| failed_transcription | Could not transcribe audio | Retry transcription; Details |
| failed_cleanup | Transcript ready · Cleanup failed | Read original; Retry cleanup |
| failed_maydos | Transcript ready · MayDo extraction failed | Read transcript; Retry MayDos |
| interrupted | Processing interrupted | Resume/retry appropriate stage |

A file-sync wait includes its current eligibleAt time or countdown based on the existing settle rule. If the file changes, update the waiting deadline. Process now bypasses the long settle delay only; it must not process a file actively being written. Keep the existing default sync settling policy until the user changes it deliberately.

Show queued position only if the server knows the ordering. Transcription and cleanup stage percentages are indeterminate unless the worker supplies real progress. Ready transcript content remains readable while reprocessing; replacing a successful output requires a successful replacement operation.

### Activity drawer

The Activity button displays a dot for work in progress and a numeric badge for failures needing action. A healthy idle app needs no three-pill Whisper/ollanet/GPU status strip. Activity contains:

1. Running work, grouped by stage, with the current entry and queue counts.
2. Bulk jobs, with their scope, progress, Stop after current, and final outcome.
3. Needs attention, with one precise recovery action per failure.
4. Recent completed work, collapsed after the latest five items.
5. Expandable System status and Diagnostics with model/device/host details.

Activity is accessible during recording and reading. Clicking a work item opens its entry without clearing filters. A background failure affects its entry badge and Activity; use a global banner only for loss of API connectivity or a failure blocking the action being attempted.

Retry transcription, Retry cleanup, Extract MayDos, and Re-extract MayDos are distinct labels and operations. A single generic Retry button must not cause an expensive transcription when only cleanup failed. Active tasks are deduplicated per entry and stage; repeated clicks join or acknowledge the existing task.

Connection loss preserves loaded transcripts and selection. Show Connection lost · Reconnecting; disable writes that cannot be acknowledged. Retry reconnect automatically with bounded backoff. On recovery, fetch one authoritative snapshot and reconcile by identity. Do not emit success notifications for writes whose outcome is unknown; reread the entry/job before deciding whether to retry.

Worker status and queue counts use server events, with polling as fallback. Poll only the data needed for the visible surface; a drawer's open state should not create a separate full health probe every four seconds. A cached health report can be refreshed deliberately through Run checks.

## 10 Organization and maintenance

### Stars and tags

Star is a one-action reversible toggle with immediate visual response, pending state, acknowledgment, and rollback on failure. It is accessible from a card and reader. Filtering Starred never creates an extra group above normal search results.

The Tags tab has existing tags, a single Add tag field, suggestions from the indexed tag list, and an explicit remove control. Enter adds; Escape dismisses suggestions. Trim whitespace and deduplicate case-insensitively while preserving the chosen display spelling. Adding a tag clears the field only after acknowledgment; failed input remains available to retry.

Tag removal offers Undo. Applying a tag filter is a different action from editing that tag; label the filter affordance Filter entries by this tag. Do not make every editable tag chip secretly perform a navigation operation.

### Holding and unfiled

Needs attention has subfilters Duplicate file, Unfiled, Processing failed, and Unreadable audio. These are understandable labels; expose physical holding/unfiled paths in Details and preserve legacy links.

A holding entry displays both conflicting filenames, dates, sizes, and transcript previews when available. Default action: Keep both. Secondary actions: Keep existing, Replace existing, and Leave unresolved. Replace existing requires a specific confirmation and a recoverable backup of the replaced entry. Do not label replacement File or hide the conflict behind a generic confirmation.

Unfiled entries remain readable/searchable. Provide Assign recording date, then preview the proposed destination before moving audio and sidecar together. An inferred date is visibly marked Estimated until confirmed. Date corrections must update the index and any currently selected entry identity atomically; never lose the reader through a file move.

Existing date parsers and organization code remain the implementation authority. This spec does not require inventing another folder layout or automatically moving the entire archive.

### Trash and restore

Replace the irreversible socket deletion flow with an acknowledged Move to Trash command. Move the audio, sidecar, and related original/clean variants as one entry bundle. Store a manifest recording original paths, deletion time, and an opaque trash ID. Exclude the trash folder from watchers, normal indexing, cleanup, and backfill.

After acknowledgment, remove the card and show Entry moved to Trash · Undo for 8 seconds. The reader closes to its preserved list position. Undo restores the bundle through the server, not through a client-only list update. If removal fails, the card remains present with a retryable error.

Trash is accessible through Settings/Data. Restore checks destination conflicts and offers Keep both; it never silently overwrites an existing file. Permanent deletion and Empty Trash require an explicit confirmation naming both audio and transcript data. Retention is manual in the first release; automatic expiration is a separate user-selected preference.

Required backend sequence: validate paths, build bundle manifest, reserve destination, move files, update index, acknowledge. A failed move rolls back already moved files where possible and returns the specific remaining state. Confirm that the backup is recoverable before treating replacement or removal as complete.

### Bulk maintenance

Settings/Maintenance contains MayDo extraction, cleanup retry, tag consolidation, audio scan, and search-index rebuild. Each tool shows scope, likely data changes, current job state, and outcome. Normal reading remains available during work.

Tag consolidation preserves the existing preview/apply split. Show Keep tag, Tags being merged, and affected entry count. Model suggestions are proposals, not automatically selected edits without a visible preview. Apply only reviewed groups. Add recoverable batch provenance before advertising Undo; otherwise state exactly that the merge changes tags and requires confirmation.

Audio scan defaults to checking files. Mark unreadable is a separate reviewed action with the detected files and reasons. Marking never means deleting audio. An index rebuild changes the derived search cache and does not require retranscription or cleanup. Stop and retry semantics are defined per job; do not offer Cancel if a worker cannot cancel safely.

## 11 Settings and first use

### Settings structure

| Section | Contents |
| --- | --- |
| General | Density, sidebar preference, date display, playback speed, accessibility preferences |
| Folders | Watched folders, browser import destination, sync settle duration, folder readiness |
| Transcription | Python interpreter, model, device, compute type, vocabulary hints, preprocessing |
| Cleanup and MayDos | Host, model, enabled/optional state, connection test, extraction behavior |
| Search | Words/meaning availability, embedding model/host, index coverage, rebuild |
| Data and maintenance | Trash, tag consolidation, audio checks, batch processing |
| Integrations | Read-only MCP configuration; future ExoMetaCortex status when implemented |
| About | Version, configured endpoints, release/docs links, diagnostic report |

First deliver a read-only settings view populated from the effective config and current health report. Show the loaded configuration file and relevant command instructions under Advanced. Do not present editable fields that cannot actually be saved.

Editable settings are a separate P2 ticket. Validate changes on the server, preserve unknown/unmodified existing values, write atomically, and return saved/applied/restart-required results. Provide one Save changes button per section and a persistent unsaved state; changing a folder or model must not save on every keystroke.

Network exposure, Tailscale, cleanup destinations, and embedding destinations show the actual destination and which data is sent. Existing local-only defaults remain. Applying an exposure change or switching a processing destination is an explicit configuration action. Do not automatically expose the journal to fix a microphone, discovery, or integration issue.

### First use

First run branches according to usable data and capabilities:

- Existing indexed entries: open Library immediately, even if optional cleanup or GPU processing is unavailable.
- Empty library with a ready transcription worker: show Import audio and Record, plus optional Set up a watched folder.
- Empty library with an unavailable worker: show a short setup checklist and Import/Record availability accurately. Saved audio can wait to process if that capability is supported.
- API unavailable: show connection recovery; do not mislabel it No entries yet.

Guided setup uses three required decisions at most: where audio arrives, which local transcription runtime is available, and whether optional cleanup is enabled. Vocabulary hints, embedding choices, compute type, preprocessing, and remote access stay advanced. Keep using doctor for the substantive environment checks.

A setup step is complete only when its capability check passes or the user explicitly selects a supported deferred state. Show one specific action for Python missing, model unavailable, missing folder, cleanup host unreachable, and port collision. Explain slow CPU processing where selected without requiring a GPU.

### CLI and startup

Keep checkout and packaged usage separate and accurate. CLI help and startup output should show:

1. Loaded config path and whether the inbox is served.
2. Exact usable UI URL and API URL for this run.
3. Ready, Starting, or Blocked status with the blocking reason.
4. One next action, not a dump of every internal check.

Doctor groups Required for transcription, Optional cleanup, and Search readiness. A missing optional component is a warning and does not make an existing journal unreadable. Include machine-readable output as a P2 enhancement for future automation, while retaining clear text output and exit codes.

## 12 Help and integration experience

Help opens with Find an entry, Read and listen, Record/import, Review MayDos, Resolve a failure, and Set up DictaWhisper. Each task has short steps and a link that opens the relevant existing surface. Provide Keyboard shortcuts and Troubleshooting as explicit sections.

Place guidance next to the action it explains: source quote under a MayDo; sync wait next to waiting audio; disabled model explanation next to extraction. A tooltip is supplemental and never the only explanation of a disabled action.

Use one vocabulary consistently:

| Current or ambiguous wording | Product wording |
| --- | --- |
| Focus | Starred, when referring to saved stars |
| Cleaned / Raw | Readable / Original in the reader |
| FTS / vec / hybrid | Words / Words and meaning in normal controls |
| Probe | Check audio files |
| Consolidate | Merge similar tags |
| Process | Name the operation: Transcribe, Clean transcript, or Extract MayDos |
| File as copy | Keep both, in a conflict-resolution context |
| Unreadable | Audio could not be read, with the actual reason in Details |
| Sidecar | Entry JSON in export UI; sidecar remains valid in developer docs |

Integrations retain the current read-only MCP behavior. Add a Settings/Integrations card with copyable configuration, the resolved absolute runtime path appropriate to the installation, and a connection check when a client supports it. Copy reports success/failure. Do not claim MCP can manage entries or MayDos until those writes exist.

ExoMetaCortex preparation is P2 and must be specified before synchronization is built. Add stable entry/action identities and versioned exports first. A future integration must declare direction, conflict ownership, deletion behavior, and whether Selected means send. Selected alone does not authorize transmitting an action elsewhere. Do not add a nonfunctional Connect button.

The docs site should mirror task vocabulary and include current MayDo/search/trash/settings contracts as they ship. Updating product instructions is in scope; a marketing-site redesign is not a prerequisite for these UX changes.

## 13 Accessibility and visual behavior

Density should come from removing repeated controls and unused space, not from shrinking all text and targets. Maintain at least 16-pixel transcript text, approximately 1.55 line height, and scalable browser text.

Use 32-by-32 minimum app icon-button boxes on desktop and 44-by-44 on touch layouts. These are design targets. WCAG 2.2 AA target sizing sets a 24-by-24 CSS-pixel minimum with defined spacing and other exceptions; the larger app targets reduce precision demands. [W3C target size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)

Keyboard focus is visible and kept clear of sticky controls, dialogs, and banners. Drawers trap focus while open, make the underlying workspace inert, close through Escape and a labeled Close button, and restore focus to their invoking control. Nonmodal popovers use their appropriate keyboard pattern instead of a modal focus trap. [W3C focus visibility guidance](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html)

Use native elements or the documented ARIA pattern matching the actual interaction. Cards are selectable items with distinct action buttons; avoid an ARIA grid unless grid keyboard behavior is implemented. Reader tabs have a selected state and an associated panel. Status announcements are polite and do not repeat the full result count on every keystroke.

Target WCAG 2.2 AA contrast, keyboard use, reflow, and text resizing. Normal text needs 4.5:1 contrast; large text has the specified 3:1 threshold; important UI boundaries/state indicators need applicable 3:1 contrast. Check actual computed colors against the composed dark background rather than assuming zinc text is readable. [WCAG 2.2](https://www.w3.org/TR/WCAG22/)

Keyboard scope rules:

| Key | Scope | Behavior |
| --- | --- | --- |
| / | Workspace, outside an editable field | Focus library search |
| Escape | Open drawer/popover first | Close topmost overlay; otherwise close reader only when focus is inside it and no edit is pending |
| Enter | Focused entry selection control | Open focused entry |
| Up/Down | Focused entry list navigation | Move focus among entries without automatically playing/opening |
| Home/End | Focused entry list navigation | Move to loaded boundary; offer loading next page rather than guessing unloaded content |
| Tab / Shift+Tab | Everywhere | Normal movement across controls and content regions |
| Left/Right | Focused reader tabs | Move tab focus; Enter/Space activates when using manual activation |
| Space | Focused Play/Pause button | Play/Pause; do not override page scrolling globally |
| ? | Workspace, outside an editable field | Open shortcut help |

Respect reduced motion. Avoid moving cards on hover, pulsing selection indefinitely, or using animated gradients to communicate processing. Loading skeletons stop or simplify animation with reduced motion. Every hover-only action appears on focus and touch, and every drag action has a button equivalent.

Progressive disclosure keeps optional capabilities behind labeled controls; discoverability comes from names, counts, disabled-state explanations, and contextual help rather than rendering every control at once. [Nielsen Norman Group progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/)

Reversible everyday actions and explicit exits support user control. Confirmation is reserved for permanent removal, replacement, or reviewed bulk changes that cannot be recovered through the normal product flow. [Nielsen Norman Group user control and freedom](https://www.nngroup.com/articles/user-control-and-freedom/)

## 14 Loading and recovery contracts

| Situation | Required presentation | Required preservation |
| --- | --- | --- |
| Initial library loading | Compact skeletons and Loading entries | Restored query/selection intent |
| Query/filter update | Prior results plus Searching | Reader, draft edits, focus |
| Entry hydration | Reader skeleton in its existing pane | List anchor and previous entry cached separately |
| Entry cannot load | Could not open entry; Retry and Back | Search/filter/list position |
| No library entries | Record/Import and optional folder setup | App navigation and settings access |
| No filtered entries | Named scope and Clear search/Clear filters | User query and reader outside-results state |
| Cleanup unavailable | Original transcript; configure/retry option | Raw speech and saved MayDos |
| Audio missing | Audio unavailable; Details | Reading/copying/exported text |
| Copy denied | Could not copy; Select text | Current reader position |
| Save rejected | Inline error with Retry; original value restored | Typed draft and other entry fields |
| Bulk failure | Failed item count and Retry failed entries | Completed results and human decisions |
| API disconnected | Connection indicator and reconnect action | Loaded journal; no false empty state |
| Server restart mid-job | Interrupted job with Resume | Saved entry outputs and remaining scope |
| Entry moved externally | Reconcile identity if known; otherwise Entry moved or unavailable | Reader content until explicit refresh/dismiss |

Success feedback is small and local. Use a short toast or inline status for Copy, Star, Tag, and MayDo edits. Running jobs have persistent Activity state. Do not put a transient success message above the transcript that expands the header.

## 15 Data and API changes

### Compatibility rules

Audio and sidecar files remain the source of truth for journal content. SQLite remains a derived index. Existing sidecars must load without new fields. Additive schema changes use explicit versions where the data has migration implications. Reprocessing must reread current human edits before saving outputs.

Legacy query keys q, tag, year, month, since, until, sort, mode, unreadable, starred, file, and mayDos remain readable. New keys must be validated and written only when nondefault. Repeated status filters can use mayDoStatus; parse the old single mayDos status into the equivalent set.

### Proposed types

The exact names below are the implementation contract unless reviewed and changed in this document. They are additions, not existing fields to assume are present.

~~~ts
// Optional additive sidecar fields. Use current tags/starred/MayDo types unchanged.
type EntryIdentity = {
  entryId?: string;                 // UUID; backfilled explicitly, never regenerated on move
  displayTitle?: string;            // human supplied; does not rename audio
  recordedAt?: string;              // ISO instant only when timezone is known
  recordedDate?: string;            // YYYY-MM-DD or YYYY-MM; source calendar precision
  recordedLocalTime?: string;       // HH:mm:ss when filename has time but no timezone
  recordedAtSource?: 'filename' | 'folder' | 'metadata' | 'fileTime' | 'user';
  audioDurationSeconds?: number;    // actual audio, never processing elapsed
  originalFilename?: string;
};

type ProcessingStage =
  | 'waiting_for_file' | 'queued_transcription' | 'transcribing'
  | 'queued_cleanup' | 'cleaning' | 'ready' | 'raw_only'
  | 'failed_transcription' | 'failed_cleanup' | 'failed_maydos'
  | 'interrupted';

type ProcessingItem = {
  id: string;
  entryId?: string;
  jsonFile?: string;                // pending audio may not have a sidecar yet
  audioFile: string;
  stage: ProcessingStage;
  startedAt?: string;
  eligibleAt?: string;
  queuePosition?: number;
  error?: { code: string; message: string; retryStage?: string };
};

type EntrySummaryAdditions = {
  entryId?: string;
  displayTitle?: string;
  recordedAt?: string;
  recordedDate?: string;
  recordedLocalTime?: string;
  recordedAtSource?: EntryIdentity['recordedAtSource'];
  audioDurationSeconds?: number;
  mayDoActiveCount: number;          // suggested + selected
  mayDoTotalCount: number;           // all statuses
  mayDoStatusCounts: Record<'suggested' | 'selected' | 'done' | 'dismissed', number>;
};

type EntryPage<T> = {
  items: T[];
  total?: number;                   // present only when its meaning is supported
  countKind: 'exact' | 'ranked' | 'unknown';
  hasMore: boolean;
  nextCursor?: string;
  candidateLimit?: number;
};

type BatchJobSummary = {
  id: string;
  type: 'maydos' | 'cleanup' | 'audioCheck' | 'tagMerge' | 'reindex';
  state: 'queued' | 'running' | 'stopping' | 'completed' | 'stopped' | 'interrupted';
  scope: { year?: string; files?: string[]; refresh?: boolean };
  total: number;
  processed: number;
  updated: number;
  failed: number;
  skipped: number;                 // retain the legacy total
  skipReasons: { current: number; noTranscript: number; unreadable: number };
  startedAt: string;
  finishedAt?: string;
  currentEntry?: string;
};
~~~

P0 layout work must not wait for entryId backfill. Until entryId exists, use the validated resolved sidecar path as the entry key. Stable IDs become required before Trash, arbitrary organization moves, or ExoMetaCortex synchronization depend on persistent cross-path references.

### Existing operations and required extensions

| Contract | Existing use | Proposed extension or new contract |
| --- | --- | --- |
| GET /notes/index | Browse summaries | Cursor, limit, accurate total semantics, title/duration/provenance/action counts |
| GET /notes/search | Capped hits | Stable pagination, countKind, multi-status MayDo filtering, sort before slicing |
| GET /note and POST /note | Hydrate, tags, star, action status | Display title and validated atomic edits; preserve unrelated fields |
| GET /audio | Stream audio | Preserve range/seek support; metadata-backed duration |
| POST /audio | Save upload and return file | Capability-driven limits; return stable acknowledgment and processing item reference |
| GET /health and GET /status | Doctor/queue/count reports | Keep compatibility; capability and action-specific readiness summary |
| GET /activity | New | Processing snapshot and recent job summaries |
| Socket activity-update | New | Incremental stage/job change with revision; reload snapshot after reconnect |
| GET /capabilities | New | Supported formats, maxUploadBytes, configured optional capabilities |
| GET /settings | New | Effective readable settings with config path; redact credentials if present |
| POST /settings | New in P2 | Validated section update; applied and restartRequired response |
| POST /entries/trash | New | Validated entry bundle removal; return trash ID and Undo capability |
| POST /entries/restore | New | Restore by trash ID with conflict handling |
| GET /entries/trash | New | Recoverable entries and deletion dates |
| POST /entries/purge | New | Permanent deletion after the product's explicit confirmation |
| POST /holding/resolve | Existing | Retain legacy action parsing; new UI names and backup/acknowledgment semantics |
| /tools/may-dos/backfill | Existing GET/POST | Persisted job ID/state, skip reasons, resume and retry-failures intent |
| /transcribe/force and /process/force | Existing | Acknowledge or join deduplicated task; preserve stage-specific errors |
| /tags/consolidate/preview and /apply | Existing | Retain preview; add affected-entry counts and batch provenance |

All file operations continue using the existing allowed-path checks. New APIs share existing error formatting and return operation outcomes, not just HTTP success. File bundles must never depend on the client guessing related paths.

Do not introduce an external database, a new frontend framework, a cloud search service, or an ExoMetaCortex dependency to implement this pass. New browser preferences are versioned and limited to presentation choices; do not store transcript bodies in localStorage.

## 16 Implementation packets

Execute these packets sequentially within each dependency chain. A smaller model should implement one packet, run its checks, and stop with a reviewable diff before starting another. Use the current repository instructions and existing Svelte/SCSS conventions. Avoid a simultaneous rewrite of the full application.

### Delivery progress

Last updated: 2026-10-06. Core implementation is delivered through **UX08 Settings/help/maintenance**. UX01 and UX03–UX08 are Verified. UX02 remains Needs review for physical touch and actual 200% browser zoom (UX02-V01). Next: manual A32 review, then separately review any UX08b/UX09 extension before activating it.

This tracker is the status authority. Update it and the dated execution notes as part of each packet; do not maintain conflicting status copies elsewhere in the document.

| Status | Meaning |
| --- | --- |
| Not started | No work under this packet has begun; a scheduled prerequisite can still be pending |
| In progress | Work has begun; the definition of done is not yet met |
| Needs review | A reviewable result exists; verification and remaining limits are recorded |
| Verified | Required acceptance and checks passed; residual nonblocking issues are explicit |
| Blocked | A specific issue prevents the next necessary action; record the cause and next action |
| Deferred | Deliberately outside the current wave; record its activation condition |

#### Phase status and notes

| Phase | Packets | Status | Notes / next milestone | Issues |
| --- | --- | --- | --- | --- |
| PH01 Library and reading foundation | UX01–UX04 | In progress | UX01, UX03, and UX04 Verified (3 of 4 packets); UX02 Needs review (manual A32 checks remain). Next: manual UX02 A32 review. Global/exact paging, ranked snapshots, refresh and reader continuity verified; preserve keyed-height and identity anchors. | UX02-V01: physical touch and actual 200% browser zoom review remain; no implementation blocker recorded |
| PH02 Capture and action processing | UX05–UX06 | Verified | UX05 and UX06 Verified (2 of 2 packets). Acknowledged capture, pending readers, durable Activity, grouped MayDo review, reversible status changes, and persisted resumable backfill delivered. No further PH02 packet remains. | No implementation blocker; real hardware/model throughput not claimed by fixture verification |
| PH03 Organization, recovery, and support | UX07–UX08 | Verified | Both packets delivered: acknowledged bundle Trash/restore, identity/date/conflict organization, read-only effective Settings, task Help, reviewed maintenance, and accurate startup diagnostics. | Recovery retains ambiguous copies; ordinary organization moves are not claimed power-loss atomic. See packet evidence. |
| PH04 Optional enhancements | UX08b, UX09 | Deferred | Activate each bounded enhancement after the daily workflows are stable and its product/data agreement is specified. | None recorded |

#### Packet status and notes

| Packet | Status | Prerequisites | Notes / next action | Issues | Verification |
| --- | --- | --- | --- | --- | --- |
| [UX01 Workspace state](#ux01-workspace-state-and-navigation) | Verified | None | Canonical views, independent selection/cache, status OR, date precedence, history/focus, session reader state, and identity anchors implemented. Next: UX02. | No open UX01 issues; later packet boundaries are explicit in evidence | 117 tests; typecheck; runtime/client builds; isolated browser cases. [Evidence](UX01_VERIFICATION.md) |
| [UX02 Geometry](#ux02-shell-and-reader-geometry) | Needs review | UX01 | Implemented 1920px shell, 200/360px desktop panes, 320px intermediate list, navigation drawer, single flat reader, width-aware measurements, and compact cards. First passage y199 with a two-line title and 22 tags. | UX02-V01: actual 200% zoom and physical touch | 117 tests; typecheck; runtime/client builds; five viewport browser checks, deep anchor, focus, edit, and reflow. [Evidence](UX02_VERIFICATION.md) |
| [UX03 Reader and presentation](#ux03-entry-identity-display-and-reader-actions) | Verified | UX02 | Readable/editable titles, title search, Original fallback, separate text/play, copy feedback, persistent player/speed/follow, local Find, More, and human-edit preservation implemented. Next: UX04. | Recoverable Trash stays in UX07; real recorder-start playback pause joins UX05 capture checks | 125 tests; typecheck; runtime/client builds; isolated browser A14–A18 and reader focus/keyboard checks. [Evidence](UX03_VERIFICATION.md) |
| [UX04 Search and pagination](#ux04-query-continuity-and-pagination) | Verified | UX01 | Global SQL paging/counts, authenticated scope-bound cursors, bounded ranked snapshots, Load more, cross-page Next, expired refresh and saved-page restoration implemented. Next: UX05. | Large real-corpus semantic performance and live embedding-host inference are not claimed; UX02-V01 remains separate | 131 tests; typecheck; runtime/client builds; actual MCP client; isolated A06/A10/A11 and paging/keyboard/mobile checks. [Evidence](UX04_VERIFICATION.md) |
| [UX05 Capture and Activity](#ux05-capture-and-processing-visibility) | Verified | UX01 | Retained drafts, per-file imports, Saved receipts, pending audio reader, actual stages/deadlines, durable Interrupted recovery, reconnect and on-demand diagnostics implemented. Next: UX06. | No implementation blocker; physical mic and live inference not exercised | 143 tests; typecheck; runtime/client builds; isolated A21–A27 and A31 browser checks. [Evidence](UX05_VERIFICATION.md) |
| [UX06 MayDo review/backfill](#ux06-maydo-review-and-resilient-backfill) | Verified | UX01, UX03, UX05 | Shared counts, grouped action review, per-action saves and conditional Undo, source disclosure, stale/disabled recovery, and durable scoped backfill with explicit Resume/Retry failed implemented. Next: UX07. | No implementation blocker; live model quality/throughput not exercised | 150 tests; typecheck; runtime/client builds; isolated A08/A19/A20/A31 checks. [Evidence](UX06_VERIFICATION.md) |
| [UX07 Recovery and organization](#ux07-organization-and-recoverable-removal) | Verified | UX05 | Additive IDs, verified whole-bundle moves, durable Trash receipts, server-backed Undo/restore, collision previews with Keep both, date provenance, transactional index reconciliation, and conditional tag Undo delivered. | No implementation blocker; runtime rollback and retained recovery copies do not imply power-loss atomic ordinary moves. | 164 tests; typecheck; runtime/client builds; isolated A28/A29/A33 browser and fault tests. [Evidence](UX07_VERIFICATION.md) |
| [UX08 Settings/help/maintenance](#ux08-settings-help-and-maintenance) | Verified | UX05, UX06; UX07 for Trash UI | Effective read-only Settings, task Help, explicit diagnostics, reviewed maintenance, Activity links, source/compiled startup readiness, and HTTP/MCP documentation delivered. | Settings writes remain UX08b; ExoMetaCortex remains planned. Live hardware/model throughput is not fixture evidence. | 164 tests; typecheck; runtime/client builds; isolated A26/A31/A34/A35 checks. [Evidence](UX08_VERIFICATION.md) |
| UX08b Editable settings | Deferred | UX08 | Separate P2 extension; activate with server validation, atomic writes, and saved/applied/restart evidence | None recorded | Not run |
| [UX09 Enhancements](#ux09-enhancement-queue) | Deferred | Relevant core packets; per-feature agreement | Split into named bounded subpackets when selected; do not treat the queue as one undifferentiated implementation task | None recorded | Not run |

#### Verification ownership

The owner below verifies the named cases before marking its packet Verified. Shared cases must be rerun where later work changes their behavior. A30 belongs to UX08b; it is not a prerequisite of read-only UX08.

| Packet | Acceptance ownership |
| --- | --- |
| UX01 | A01, A07, A08, A09, A12, A13, A33; state/focus portions of A31 |
| UX02 | A02, A03, A04, A05, A32; rendered pane/focus portions of A31 |
| UX03 | A14, A15, A16, A17, A18; reader controls in A31 and presentation compatibility in A33 |
| UX04 | A06, A10, A11; query-path regression checks for A07–A09 and A35 |
| UX05 | A21–A27; capture/Activity controls in A31 |
| UX06 | A19, A20; action-status regressions for A08 and MayDo controls in A31 |
| UX07 | A28, A29; identity/move compatibility in A33 |
| UX08 | A26, A34, A35; settings/help/maintenance controls in A31 |
| UX08b | A30; settings-edit controls in A31 |
| UX09 | Add scenario IDs per selected enhancement before implementation |

#### Execution notes

- **2026-10-05 · All phases:** Created the proposed whole-app spec and initialized delivery tracking. All new core packets are Not started; enhancements are Deferred. Existing implementation and earlier checks have not been credited as completion of these packets.
- **2026-10-05 · PH01 / UX02:** The conversation preview uses sample content. Its script syntax and document structure were checked; rendered browser verification did not run because local-file navigation was blocked. Keep the preview illustrative and validate actual geometry during UX02. See DOC01.

Add dated entries as work proceeds, naming the phase/packet, concrete change or decision, check commands/manual cases and outcomes, evidence paths or commits, remaining work, and next action. Do not overwrite an earlier failure without recording the fix and new evidence.

- **2026-10-05 · PH01 / UX01:** Began implementation on user approval. Separating selection/cache/session state from results and adding canonical views, filter contracts, and history/focus restoration. Existing UI work and the pre-existing lockfile change are preserved. Acceptance checks are pending.

- **2026-10-05 · PH01 / UX01:** Completed and verified A01/A07/A08/A09/A12/A13/A33 and the state/focus portions of A31. Added an isolated 202-entry browser fixture. Fixed pointer-focus loss, pre-metadata audio position overwrite, and stale tab snapshots during checks. Direct deep-grid selection retained its anchor within about 1 pixel; clearing search restored the same entry and offset within 1 pixel. Final checks: 117 tests passed, typecheck and both builds passed, no browser runtime errors, and history replay generated no writes. [Detailed evidence and remaining boundaries](UX01_VERIFICATION.md). PH01 remains In progress; UX02 is next.

- **2026-10-05 · PH01 / UX02:** Implemented the three pane components and responsive geometry. Browser checks passed at 390/768/1024/1440/1920px; first passage y199, chrome about 138px, deep selection anchor moved 0.06px, adjacent gaps 8px, starring caused no jump, and Passage 27 survived desktop/mobile reflow within 0.25px. Drawer Escape and Back restore focus. DOC01 closed. Status Needs review because actual 200% browser zoom and physical touch are unrun (UX02-V01). [Evidence](UX02_VERIFICATION.md).

- **2026-10-05 · PH01 / UX03:** Completed and Verified. Added title presentation/sidecar editing and cache/FTS schema 4, Original fallback and selectable passages, copy/play failures, speed/Follow/local Find, sticky native player, More, and human-edit preservation during model output. Fixed scroll-event playback pausing and mobile menu overflow during browser verification. First long-title passage y203; 125 tests, typecheck, both builds passed. A real denied clipboard showed its fallback after waiting for async completion. Existing permanent deletion is clearly labeled; recoverable Trash remains UX07. Recorder-start hardware check joins UX05. [Evidence](UX03_VERIFICATION.md). Next: UX04; UX02-V01 remains open.

- **2026-10-05 · PH01 / UX04:** Completed and Verified. Replaced capped/client browse results with opt-in EntryPage, exact global SQL paging/counts and bounded 60-second ranked snapshots. Added authenticated scope-bound cursors, continuation without model calls, persistent Load more, cross-page Next, refresh preserving the reader, and restoration of saved page positions. Fixed the mobile reader refresh target during verification. 131 tests, typecheck and both builds passed; a real MCP client exercised search/get/recent/tags. Browser: all 199 word matches reached, list anchors preserved at 6415.33px and 13454px, delayed query rejected, expiry recovered, five widths checked. [Evidence](UX04_VERIFICATION.md). Next: UX05; UX02-V01 remains open.

#### Issues and decisions needing follow-up

| ID | Phase / packet | Type / effect | State | Next action / resolution |
| --- | --- | --- | --- | --- |
| DOC01 | PH01 / UX02 | Illustrative preview had no rendered-browser proof | Closed | Implemented app checked in an isolated 202-entry fixture; geometry evidence replaces the illustrative preview. See UX02_VERIFICATION.md. |
| UX02-V01 | PH01 / UX02 | Actual browser 200% zoom and physical touch could not be exercised through the available browser controls | Open | Run the manual A32 checks in UX02_VERIFICATION.md. Zoom-equivalent 720×450 reflow, 44px reader/header controls on mobile, and five viewport cases passed. |

New issues use stable IDs. Record affected packets, user effect/severity, reproduction or evidence, and the next action. Preserve resolved issues with their resolution. A proposed backend extension is scoped work, not automatically a blocker. None recorded is not a claim that a packet is defect-free.

On packet start, set In progress. At handoff, use Needs review if required checks remain, or Verified when the definition of done is supported. A phase becomes Verified only when its required packets are Verified; otherwise preserve its partial state and open issues. Update this section's date and next packet after each substantive handoff.

### UX01 Workspace state and navigation

Priority P0. Include the small server filter extension needed for multiple MayDo statuses; pagination is not a prerequisite.

Primary files: client/src/lib/components/Transcriptions.svelte, client/src/lib/inboxUrl.js, src/lib/inboxUrl.ts, src/lib/mayDoLib.ts, src/lib/journalIndexLib.ts, src/apiRoutes.ts, and test/inboxUrl.test.ts. Add client/src/lib/workspaceState.js for normalized state and history/anchor helpers if it reduces the current component's responsibilities.

Tasks:

1. Implement the named views and legacy URL mapping in sections 3 to 5. Keep query parsing/writing consistent in the client and runtime helpers.
2. Separate selected entry from summary arrays; replace the expanded-object convention with an explicit selected entry key while accepting the old URL file key.
3. Define scope defaults in one helper used by navigation and query requests. Date/custom-range mutual exclusion and MayDo OR filtering must be deliberate functions, not scattered reactive assignments. Extend server filtering to accept a validated status set while preserving the old single-status parameter; do not simulate OR by filtering a capped client result set.
4. Implement history, focus restoration, and session snapshots. Cache an anchor as entry key plus within-row offset for each query/filter/sort state.
5. Add per-entry reader state and outside-current-results behavior. Late hydration may update the cache but cannot replace the currently selected entry.

Done when: URL refresh/back/forward, legacy links, outside-results selection, and rapid selection tests pass without replaying writes or playback.

### UX02 Shell and reader geometry

Priority P0. Depends on UX01.

Primary files: client/src/app.scss, AppHeader.svelte, Transcriptions.svelte, NoteList.svelte, VirtualList.svelte, and NoteCard.svelte. Add LibraryRail.svelte, EntryListPane.svelte, and EntryReader.svelte so layout changes do not require one enormous component to own every flow.

Tasks:

1. Apply the exact breakpoints, width budgets, gaps, and independent scroll containers from section 3.
2. Move the search header into EntryListPane when selection is present. Keep one reader heading, not an outer Entry detail title plus inner title card.
3. Preserve cards before selection and compact cards beside the reader. Retain keyed height measurements; include width/column layout context when necessary so cached heights from a different layout are refreshed correctly.
4. Keep the selected entry's list anchor during column changes and hydration. Avoid turning ordinary content updates into a list scroll-to-top.
5. Style the reader as one surface. Keep transcript text and controls large enough for reading; recover space by reducing redundant chrome.

Done when: all viewport acceptance cases pass and the first desktop transcript passage meets y≤220 at 1440 by 900.

### UX03 Entry identity display and reader actions

Priority P0, with additive metadata work in P1. Depends on UX02.

Primary files: NoteCard.svelte/EntryReader.svelte, client/src/lib/markPreview.js, src/types/transcription.ts, src/lib/transcriptionLib.ts, src/lib/journalIndexLib.ts, and src/lib/journalService.ts. Add client/src/lib/entryPresentation.js for readable title/date/duration rules.

Tasks:

1. Implement deterministic display title precedence and keep full filename/path under Details. Add displayTitle editing through POST /note; do not rename files.
2. Remove elapsed from ordinary date/duration display. Use actual audio metadata or omit duration until known.
3. Put Readable/Original and Copy full transcript before the transcript. Original is automatically visible when readable text is unavailable.
4. Separate transcript text from its play button, preserving cue timing and per-passage copy. Implement visible copy/play errors.
5. Add Previous/Next/Close and More with precise command names. Match tab keyboard behavior to actual semantics.
6. Preserve title/star/tags/action edits through cleanup and extraction; reread the current sidecar before writing model output.
7. Implement the player lifecycle, speed preference, Follow audio, matching-passage navigation, and basic Find in entry from section 6. Keep the player mounted across reader tabs and pause it on entry change; richer find features remain in UX09.

Done when: an existing sidecar with no new fields reads correctly, selecting text never plays audio, original-only notes are immediately readable, whole-copy success/failure is visible, and playback/find preserve the library query and reading context.

### UX04 Query continuity and pagination

Priority P0 for loading/count honesty; P1 for pagination. Depends on UX01. Pagination can proceed independently of geometry.

Primary files: Transcriptions.svelte/EntryListPane.svelte, src/lib/journalIndexLib.ts, src/lib/journalService.ts, src/apiRoutes.ts, and test/journalIndex.test.ts.

Tasks:

1. Keep prior results while loading and add request cancellation plus stale-response rejection.
2. Apply the UX01 scope contract consistently to filter-only, lexical, and hybrid requests, including date precedence, MayDo status OR, and tags AND semantics.
3. Immediately correct capped-result copy. Do not advertise a total from an array length.
4. Add filter-only/lexical pagination with deterministic global sort before slicing and stable cursor validation.
5. Add stable hybrid candidate snapshots with explicit ranked counts/caps/expiration. Never substitute full-corpus client filtering.
6. Maintain legacy notes/hits response shapes while new UI consumes EntryPage, or introduce an explicitly versioned endpoint. Existing HTTP and MCP callers must remain functional.
7. Add Load more and make reader Next cross page boundaries. Handle expired cursors without resetting the selected reader.

Done when: more than 50 matching entries are reachable, newest/oldest sorting is correct across pages, filters survive requests, and hybrid counts do not imply exhaustive totals.

### UX05 Capture and processing visibility

Priority P1. Depends on UX01 for contextual entry opening.

Primary files: AudioRecorder.svelte, AppHeader.svelte, src/apiRoutes.ts, src/lib/audioLib.ts, src/lib/transcriptionLib.ts, src/lib/fileSettleLib.ts, src/classes/Queue.ts, src/socketEvents.ts, and src/lib/healthLib.ts. Add ActivityDrawer.svelte and a small typed activity service under src/lib/.

Tasks:

1. Implement recorder state transitions with a retained draft and no teardown upload.
2. Add per-file import rows, server capabilities, two-request upload concurrency, and acknowledged Saved outcomes.
3. Instrument real pipeline stages and eligibleAt rather than inferring running work from missing cleaned text. Support the pending reader before a sidecar exists; reconcile it with the completed entry without losing selection.
4. Expose Activity snapshot and incremental updates; reconcile after reconnect and mark unfinished work Interrupted after restart.
5. Replace always-visible hardware/model pills with Activity plus expandable System status. Keep action-specific disabled reasons.
6. Deduplicate retries and distinguish cleanup from transcription. Make original transcripts available during cleanup.

Done when: permission denial, upload failure, mixed import batches, sync settling, model failure, disconnect/reconnect, and restart all preserve usable data and show the correct recovery action.

### UX06 MayDo review and resilient backfill

Priority P1. Depends on UX01/UX03 for views and UX05 for job display.

Primary files: EntryReader.svelte, src/lib/mayDoLib.ts, src/lib/mayDoService.ts, src/lib/mayDoBackfillLib.ts, src/types/transcription.ts, src/lib/journalIndexLib.ts, and test/mayDos.test.ts.

Tasks:

1. Compute active/total/status counts centrally and use them consistently in cards, tabs, view filters, and summaries.
2. Implement active-status defaults, grouped reader actions, source disclosure, and reversible status changes.
3. Preserve stable IDs and human decisions through re-extraction, including concurrent updates and omitted decided items.
4. Persist backfill job summaries and interruption state, split skip reasons, and add explicit Resume/Retry failed intents.
5. Keep unchanged-entry skipping and stop-after-current behavior. Manual extraction and backfill must join an in-flight operation for the same entry.

Done when: none/current/stale/error/disabled states are distinct and no re-extraction or restart loses a human-selected action or repeats a completed unchanged entry unnecessarily.

### UX07 Organization and recoverable removal

Priority P1. Depends on UX05; begin with additive stable entry identity support before implementing file operations. Do not change the Delete label to Trash before the backend is recoverable.

Primary files: src/socketEvents.ts, src/lib/organizationLib.ts, src/lib/audioLib.ts, src/lib/pathAllowLib.ts, src/lib/journalService.ts, src/apiRoutes.ts, and reader/Needs attention UI. Add a focused trash bundle service and migration/index support for optional entryId.

Tasks:

1. Backfill entryId explicitly and preserve it through cleanup, file moves, trash/restore, and reindex.
2. Add acknowledged trash/restore/purge operations and watcher exclusions. Include audio originals/cleaned variants and sidecar in the bundle manifest.
3. Replace fire-and-forget deletion UI with Move to Trash and acknowledged Undo. Keep the old irreversible socket action deprecated or gated away from normal UI.
4. Implement conflict preview and Keep both default; replacement preserves a recoverable original before acknowledgment.
5. Add date assignment/provenance and atomic index/selection reconciliation on moves.

Done when: file-operation failure and restore collision tests prove that no successful Undo depends on nonexistent files, and unreadable/unfiled/holding entries remain readable when a transcript exists.

### UX08 Settings help and maintenance

Priority P1 for read-only surfaces/help; P2 for settings writes. Depends on UX05 and UX06 for activity/job state, and UX07 before exposing the Trash UI.

Primary files: ToolsAside.svelte, CollapsibleAside.svelte, AppHeader.svelte, src/config.ts, src/lib/healthLib.ts, src/cli.ts, src/doctor.ts, config.example.json, and site/docs/. Add SettingsDrawer.svelte and HelpDrawer.svelte or evolve existing components with clear ownership.

Tasks:

1. Implement the section structure in section 11 using effective read-only config and capability checks.
2. Move maintenance out of tag filtering into Settings/Maintenance; link jobs back to Activity.
3. Rewrite help around tasks and precise product terms. Add contextual links and a shortcut reference.
4. Make CLI/startup/doctor report actual config and endpoints with required/optional readiness separated.
5. Track editable settings as UX08b, a separately reviewed P2 extension: validated atomic writes, restart-required feedback, and explicit destination/exposure changes. Complete the read-only UX08 surface first; editable controls must not be placeholders.
6. Update HTTP/MCP/docs contracts as shipped features change, including title, status filters, pagination, and job semantics.

Done when: every disabled daily action points to the correct remedy, optional cleanup failure does not block reading, and settings never appear saved until the server acknowledges their state.

### UX09 Enhancement queue

Priority P2 after the daily experience is stable.

Independently review: cross-entry MayDo worklist; manually editable actions; persisted recording drafts; import content deduplication/idempotency; resizable panes; user-selectable density; richer local transcript find; machine-readable doctor output; ExoMetaCortex export/sync agreement.

Do not build these as hidden prerequisites of earlier packets. Pane resizing must have keyboard/button alternatives. ExoMetaCortex integration requires a separate reviewed synchronization contract.

## 17 Acceptance scenarios

Use a fixture journal with 200 entries across at least three years, more than 50 matches for one term, long filenames, 22 tags on one entry, original-only entries, missing audio, a 30-minute transcript, each MayDo status, cleanup failures, holding collisions, and several pending files. No visual test needs the user's real journal or an actual bulk model call.

| ID | Scenario | Pass condition |
| --- | --- | --- |
| A01 | Launch an existing library | Entries visible without opening tags, capture, or tools; no implicit newest-year constraint |
| A02 | Desktop 1440 by 900 with a selected long-titled entry | First transcript passage at y≤220; one reader heading; search remains over entry list |
| A03 | Resize at 390, 768, 1024, 1440, and 1920 widths | No horizontal document scrolling; designated pane/drawer behavior matches section 3 |
| A04 | Open an entry 80 percent down a grid | Selected card remains anchored when grid becomes a compact list |
| A05 | Hydrate, star, or edit a selected entry | Adjacent cards remain 8 pixels apart after their measured row height; list does not jump to top |
| A06 | Change query quickly with delayed responses | Final query wins; old successful results remain until replacement; reader does not disappear |
| A07 | Search older entries from default Library | Older years appear unless explicitly filtered; active scope is visible |
| A08 | Apply two tags and two MayDo statuses | Tags combine with AND; statuses combine with OR; different filter kinds combine with AND |
| A09 | Switch custom dates and year/month | Only one date definition is active; chips match the request |
| A10 | More than 50 lexical matches, Newest then Oldest | All pages reachable; global ordering correct; no duplicated/missing entries in a static fixture |
| A11 | Hybrid search and expired page cursor | Count labels say ranked; Refresh results retains query and reader |
| A12 | Selected entry stops matching filters | Reader remains with an outside-results message; no automatic entry switch |
| A13 | Back/Forward and mobile Back to entries | Correct query, selection, tab, list anchor, and reader position restored; no writes/audio replayed |
| A14 | Long original-only or cleanup-failed entry | Speech text visible immediately; retry names the correct stage |
| A15 | Select/copy transcript text | No accidental playback; success visible; denied clipboard permission has a fallback |
| A16 | Play timestamp, switch tab, change entry | Accurate seek when known; tab change keeps player; entry change pauses; one source plays |
| A17 | Missing audio | Reader and text Copy still work; audio error is specific |
| A18 | Playback with Follow audio off/on | No automatic scrolling while off; only reader scrolls when on; manual scrolling turns it off |
| A19 | MayDo re-extraction during human edits | IDs/status decisions preserved; failed/stale output does not replace saved decisions |
| A20 | Stop/backfill/restart/resume | Stop completes current entry; outputs persist; restart shows Interrupted; resume skips current entries |
| A21 | Recorder permission denied or input absent | Correct explanation; Import remains available; no prompt at launch |
| A22 | Stop/discard/close recorder | Stop retains playable draft; Discard uploads nothing; closing cannot upload through teardown |
| A23 | Upload failure after recording | Same draft available to retry/download; journal view unchanged |
| A24 | Mixed multi-file import | Each outcome shown; failures do not erase successes; at most two uploads active |
| A25 | Watched file changes while settling | Waiting deadline refreshes; actively changing file cannot be forced into processing |
| A26 | Optional cleanup or embedding host unavailable | Original reading and lexical search work; feature-specific explanation/action shown |
| A27 | API disconnected during a write | No false success; cached reader remains; reconciliation determines outcome before retry |
| A28 | Trash and Undo | Bundle actually restored, selected/list state reconciled, no silent audio loss |
| A29 | Restore or organization collision | Preview shown; Keep both works; no silent overwrite |
| A30 | Settings change rejected or requires restart | Draft retained; response distinguishes saved from applied; unrelated config preserved |
| A31 | Keyboard-only navigation | Search, cards, tabs, player, copy, dialogs, filters, and errors all usable with visible focus |
| A32 | Touch input and browser zoom at 200 percent | Essential actions visible; readable text; appropriate target sizes; no off-screen Close control |
| A33 | Legacy sidecar and URL | No migration required to read; existing tags/stars/statuses preserved; link resolves equivalent scope |
| A34 | CLI and packaged/check-out startup | Actual config and endpoints shown; optional failures separated from blocking readiness |
| A35 | Current MCP clients | Existing read-only search/get/recent/tag calls continue working after metadata/pagination changes |

Automate URL/state/search/data integrity cases with the current Node test runner. Use fixture browser checks for geometry, scrolling, focus, text selection, playback interactions, and responsive behavior. Do not write CSS-string snapshot tests as proof of usability. Use real model calls only in an explicitly chosen extraction-quality check with representative sample transcripts.

Performance targets on the maintainer's local machine are proposed budgets: pointer/keyboard feedback within 100 milliseconds; cached-reader swap within 100 milliseconds; list/reader hydration visible feedback immediately; lexical first page p95 below 300 milliseconds after the debounce on a 20,000-entry fixture; no full transcript corpus transferred to the browser. Record hardware, fixture size, cold/warm state, and failures rather than presenting these as universal guarantees.

A manual review should attempt the three primary activities without help: find an older entry, listen/copy a passage, and select or dismiss a MayDo. Observe mistakes and unnecessary steps. Tight spacing alone does not satisfy these flows.

## 18 Instructions for an implementation model

Use the following prompt with one implementation packet at a time. UX01 is the starting packet; replace its ID for subsequent packets.

~~~text
Implement packet UX01 from docs/APP_UX_SPEC.md in this checkout.

Read the applicable repository instructions and the full relevant UX sections first.
Inspect the current code; the spec describes proposed behavior, not existing APIs.
Read the Delivery progress tracker, prerequisite evidence, execution notes, and issues.
Set UX01 to In progress when starting and add a dated scope/baseline note.
Preserve all user-authored/unrelated working-tree changes and existing sidecar data.
Use the existing Svelte/SCSS, server, and test conventions. Do not migrate frameworks.
Implement only this packet and its necessary prerequisites already approved in this task.
Keep runtime behavior and client/runtime URL parsing consistent.
If a required backend contract is missing, implement the specified contract within the
packet or report that exact dependency. Do not fake counts, progress, persistence,
Undo, audio timing, or capability support in the UI.
Run meaningful tests for state/data changes and the relevant build/type checks.
Verify the specified browser cases against isolated fixture data and save visual proof.
Do not start a bulk job on the user's journal or reconfigure their processing destinations
as part of fixture testing.
Report the files changed, acceptance cases passed, and remaining concrete limitations.
Update the packet/phase tracker and execution notes with actual check commands/results,
evidence, unrun checks, issues, and next action. Use Needs review or Verified according
to the definition of done; do not mark progress from a build or mockup alone.
Stop after a reviewable implementation of this packet.
~~~

For purely visual packets, build and browser verification are the primary checks. For backend/data packets, add tests for failures and preservation, not just the successful path. A passed build is not proof that browser Back, focus, or file restoration behaves correctly.

## 19 Review guide and relationship to previous specs

The review can be concentrated on five choices:

1. Replace Recent/All notes duplication with Library over all active entries, newest first.
2. Place search over the list while keeping the reader at the workspace top.
3. Use timestamps for playback and allow normal transcript text selection.
4. Keep recording as Stop → draft → Save by default.
5. Build acknowledged Trash/Undo and explicit Activity before adding more maintenance controls.

If those choices are accepted, the packets above provide a complete implementation path. If one changes, update its interaction rules and acceptance scenarios before implementation so a smaller model does not have to infer the new behavior.

This draft supersedes conflicting future UX direction in INBOX_SEARCH_UX_SPEC.md and UI_ENGRAM_SPEC.md only after review. In particular: stacked recording above search, a narrow maximum page width, Focus groups above results, metadata above transcript, and one undifferentiated Tools drawer are no longer the recommended product direction. Existing API/sidecar/processing contracts remain valid until a packet explicitly extends them.

Preserve the scale architecture in SCALE_SEARCH_SPEC.md and the organization rules in VOICE_INBOX_SPEC.md. Earlier draft statements about the repository having no tests/remote/health checks are historical descriptions, not facts to carry into a new implementation.

Technical source locations for the audit:

- client/src/lib/components/Transcriptions.svelte: query scope, URL behavior, selection, filter loading, full-copy and deletion behavior.
- client/src/lib/components/NoteCard.svelte: basename/elapsed presentation, transcript buttons, tabs, tags, MayDo controls.
- client/src/lib/components/NoteList.svelte and VirtualList.svelte: columns, keyed heights, virtualization, scroll roots.
- client/src/lib/components/AudioRecorder.svelte: recorder lifecycle, auto-upload on Stop, file import feedback.
- client/src/lib/components/AppHeader.svelte, ToolsAside.svelte, and CollapsibleAside.svelte: capture/header, diagnostics, help.
- src/lib/journalIndexLib.ts: result cap, filters, candidate ranking, sorting, index summaries.
- src/lib/mayDoLib.ts, mayDoService.ts, and mayDoBackfillLib.ts: grounded actions, preservation, extraction, transient backfill jobs.
- src/socketEvents.ts: existing permanent audio/sidecar unlink behavior.
- src/apiRoutes.ts, src/config.ts, src/cli.ts, and src/lib/healthLib.ts: operations, config, startup, health.
- src/mcp.ts and site/docs/: integration and user-facing command/API documentation.

The external references in section 13 support the design principles and accessibility requirements. Layout dimensions, default scopes, packet priorities, and action wording are product recommendations for DictaWhisper.

- **2026-10-05 · PH02 / UX05:** Completed and Verified. Separated Stop/Save/Discard, retained failed drafts/imports, enforced two concurrent imports and non-overwriting acknowledged uploads with stable receipts. Added pipeline-backed Activity, safe settle deadlines, targeted retries, explicit Interrupted recovery, reconnect reconciliation, and pending audio before JSON. Native playback position survived at 38.577876s; capture closes when opening an entry and recording pauses reader audio. Fixed Escape interception, mobile draft-header width, converted-audio identity, and a fixed-delay test race. 143 tests, typecheck, runtime/client builds passed; five widths checked. [Evidence](UX05_VERIFICATION.md). Next: UX06; UX02-V01 remains open.

- **2026-10-05 · PH02 / UX06:** Completed and Verified. Centralized counts/statuses, added Selected-first review and collapsed inactive groups, per-action saves/conditional five-second Undo, source disclosures, visible copy feedback, and explicit stale/error/disabled remedies. Persisted full-path backfill intent/outcomes with restart interruption, Resume, failed-only retry, split skip reasons, stop-after-current, storage failure handling, and crash-window skipping. Fixed retry wording, Svelte year-pattern interpolation, year-field disappearance, and copy visibility during browser verification. 150 tests, typecheck, runtime/client builds passed; desktop/tablet/phone checks and three-attempt scoped recovery verified. [Evidence](UX06_VERIFICATION.md). PH02 Verified. Next: UX07; UX02-V01 remains open.


- **2026-10-06 · PH03 / UX07:** Completed and Verified. Introduced optional stable entry IDs and explicit backfill, verified full-bundle copy/removal with rollback, durable Trash/restore receipts, typed per-bundle permanent removal, retained-copy recovery, conflict preview/Keep both, confirmed recording dates, and index/cache/URL reconciliation. Replaced irreversible socket deletion with acknowledged Trash and eight-second Undo; added conditional tag Undo. Fault tests cover copy/removal/index failure, external changed bytes, junction redirects, stale previews, and restore collisions. Browser tests verified date moves, failed acknowledgment retaining the reader, real server Undo/later restore, full conflict preview, and Keep both preserving reader context. [Evidence](UX07_VERIFICATION.md).

- **2026-10-06 · PH03 / UX08:** Completed and Verified. Replaced Tools with eight-section effective read-only Settings and task Help. Moved reviewed tag maintenance, audio checking/selected marking, explicit identity backfill, and derived index rebuilding into Settings; bulk jobs and cleanup recovery link to Activity. Diagnostics are explicit, copyable, and separate transcription requirements from optional cleanup. Startup tests found and fixed the packaged root route being masked by the API welcome page and an ignored explicit UI port override. Source and compiled startup both serve existing journal UI with transcription unavailable. Final full suite: 164 passed, 0 failed; typecheck and runtime/client builds passed. PH03 Verified; 7/8 core packets Verified. [Evidence](UX08_VERIFICATION.md). UX02-V01 remains manual review; UX08b/UX09 remain Deferred.
