# DictaWhisper

**[dictawhisper.com](https://dictawhisper.com)** · [GitHub](https://github.com/Catalyst-Forge-LLC/dictawhisper)

**A local voice journal.** Speak into your phone or the browser. DictaWhisper waits until the file is really there, transcribes it on your GPU with [faster-whisper](https://github.com/SYSTRAN/faster-whisper), then turns the raw speech into readable notes and tags on another machine via [ollanet](https://ollanet.dev).

The name is the product: **dicta** (dictation, a dictaphone) plus **Whisper**. Audio stays on your workstation. The sidecar `.json` next to each recording is the source of truth — no database, no cloud account, no “upload to our servers.”

Open the inbox at [http://localhost:7777](http://localhost:7777).

---

## Why it exists

Voice notes are easy to *make* and hard to *keep*. Phone recordings pile up as undated blobs. Cloud speech-to-text wants the audio. Desktop Whisper dumps a wall of “um” and repeated phrases. A journal you will actually reread needs three things at once:

1. **Capture that does not fight your tools** — Syncthing from a phone, or record/drop in the browser.
2. **Transcription that is accurate and local** — `large-v3` on CUDA, names you actually say, word times that survive cleanup.
3. **A note you can use** — cleaned prose, tags, playback that follows the cleaned paragraphs, files you can copy and back up.

DictaWhisper is a **personal workstation service**. The API binds to `127.0.0.1`. File APIs only accept paths under your watch roots. If the cleanup host is asleep, you still get the raw transcript.

---

## Daily loop

1. Talk. A phone app writes into a Syncthing folder, or you record / drop a file in the UI.
2. Phone files **settle for 30 minutes** so Syncthing can finish. Browser files start **immediately**.
3. Dated names (`YYYY-MM-DD…`) are filed into `YYYY/MM/` on **that** watch root. Collisions go to `_holding`. Undated files go to `_unfiled`.
4. Optional ffmpeg denoise. Then a long-lived Whisper worker (model loaded once) writes a sidecar `.json`.
5. ollanet cleans the text and adds tags onto the **same** JSON. Raw speech is kept.
6. The inbox groups notes by month, shows cleaned text by default, and plays audio with cues aligned to those cleaned sections.

```
Phone (Syncthing)  →  watch roots  →  settle 30m  →  YYYY/MM/  ─┐
Browser record/drop →  drop folder →  immediately ─────────────┼─→ whisper → sidecar.json → ollanet → inbox
Force / retranscribe ─────────────────────────────────────────┘
```

---

## What it is good at

**Two clocks, one pipeline.** Syncthing is racy if you transcribe while the file is still growing. Browser drops are not. DictaWhisper uses a long mtime settle on phone/watch roots and a zero settle on the browser folder, then organizes and transcribes the **final** path. No “whisper started, then the file moved.”

**Files are the database.** Each note is `audio` + `audio.json`. You can rsync the tree, open a sidecar in an editor, or point `pnpm retranscribe` at one month. Identity is the path. There is nothing to export.

**Local speech, remote language.** Whisper runs here (CUDA, persistent Python worker). Cleanup is *text* over ollanet to a machine that can host a large instruct model. The recording never has to leave the GPU box. If ollanet is down, doctor and `/health` say so; raw mode still works.

**A transcript you can listen through.** Cleanup is allowed to drop fillers and collapse ASR loops, but playback cues are aligned back to Whisper **word timestamps**, not guessed from bag-of-words. Copy uses the same sections the player shows.

**Names you actually say.** `whisper.promptTerms` (a person, a company, a street) go into Whisper’s initial prompt. Preferred tags from your existing inventory are fed into cleanup so the model does not invent a new spelling every week. A consolidate preview/apply pass merges near-duplicates when you ask.

**Honest first run.** `pnpm run doctor` and startup `/health` probe the same things: Node, config, watch roots, ffmpeg, `faster-whisper` import, CUDA vs CPU, ollanet reachability, port bind. Failures refuse to start queues. Warnings (CPU, ollanet asleep, port already in use) are labeled, not hidden.

**Batch without reloading the model.** `pnpm retranscribe --dir=… --limit=5 --reclean` walks newest-first, keeps the worker warm, and can rewrite words/times without throwing away cleaned text unless you ask.

---

## Inbox

The UI is a journal, not a file manager dump.

- Year / month groups; **Holding** and **Unfiled** stay visible
- Cleaned text by default; raw segments on a toggle
- Tag cloud (frequent tags, optional singletons) and filter
- Expand loads the full sidecar (`GET /note`) so a thousand notes do not hit the wire at once
- Older months load as you scroll
- Playback follows cleaned paragraphs
- Tag consolidate: local clusters, optional model synonyms, preview then apply

---

## Requirements

- Node 20+ and [pnpm](https://pnpm.io)
- NVIDIA GPU + CUDA for local Whisper (or set `whisper.device` to `cpu` and wait)
- Python with [`faster-whisper`](https://github.com/SYSTRAN/faster-whisper) — point `whisper.python` at that interpreter
- `ffmpeg` on PATH if denoise is on
- [ollanet](https://ollanet.dev) able to reach the cleanup host (optional for raw transcripts)

This is meant to live on a desktop you already leave on. A phone is just a microphone plus Syncthing.

---

## Setup

```bash
cp config.example.json config.json
# edit watch.roots, whisper.python, whisper.promptTerms,
#      ollanet.machine / cleanModel
pnpm install
pnpm run doctor
```

`config.json` is gitignored. Three things matter on a new machine: where audio lands, which Python has CUDA Whisper, and which ollanet host/model cleans the text.

Optional sanity check of the cleanup host (use the values from your config):

```bash
ollanet prompt YOUR-OLLANET-HOST YOUR-CLEAN-MODEL --format json "ping"
```

---

## Run

```bash
pnpm dev     # API + UI  →  http://localhost:7777
pnpm start   # API only on 127.0.0.1:8008
pnpm ui      # UI only
pnpm turbo   # API with large-v3-turbo (bash)
```

The UI proxies `/socket.io` and API paths, so open **7777** only. API stays on `127.0.0.1:8008`.

```bash
pnpm retranscribe                              # newest first, skip notes that already have word times
pnpm retranscribe --dir="D:\VoiceNotes\2026\08" --limit=5 --reclean
pnpm retranscribe --force                      # rewrite Whisper even if words exist
```

`--reclean` runs ollanet again after the new transcript. Without it, cleaned text and tags are kept; only words/times/raw text update.

---

## HTTP

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Shared doctor report, queues, Whisper worker, ollanet reachability (`?fresh=1` to skip cache) |
| GET | `/status` | pending / raw / done counts |
| GET | `/notes/index` | Inbox summaries (path, dates, tags, preview) |
| GET | `/note?file=` | Full sidecar (allowlisted) |
| GET | `/audio?file=` | Stream allowlisted audio (sidecar or audio path) |
| POST | `/transcribe/force` | `{ "file": "..." }` retry transcription |
| POST | `/process/force` | Re-run cleanup on an existing note |
| POST | `/tags/consolidate/preview` | Merge plan (`useModel`, default true) |
| POST | `/tags/consolidate/apply` | `{ "groups": [{ "keep", "drop" }] }` |

Force/delete/read only accept realpaths under configured watch roots.

---

## Config and env

| Env | Meaning |
|---|---|
| `HOST` / `PORT` | API bind (default `127.0.0.1:8008`) |
| `WHISPER_MODEL` | `large-v3` or `turbo` |
| `WHISPER_PYTHON` | Interpreter with faster-whisper |
| `WHISPER_DEVICE` | `cuda` or `cpu` |
| `VOICE_SETTLE_MINUTES` | Phone/watch settle; default 30 |
| `VOICE_BROWSER_SETTLE_MS` | Browser-drop settle; default 0 |
| `OLLANET_MACHINE` / `OLLANET_CLEAN_MODEL` | Cleanup host and model |
| `OLLAMA_PROMPT_TIMEOUT_MS` | ollanet abort; default 900000 (15m) |

Useful `config.json` knobs (see `config.example.json`):

- `watch.createMissingRoots` — create empty watch roots instead of failing doctor
- `whisper.promptTerms` — names and terms Whisper should prefer
- `whisper.computeType` — `float16`, or `int8_float16` if VRAM is tight
- `audio.preprocess` — ffmpeg denoise
- `queues.*.concurrency` — keep transcription at 1 on a single GPU

---

## License

MIT
