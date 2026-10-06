# UX04 query continuity and pagination — verification

2026-10-05. **Verified.** Next implementation packet: UX05 capture and processing visibility. UX02-V01 remains open for physical touch and actual 200% browser zoom; these are separate manual checks.

## Implementation

- The UI now uses `GET /notes/search?page=1` for Library, named views, filters, word searches, and meaning searches. It requests pages of 50 summaries instead of downloading the corpus and filtering it in the browser.
- `EntryPage` includes `items`, `total`, `countKind`, `hasMore`, `nextCursor`, and the actual `mode`. Meaning search also returns `candidateLimit` and `expiresAt`. Exact copy reads “50 of 199 entries”; meaning copy reads “50 shown from 201 ranked results · maximum 500.” The ranked count does not claim to be an exhaustive matching total.
- Filter-only and lexical paths apply scope and deterministic ordering in SQLite before LIMIT/OFFSET. Recording day, basename, and stable sidecar key break ties; lexical relevance uses rank followed by deterministic date/key order. Counts come from COUNT(*) over the same matching scope, independent of the page length.
- All query paths share custom-date precedence over calendar selection, status OR, exact tags AND, stars, folder, attention, and unreadable filters. Semantic distance is calculated over filtered indexed vectors on the server, so an early global nearest-neighbor cap cannot silently discard otherwise eligible entries.
- Meaning searches use a stable server snapshot of at most 500 fused candidates. Lexical and semantic candidate retrieval each cap at 500; fusion then keeps at most 500. Sorting by date operates within that explicitly labeled ranked set. At most 32 snapshots remain in memory, each for up to 60 seconds. Pagination reads the existing snapshot and makes no additional embedding/model call.
- Cursors are opaque, authenticated with a per-index HMAC key, and bound to normalized query, scope, mode, sort, and synonym configuration. Changing these rejects the cursor with `invalid_cursor` (400). Exact cursors also check index writes/data version, refusing to silently skip or duplicate results after edits. Expired/evicted ranked snapshots return `cursor_expired` (409). Restarted instances reject old authenticated cursors; the UI offers the same recovery action.
- Legacy HTTP requests still return `{ hits, count }`, with their historical returned-array count. Legacy service/MCP search still returns its capped array. Recent/get/tag behavior remains available. README documents the opt-in page contract.
- Prior successful cards remain during requests; AbortController and request identities reject late query and continuation responses. Failed updates retain cards with explicit previous-results copy and a retry action. Continuation cannot append results from an obsolete query.
- Load more stays visible outside the independently scrolling cards, remains keyboard accessible, and preserves the list anchor and reader. Its final-page completion message receives keyboard focus if the paging button disappears. Reader Next fetches the next page when needed and retains its own focus.
- Saved list anchors record how many summaries had been loaded. Returning to a query, browser history, or refresh reloads only enough of those pages to restore the anchor, rather than searching for it across the whole corpus. Deleted/changed anchors cannot cause an unbounded restoration walk.
- Expiry keeps query, selected reader, and existing results, with Refresh results in both list and reader. This works when the mobile reader hides the list. Recovery/retry controls in reader notices have 44px targets on narrow/coarse-pointer surfaces.

## Automated checks

- `pnpm test`: **131 passed**.
- `pnpm typecheck`: passed.
- `pnpm build`: runtime and client passed. Final client rebuild after the mobile target correction passed, without Svelte accessibility or unused-selector warnings.
- `git -c core.whitespace=cr-at-eol diff --check`: passed.

`test/entryPage.test.ts` covers:

1. 137 static matching entries through filter-only, words, and filename search; all pages, exact counts, global Newest/Oldest reversal, and no duplicate/missing identities.
2. Authenticated malformed/foreign-scope/sort cursors, equivalent tag normalization, and explicit invalidation after an index edit.
3. Custom dates overriding a conflicting year, two exact tags AND, two MayDo statuses OR, and stars across filter-only, lexical, hybrid, and semantic requests.
4. 507 indexed entries with synthetic vectors: a stable 500-candidate ranked set over ten pages, index edits retained outside the snapshot, no continuation embedding needed, 60-second expiry, and an exhaustive 507-result lexical alternative. Missing embeddings truthfully fall back to exact word results.
5. Actual HTTP route execution: legacy shape, opt-in page shape/count, continuation, invalid statuses/cursors (400), and changed-index expiry (409).
6. A real MCP SDK client connected to the current stdio server with isolated roots/config/index: search, get, recent, and tags all succeed with their existing tool names and response contracts (A35).

Existing journal/state/title/MayDo tests continue to pass. No production journal/config/model or microphone was used.

## Rendered browser checks

Used the actual built client with `scripts/ux01-fixture.mjs`, real JournalIndex, 202 isolated sample entries, and synthetic vectors. A fixture-only clock endpoint expires snapshots deterministically; production does not expose that endpoint.

| Acceptance | Evidence |
| --- | --- |
| A06 delayed queries | Submitted `slow` (deliberate 1400ms delay), then `repair`. Old successful cards remained with Updating entries copy. `repair` won, even after the delayed response window; Fixture 173 stayed open. |
| A10 complete word pagination | Keyboard Load more reached 100, 150, and all 199 word matches. At completion, focus moved to “All 199 entries loaded.” Oldest first began with Fixture 000 on Sep 1, 2010. Static complete-order/no-duplicate assertions also passed on the server. |
| A11 honest hybrid/expiry | Ranked count changed from 50 to 100 of the stable 201-candidate sample set. Expired cursor exposed Refresh results. Query `kitchen`, Fixture 195, and paused audio survived refresh; reader position returned to the same 900px passage position after the temporary notice was removed. |
| Reader Next across page boundary | Selected entry 50 (Fixture 146), then Next fetched the next page and opened Fixture 173. List scroll stayed **6415.33px** and focus stayed on Next; audio remained paused. |
| Load more while reading | Before/after append: Fixture 195, reader scroll **900px**, list scroll **0px**, paused audio. |
| Restore query beyond page one | Saved a position on page two with list scroll **13454px**, changed to another query, then returned. Required second page loaded and scroll restored to **13454px**, with the reader retained. |
| Responsive paging | At 390/768/1024/1440/1920px, no horizontal overflow. Persistent Load more measured **44px** high. Entry-card viewport heights were 563/610/628/628/628px at 900px height. |
| Mobile expiry | At 390×844, reader Refresh results remained visible with a **44px** high target and no overflow. Refresh retained Fixture 195 and `kitchen`; audio stayed paused. |
| Console | Final sample view had no captured browser errors or warnings. |

A07–A09 scope regressions are exercised against all three query paths in the new server tests. Search/paging keyboard checks contribute to A31; physical touch and actual browser zoom remain under UX02-V01.

Screenshot: `Z:/workspace/__tmp/dictawhisper-ux04.jpg` (1440×900, sample data, 100 ranked results loaded alongside the reader).

## Notes and boundaries

- Exact paging refreshes on index changes; ranked paging preserves its candidate snapshot until expiry/eviction. These contracts avoid silently mixing successive search generations.
- Semantic distance work scales with the number of eligible indexed vectors; only the bounded candidate summaries reach the client. Large real-corpus performance remains a future performance check, not a claim derived from the 507-entry test.
- Embedding resolution/inference itself was not exercised against a live host; pagination was checked with actual sqlite-vec and synthetic vectors. Continuation skips model resolution in the service.
- The isolated fixture server was stopped and temporary fixture data removed after verification. Agent browser tabs were closed and viewport overrides reset. The production server remains stopped.
- No UX04 implementation issue remains open. UX05, live capture/processing, and subsequent packets are not included in this completion claim.
