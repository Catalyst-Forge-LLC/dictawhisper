# Scale and search: thousands of notes

**Status:** spec, not implemented  
**Date:** 2026-08-21  
**Surface:** inbox at 7777, HTTP, MCP. Sidecar JSON stays the source of truth.

The inbox already holds 20 years of notes. Client Fuse over a full `notes-index` payload will not stay fast. This spec replaces that path with a derived SQLite index: FTS5 first, optional local embeddings second.

---

## 1. What we do today

| Path | How search works |
|---|---|
| Inbox (`Transcriptions.svelte`) | Socket / `GET /notes/index` ships every summary (path, tags, **full search body**). The browser builds a [Fuse.js](https://github.com/krisk/Fuse) index (`useTokenSearch: true`) and filters on every keystroke. Year/month groups lazy-render; the **corpus is still all in RAM**. |
| MCP / `journalQueryLib` | Walks sidecars, builds Fuse **per query** on the full pool, returns ≤50 hits. |
| Startup | `loadExistingTranscriptions` logs index megabytes. Socket.io `maxHttpBufferSize` is 32MB because the dump is large. |

Fuse is the right library for typo-tolerant search of a few hundred in-memory docs. It is the wrong hot path for 5k–20k notes with full transcripts. Rebuilding the index on every reactive `transcriptions = …` is the first cliff. Shipping every `searchBody` to the phone inbox is the second.

We already depend on Fuse (full build). Keep it only where the set is small (MCP fallback, or reranking a page of FTS hits). Do not grow a second client-side search stack.

---

## 2. Targets

- **Corpus:** 5,000 notes now; design for 20,000. Typical note is 0.5–5KB cleaned text.
- **Inbox first paint:** year/month cards + previews for the newest month in under 300ms after the API is up. Do not wait on a 10MB JSON.
- **Lexical search:** `Kristen sangria` or `filename:Record008` returns in under 100ms on this machine. Typo tolerance is required for names (`Kisten` → Kristen).
- **Semantic search (phase 2):** “that time we bought Powerball tickets” hits the 2013 note without sharing those words. Local only. No cloud embed API.
- **RAM on the phone inbox:** summaries only (path, day, tags, 200-char preview, flags). Full text loads on expand, as today.
- **Truth:** sidecar JSON next to the audio. SQLite is a cache. Deleting the db is a rebuild, not data loss.

Out of scope: a new route, a separate “search app”, remote Postgres, or sending audio into the embed model.

---

## 3. Derived index

One file, gitignored, next to other runtime state:

```
data/journal.sqlite
```

Tables (names can move; jobs cannot):

**`notes`** — one row per sidecar

| Column | Source |
|---|---|
| `json_file` PK | Realpath |
| `basename` | Filename |
| `day` | `YYYY-MM-DD` from name, else folder, else mtime |
| `year` `month` | From `day` |
| `folder` | `holding` / `unfiled` / `journal` |
| `tags` | JSON array (also a child table if FTS join is cleaner) |
| `preview` | 200 chars |
| `has_cleaned` | bool |
| `audio_error` | null or short reason |
| `mtime_ms` | Sidecar mtime (invalidate) |
| `text_hash` | Hash of cleaned+raw+tags so we skip no-op writes |

**`notes_fts`** — FTS5, `unicode61`, content=`notes` or external-content

Columns: `basename`, `tags`, `body` (cleaned preferred), `raw` (Whisper, lower weight at query time).

**`notes_vec`** (phase 2) — [sqlite-vec](https://github.com/asg017/sqlite-vec) float embedding per note. One vector per sidecar, not per paragraph, until we measure. Model and dim locked in config (`journal.embedModel`, default a local MiniLM / nomic-class model the existing Python can run).

Rebuild: `pnpm journal:index` (full walk). Incremental: on `emitTranscription` / sidecar write / delete, upsert or delete that row. Startup: if the db is missing or schema version mismatches, rebuild in the background; inbox can show “indexing…” in Tools, not a white screen.

If FTS is stale (sidecar mtime newer than row), that note is reindexed on the next search miss or a short periodic sweep. Never block Record on the indexer.

---

## 4. Query API

Replace client Fuse as the corpus search. MCP uses the same functions.

```
GET /notes/search?q=&tag=&tag=&since=&until=&mode=lex|semantic|hybrid&limit=50
GET /notes/index?year=2025&month=07
```

`GET /notes/index` today returns everything. Change it to **page by year/month** (default: newest year, or `limitMonths=1`). Full dump stays behind `?all=1` for a transition release, then dies.

Search modes:

1. **`lex` (default, phase 1)**  
   FTS5 `AND` of tokens + prefix (`Krist*`). Tag filters are SQL `AND`, not Fuse. Filename tokens search `basename`.  
   Optional: run Fuse **only on the FTS hit set** (≤200 rows) for typo ranking. That keeps [Fuse](https://github.com/krisk/Fuse) where it is cheap.

2. **`semantic` (phase 2)**  
   Embed the query with the same local model. KNN via sqlite-vec. Return notes, not chunks, unless we later split long notes.

3. **`hybrid` (phase 2 default once embeddings exist)**  
   Merge FTS rank + vector distance (RRF or a fixed weighted sum). Tags and day range still SQL.

Hits look like today’s `JournalHit`: `jsonFile`, `basename`, `day`, `tags`, `preview`, `score`. Inbox hydrates full sidecar on expand (`GET /note?file=`), unchanged.

MCP `dictawhisper_search` calls `searchJournal` against the db, not a fresh walk+Fuse.

---

## 5. Inbox behavior

- First paint: newest year/month from `GET /notes/index?…`, Holding, Unfiled. Older years load when you open them (we already page months; stop downloading their search text).
- Search box talks to `/notes/search` (debounce 150ms). Do not rebuild a client Fuse of the whole journal.
- Tag chips: from `GET /notes/tags` (counts from SQL), not a client scan of every note.
- Tools drawer already shows queue + unreadable. After this spec: an “Index” line (row count, last rebuild, embed coverage).
- Unreadable filter: `audio_error IS NOT NULL`, not a client preview string.

Acceptance for the inbox slice: 10k dummy sidecars, search “sangria” and filter tag `Kristen` without the tab locking up. First paint does not transfer all 10k full texts.

---

## 6. Workstreams

**S0 — Slim index payload.** Drop `searchBody` / `searchRaw` from the socket summary. Keep preview + flags. Client Fuse then searches preview+tags+basename only (worse recall, but the page lives). Ship this if S1 slips; it is a one-file cut.

**S1 — SQLite FTS5.** Schema, rebuild CLI, incremental upsert, `GET /notes/search?mode=lex`, MCP wired. Inbox search uses the API. Fuse remains only as optional rerank on the hit page.

**S2 — Paged `GET /notes/index`.** Newest month first. Expand-year fetches that year. Holding/Unfiled always included.

**S3 — Local embeddings.** Python worker (same family as Whisper) writes vectors into sqlite-vec. `mode=semantic` + `hybrid`. Tools shows “embedded N / M”. No embed of audio. Skip notes with `audio_error`.

**S4 — Kill the 32MB dump.** Socket `notes-index` becomes a diff or a “reload month” event. Lower `maxHttpBufferSize` back to something sane.

Order: S0 if we need air now, else S1 → S2 → S3 → S4. Do not start S3 until S1 search is what the inbox uses.

---

## 7. Why not “just Fuse on the server”

A Node Fuse over 20k full transcripts still loads every sidecar into a JS string heap and rebuilds a big bitap index. MCP already does that per query. It will feel fine until it does not, and it never gives “Powerball tickets” without those words.

FTS5 is the lexical engine that belongs in-process with SQLite, survives restarts, and filters tags/dates without scanning. Fuse can sit on top of a **small** candidate set for typos. Embeddings are the intelligent layer, local, same db file.

---

## 8. Config (when we implement)

```json
"journal": {
  "index": "./data/journal.sqlite",
  "search": "lex",
  "embedModel": "",
  "embedDevice": "cpu"
}
```

Empty `embedModel` = FTS only. Doctor warns if the db is missing after first run of S1.

---

## 9. Acceptance

1. Deleting `data/journal.sqlite` and running `pnpm journal:index` restores search. Notes on disk are untouched.
2. `GET /notes/search?q=sangria` does not walk the tree.
3. Inbox search no longer constructs `new Fuse(transcriptions)` on the full list.
4. MCP search results match the HTTP search for the same `q` + tags.
5. Phase 2: a paraphrase query returns the 2013 Powerball note in the top 10 with `mode=hybrid`.
6. Tools reports index size and unreadable count from SQL, not a second tree walk.
7. Browser record and `/audio` drop are unchanged. Indexer is best-effort after the sidecar write.

---

## 10. Open questions

1. **Embed model:** one small local model everyone can run (ONNX MiniLM) vs reuse the Ollama box. Recommendation: CPU ONNX so search works when ollanet is asleep.
2. **Chunking:** one vector per note vs per cleaned paragraph. Start per note; split only if long notes drown short ones.
3. **FTS language:** `unicode61` + a small synonym list for house names (Kristen, Mindcorp) vs relying on Whisper’s initial prompt + embeddings. Recommendation: prompt terms become FTS synonyms in S1.
4. **Windows file watch:** incremental index on `emitTranscription` is enough; do not add a second chokidar on `*.json`.
