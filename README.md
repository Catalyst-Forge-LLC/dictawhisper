<p align="center">
  <img src="site/static/logo.png" alt="DictaWhisper logo" width="128" />
</p>

# DictaWhisper

**A local voice journal.** Record in the browser, drop a file, or (optionally) sync a phone folder. Transcribe on your GPU with [faster-whisper](https://github.com/SYSTRAN/faster-whisper). Clean the note with [ollanet](https://ollanet.dev). The `.json` next to each recording is the journal.

Install from a Git checkout ([below](#from-a-checkout)). Starting with 0.1.11, the npm package ships compiled JavaScript and the inbox UI. Earlier releases through 0.1.10 do not start from npm installations. Python and faster-whisper remain separate prerequisites.

**Docs:** [dictawhisper.com/docs](https://dictawhisper.com/docs) · **Site:** [dictawhisper.com](https://dictawhisper.com)

## Before you clone

Exercised path: Windows, Node 22.13+ (checkout scripts use `--experimental-strip-types`), pnpm, Python with [faster-whisper](https://github.com/SYSTRAN/faster-whisper), and an NVIDIA GPU with CUDA. `ffmpeg` is required when denoise is on. macOS and Linux are unverified. CPU mode works and is slow. Cleanup via [ollanet](https://ollanet.dev) is optional.

## From a checkout

```bash
git clone https://github.com/Catalyst-Forge-LLC/dictawhisper.git
cd dictawhisper
cp config.example.json config.json
pnpm install
pnpm run doctor
pnpm dev
```

Ready signal: `pnpm run doctor` exits 0, or only warnings remain. Then open [http://localhost:7777](http://localhost:7777). Point `whisper.python` at the interpreter that has CUDA Whisper. Cleanup host and model are optional; raw transcripts still work.

LocalSlip is optional. `pnpm dev` and `pnpm serve` read existing `dictawhisper` and `dictawhisper-api` claims when available; they do not create claims. Without LocalSlip, the UI uses 7777 and the API uses `http.port` (8008 by default). Startup names both endpoints and gives the UI proxy the same API port. Claim ports separately if you want named assignments.

## Quick start

```bash
pnpm dev     # API + UI  →  http://localhost:7777
pnpm start   # API only on 127.0.0.1:8008
```

Hit Record, or drag an audio file onto the page. Flags, HTTP, MCP, and `retranscribe` live in the [docs](https://dictawhisper.com/docs).

## What you get

Files are the database. Each note is the recording plus a neighboring `.json`. The Whisper model stays loaded. Audio and transcript files stay on this computer. Cleanup sends transcript text only to the host in `ollanet.machine`, and is skipped when that is empty. Search indexing embeds note text on this computer by default; it goes to another host only if you set `journal.embedHost` (`machine`, a host name, or `any`). With no embedding model on an allowed host, or with `journal.search` set to `lex`, nothing is embedded and search matches words only; doctor says which. The inbox is loopback by default; `http.tailscale` puts the same page on your tailnet. Playback follows cleaned paragraphs using Whisper word times. If cleanup is skipped or fails, the inbox shows **raw only** or **cleanup failed**, and **Retry** is available. Transcription itself still needs faster-whisper.

## Browsing and MayDos

Select a card to read its full entry in the right pane. The entry list and detail pane scroll separately. On narrow screens, **Back to entries** returns to the cards. Hover over a transcript passage (or focus it with the keyboard) to copy its text; its timestamp still plays the audio.

Library and search results load in pages of 50. **Load more** keeps the current reading position, and reader **Next** continues onto the next page. Word searches show an exact matching count and sort the full matching set before paging. Meaning searches label their bounded ranked results; **Search words only** switches to exhaustive word matching. If results change or a ranked snapshot expires, **Refresh results** keeps the selected entry open.

HTTP callers can opt into the page contract with `GET /notes/search?page=1`: `items`, `total`, `countKind` (`exact` or `ranked`), `hasMore`, `nextCursor`, and actual `mode`. Ranked responses also include `candidateLimit` (500) and `expiresAt` (60 seconds). Pass `cursor` with the same query/filter/sort parameters to continue. Cursor errors return `invalid_cursor` (400) or `cursor_expired` (409); refresh by omitting the cursor. Without `page=1`, the legacy `{ hits, count }` response remains available; its `count` is the returned array length, not a corpus total. Existing MCP search keeps its array response.

Cleanup also extracts **MayDos**: possible actions stated in the transcript, including tentative intentions. Each starts as **Suggested** and can become **Selected**, **Done**, or **Dismissed**. Its source quote and available audio timing stay with it. Re-extraction preserves IDs and your status choices, keeping decided items even when the model omits them. Filter entries by any MayDos or a particular status.

Existing entries have an **Extract MayDos** action in their detail pane. **Tools → MayDo backfill** processes the library serially using the configured cleanup host and model. Optionally restrict it to a year. It skips entries already extracted from unchanged text unless refresh is enabled, shows progress and errors, and stops after the current entry when requested. Starting it again skips completed work. Progress is held in memory; results are saved in the sidecars.

Sidecars store a `mayDos` array (ID, title, verb, source quote, audio start/end, status, and timestamps), plus `mayDoExtraction` version, source hash, model, host, and timestamp. Failures set `mayDoError` without replacing existing actions. ExoMetaCortex synchronization is a future step.

<!-- xfacts-label -->

## xFacts label

- **AppFacts:** [viewer](https://appfacts.dev/v#af1.eNpVkltr3DAQhf-KmKcWtGvyqqeASaG5lFDnrZQwK0-8imVJaMbemGX_e5H31n0Tc74ZnTnSHiYwdxoCDgQGWmcFd1vHiTJokDmV6o42ClNS35rm93fQwIIyMhhAK24i0OCdpcCFffn5diRsD2YPHkM3YleUtzlRY7NLotUjTng-v86yjQE05DGIW2z8ii2tP_k_7SPjQLuYezDQTOSFnpxo9fCVMjEvN87eha7IddNoVTcNaEAHBj6QhfLqtJZW0XsMJKDBxmEYg7MoLgYwwNH2JGsX4aChpcRg_uyhKPe8XPrJVe9KZypzcwxCoVVXcwd9xOniq4AbtH3hmPJE-QLd-jqxkjHwkoyLQVHoXKBLx9V5Qb0flF0siEo5WmIuCZzh6zJHPBP6VQlY3a595u-H2JJfBn5JylGijb7itj_1v9Sv6lxWPKYUs8Dhr4bN6HxbHjuh7bGj9wEDdpTBQAppKFlmSpGdxDyDga1IYlNVnZPtuFnbOFQ1CvqZZfUj5o5Wz891dfMVD_8Ay7foKw) · [raw](https://github.com/Catalyst-Forge-LLC/dictawhisper/blob/main/APP_FACTS.md)
- **ToolFacts:** [viewer](https://toolfacts.dev/v#tf1.eNrFlE1v2zAMhv-KoHM-1h2zY4YCA1JgQAfsUBSBKjG2WltyKdppEOS_76XSYB9Yz7kksfiSLx_G1NFOdnUzs8n1ZFf2a_TifraxDMTmbv3d3BNPxHZmA03UZRxDtXbiukMRc5u5IQQhKTEnhD4tbhafcVLEyVhw4LzESTVd9JSKmtx9-4Hnl5gCHno_zMvFhMckURs5WnojP8q5aJe96-YDZ0-lQCbsUhkyC2JFQsz2NLOeKRDSXVc0n-l1jDiyq4dHRKlhzUVAqKOehA9ITjlRZSsSk1O38q6XnLXOw_EymaCT2Z8nsy3k2LeKGQNtabcjLwrL5IJikEMUXrvYUcGgqNdOPcan4USyz_zy2_-djFBih_YJ_qjbD1kAZFfCI0E08pDr_O6ru5kyJmoSRMU8HQxKhjIz4hp8Zjbqrb1_MUwycipmcNIiFhwyLkKXgnGmtBimGZimSHsM8__UDclW7a7FfUsCbKRWaGXWNrzjSqbMY4qvIyKu_IPuO3KJghF6k8qs9B-CdrHItiquRLpBA7VFE5ORlsxzBobrzD4C1GesycfdM3ktes3WE-1Jv-q7uYuM37XzPOiOgQNs9W8I7mCwzA3p6yq4RezpcWbb3NPgGi3XigxltVz-Sbjwua8gsIyS6yZfdA1sxidVLC-31LzeUvPNZv1XlXqPjMljG8IZ4_QLRYvHeA) · [raw](https://github.com/Catalyst-Forge-LLC/dictawhisper/blob/main/TOOL_FACTS.md)

## Capture and Activity

Record opens the compact capture panel and requests the microphone. Stop keeps a draft in the current tab; Save recording sends it, and Discard releases it without saving. Failed saves retain playback, download, and retry. Download unsaved audio before leaving the tab if you need to keep it.

Import accepts multiple WebM, MP3, M4A, WAV, or OGG files up to 80 MiB each, with two simultaneous uploads and per-file outcomes. Saved means the server acknowledged the audio bytes; transcription and cleanup continue separately. Imports never overwrite an existing audio file or sidecar. Stable upload identities let retries reconcile an unknown previous outcome.

Activity shows actual processing stages, sync eligibility deadlines, failures with specific recovery actions, recent completions, and bulk-job progress. Open a newly saved entry there to play it before its transcript is ready. System diagnostics run when expanded or explicitly refreshed. After a server restart, unfinished work appears as Interrupted and requires explicit resume; existing transcripts remain readable. Activity history is stored in an internal `.dictawhisper/activity.json` beneath the configured index's directory. Resumable bulk backfill is tracked separately in the UX upgrade spec.

## MayDo review and backfill

The MayDos view shows entries with Suggested or Selected actions by default. Cards and reader tabs distinguish active actions from all saved actions. Open the MayDos tab to Select, Mark done, Reopen, or Restore an action; More offers every status, and Undo is available for five seconds. Source quote expands to selectable text and Copy; Play source appears only when timing is grounded.

Extract again refreshes suggestions while retaining stable IDs and selected, completed, and dismissed decisions. Out-of-date and failed extraction are explicit. Saved actions remain usable when the optional cleanup model is unavailable.

Use **MayDos → More → Extract from older entries** or **Tools** for backfill. Preview the scope and configured model, then Start. Unchanged entries are skipped by default. Activity and the MayDos view expose progress and recovery. Stop finishes the current entry; Resume continues saved scope; Retry failed processes only failures. Restarted work shows Interrupted and requires explicit Resume. Closing a panel does not stop extraction.

API clients retain `mayDoCount` and numeric `skipped` compatibility. Summaries also expose `mayDoTotalCount`, `mayDoStatusCounts`, and `skipReasons`. `POST /tools/may-dos/backfill` accepts `action: start | stop | resume | retry_failed`, plus `id` for stale-job protection; Start accepts `year` and `refresh`. `GET /notes/may-dos/capabilities` reports configuration availability without calling the model.

## Development

```bash
pnpm test
pnpm typecheck
pnpm build       # compiled runtime and packaged inbox
pnpm site:dev
```

Site (FilePress + docs mount): `pnpm --dir site ship`

## License

MIT · [Catalyst Forge LLC](https://www.catalystforge.com)

[See the rest of the Catalyst Forge shelf.](https://catalystforge.com/tools/)

## Recovery and effective settings

Reader More → Move to Trash waits for a verified whole-entry bundle receipt, then offers eight-second Undo. Settings → Data and maintenance restores later; collisions keep both. Replacement requires a preview and saves the existing bundle in Trash. Assign recording date moves all variants together and records confirmed date provenance. New entries and edits receive stable IDs; explicit legacy backfill is available in maintenance.

Settings shows effective folders, models, processing destinations, search coverage, and MCP configuration. Configuration is read-only here: edit the loaded file and restart. Maintenance includes scoped MayDo extraction, reviewed cleanup retries, tag merge preview/apply, and check-only audio scanning with separate reviewed marking. Help follows search, reading/listening, capture, MayDos, and recovery tasks. On small screens access Help through Settings. No ExoMetaCortex synchronization is active.
