# Inbox search UX: borrow Engram’s archive habits

**Status:** implemented (X0–X4). Stars and per-note tag edit sit on the sidecar (`starred`, `tags`) and `?starred=1`.  
**Date:** 2026-08-22  
**Surface:** inbox at 7777 (`Transcriptions.svelte` + existing `/notes/*` APIs). Still one page.  
**Reference:** sibling [Engram](https://github.com/Catalyst-Forge-LLC/engram) — `search/+page.svelte`, `SearchFacetFilters.svelte`, `ThreadMonthGroups.svelte`, `SearchHitCard.svelte`, `SegmentedControl.svelte`, `ThreadTimelineRail.svelte`.  
**Already shipped elsewhere:** chrome in [`UI_ENGRAM_SPEC.md`](./UI_ENGRAM_SPEC.md) (U0–U5). Index in [`SCALE_SEARCH_SPEC.md`](./SCALE_SEARCH_SPEC.md) (FTS + sqlite-vec). This spec is the **habits**, not the paint.

Engram is a multi-route reader (Search / Chats / SMS / Stats). DictaWhisper is a journal you record into and reread on one screen. We may merge the two apps later. Do not merge now. Do not grow routes, a user picker, or an ingest page. Steal the ways Engram lets you **slice time, keep a query, and tell browse from hits**.

---

## 1. What Engram does that the inbox does not

| Habit | Engram | Inbox today |
|---|---|---|
| **Two surfaces** | Empty query → year/month thread archive. Query → message hit cards. Archive stays below. | Query replaces the list with the same year-grouped cards. Easy to lose “where you were.” |
| **URL is the filter** | `?q=&tag=&year=&month=&sort=&corpus=` (`replaceState`, keep focus). Tag chips and Stats year links land on the same page. | Filters live only in component state. Refresh / share / back loses them. |
| **Year as a control** | `<select>` All years + year list. Choosing a year with no query **browses that year** (SMS year feed). Month filter once a year is set. | Years are collapse headers. Opening an older year fetches it. No jump-to-year control, no month dropdown. |
| **Day range** | From / To `<input type="date">` on the SMS facet row. | API already has `since` / `until`. The inbox never sends them. |
| **Sort** | Segmented: Recent / Oldest / Best match (plus Most msgs, which is thread-shaped). | Always newest basename. Search uses rank, then we still group by month. |
| **Search mode** | One FTS corpus (plus SMS facets). | Server has `lex` / `semantic` / `hybrid`. Inbox never exposes mode. |
| **Hit chrome** | `SearchHitCard`: amber rail, title, mono timestamp, snippet. Click deep-links into the thread (`?message=`). | Hits are ordinary note cards. Expand hydrates `/note?file=`. No shareable open-note URL. |
| **Clear** | Clear results and Clear filters are separate. | Clear search only. Tags and Unreadable stay on. |
| **Status copy** | “Searching for …”, “No messages matched …”, “Showing N of M threads.” | “Loading notes…” / “No notes match.” No hit count vs corpus count. |
| **Time rail** | In-thread month rail: jump to first message in a month. Stats has year bars. | Year Focus / All years. Playback cues seek inside a note. No year index or in-list month jump. |

The chrome spec already copied year collapse, sticky month rails, Focus / All years, chips, and search-card look. Those stay. This list is what still feels unfinished once the paint matches.

---

## 2. What not to copy

These are Engram’s object, not ours:

- Routes (Search, Chats, SMS, Stats, Ingest).
- Corpus / platform / account / contact / sent-received.
- “Has media” and “include archived” as SMS facets. Holding / Unfiled / unreadable already name our exceptions.
- Bulk archive toolbar.
- Enrich-stale progress.
- Most-msgs sort.
- Virtualized thread reader.
- User picker.
- Tailwind / Svelte 5 file copies.

If a merge happens later, those stay Engram’s until a joint IA exists. Do not pre-build them here.

---

## 3. Adopt (same habit, our object)

Keep one page. Record and drop stay above the archive.

### 3.1 Browse vs hits

**Browse** (no `q`): Holding, Unfiled, year/month cards. Same as now. Year open still fetches `/notes/index?year=`.

**Hits** (`q` and/or a day range that is not “this year of cards”): a flat list of hit cards **above** the archive, not instead of it. Archive can dim or stay collapsed. Clear results returns you to the year you were in.

Do not rebuild a client Fuse of the corpus. Hits come from `GET /notes/search`.

### 3.2 URL state

Put filters on the inbox URL so refresh, back, and a pasted link work. Single-page SvelteKit can use query on `/` (or hash if query fights the recorder). Keys, for a later merge with Engram’s names where they already match:

```
q          words
tag        repeatable; AND
year       YYYY          browse / constrain
month      MM            only with year
since      YYYY-MM-DD
until      YYYY-MM-DD
sort       recent | oldest | relevance
mode       lex | hybrid | semantic
unreadable 1
file       sidecar path  expand this note
```

`replaceState` + keep focus, like Engram. Tag chip click writes `tag`. Year header click can write `year` without jumping routes.

### 3.3 Date controls

One compact **Filters** row under the search card (eyebrow `FILTERS`, same 10px tracking as tags):

1. **Year** select: All years + `/notes/years` counts (`2024 · 312`). Changing year with an empty `q` browses that year (fetch index, open the section). With a `q`, it becomes a search constraint (`since`/`until` for that calendar year, or a `year=` on search — pick one and stick).
2. **Month** select: enabled when a year is set. Maps to `/notes/index?year=&month=` or search `since`/`until` for that month.
3. **From / To** date inputs. Wire the existing `since` / `until` query params. Hidden behind a “Dates” disclosure on narrow widths so the row does not become Engram’s SMS facet grid.

Do not add a second calendar widget. Native `type="date"` is enough.

### 3.4 Sort and mode

Two dense segmented controls (we already have the pill look from the chrome spec):

| Control | Values | Default |
|---|---|---|
| Sort | Recent · Oldest · Best match | Recent when browsing; Best match when `q` is set |
| Mode | Words · Hybrid | Hybrid when embeddings exist (`/notes/stats`.embedded > 0); else Words only, hide the control |

`Words` = `mode=lex`. `Hybrid` = `mode=hybrid` (RRF). Do not add a third “Semantic only” pill unless Tools needs it for debugging. Filename queries (`filename:Record008`) stay lex regardless of the pill.

API gap: search currently ranks and stops. Add `sort=recent|oldest|relevance` so Recent/Oldest are server-side on the hit set (or sort the returned page). Do not pull 20k rows to sort in the browser.

### 3.5 Hit cards

A hit is not a full note. Card:

```
[ amber rail ]
[ dated basename          ]  [ day ]
[ preview, two lines, <mark> on query tokens when the API sends offsets ]
[ tags ]
```

Click expands in place (`hydrateNote`) **and** writes `?file=` so a link opens that note. Same allowlist as `GET /note?file=`. Playing uses the existing cue rail; do not invent a second “now playing” language.

### 3.6 Clear and counts

- **Clear search** — drop `q` and hits; keep year/tags if they were browse filters.
- **Clear filters** — drop tag, year, month, since, until, unreadable.
- Meta line: `N hits` when searching; `Showing newest year · M notes` when browsing. Pull M from `/notes/stats` or the year row, not a client walk.

### 3.7 Year jump

A short **Years** strip (text buttons or a select — select if more than ~8 years): the `/notes/years` list. Click = browse that year. This is Engram’s year `<select>` + Stats “by year” without a Stats route. Tools can keep the index line; do not add a Stats page.

---

## 4. Adapt, don’t clone

| Engram | DictaWhisper |
|---|---|
| Corpus pills (Both / Chats / SMS) | Optional later: All · Journal · Holding · Unfiled. Unreadable stays the Tools chip. Not in the first slice. |
| Title contains | Already `filename:` in FTS. A second box is noise. |
| Tag `<select>` + chips | Chips only. URL-sync them. |
| In-thread month rail | Skip. A note is minutes, not a 10-year SMS thread. Playback cues already jump inside the note. |
| `?message=` deep link | `?file=` for the sidecar. Optional `#cue-<n>` later if we need to land on a paragraph. |
| Amber `<mark>` | Yes, once search returns `preview` with marked tokens **or** a `highlights[]` array. Do not regex-mark on the client until the hit set is small (it is: ≤50). Client mark on preview is fine for slice 1. |
| “Browsing SMS in 2014” banner | “Browsing 2014” when year is set and `q` is empty. |

---

## 5. API already there vs gaps

| Need | Status |
|---|---|
| `GET /notes/search?q=&tag=&since=&until=&mode=` | Shipped. Inbox ignores since/until/mode. |
| `GET /notes/index?year=&month=` | Shipped. |
| `GET /notes/years`, `/notes/tags`, `/notes/stats` | Shipped. |
| `sort=` on search | Missing. Add `recent` / `oldest` / `relevance`. |
| `year=` / `month=` on search | Missing or emulate with since/until. Prefer explicit year/month so URLs match Engram. |
| Highlight offsets | Missing. Client-side mark on ≤50 previews is enough until we care. |
| `GET /note?file=` | Shipped. Use it for `?file=` hydrate on load. |

Do not add a second search engine. Do not walk sidecars for the inbox.

---

## 6. Workstreams

Each slice should be shippable alone. Chrome spec U0–U5 is not a prerequisite for X0–X2 (ugly controls that work beat pretty ones that lose the query).

**X0 — URL state.** Read/write `q`, `tag`, `year`, `month`, `unreadable`, `file` on `/`. Hydrate the open note from `file`. No new visuals.

**X1 — Hits vs browse.** Search results render as a hit list above the year archive. Clear results restores browse. Debounce stays 150ms.

**X2 — Date + sort + mode.** Year/month selects, From/To, sort pills, mode pill (if embeddings exist). Wire `since`/`until`/`mode`/`sort`.

**X3 — Hit cards + deep link.** Rail, day, mark-on-preview, `?file=` on expand.

**X4 — Year jump + counts.** Years strip from `/notes/years`. “N hits” / “browsing YYYY” copy.

**X5 — (optional)** `year`/`month` on the search API; snippet offsets from FTS; `#cue-` land.

---

## 7. Acceptance

1. Paste `http://127.0.0.1:7777/?q=sangria&tag=Kristen&year=2013` and land on those hits without clicking around.
2. Empty `q` + `year=2011` opens 2011 (fetch that year), not a Fuse of the whole journal.
3. From/To `2015-07-01` … `2015-07-31` + `q=tickets` hits July 2015 only.
4. Hybrid vs Words changes the ranking on a paraphrase query once vectors exist; Words still wins for `filename:`.
5. Clear filters does not delete the search box; Clear search does not wipe the year you were browsing.
6. Record, drop, playback cues, Holding, Unfiled, Tools: unchanged.
7. Still one route. No `/search`, `/stats`, or `/ingest`.

---

## 8. Merge later (do not build for it)

If DictaWhisper and Engram ever share a shell, cheap alignments now:

- Same query keys (`q`, `tag`, `year`, `month`, `sort`).
- Same hit shape extras: `day`, `preview`, `score` (Engram uses `created_at` + `snippet` + `rank` — map, do not rename our API).
- Same “browse when no q, hits when q” rule.

Do not share a component library yet. Different Svelte majors, different objects (note+audio vs thread+message). Port habits, not files.
