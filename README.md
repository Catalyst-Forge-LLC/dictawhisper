<p align="center">
  <img src="site/static/logo.png" alt="DictaWhisper logo" width="128" />
</p>

# DictaWhisper

**[dictawhisper.com](https://dictawhisper.com)** · [GitHub](https://github.com/Catalyst-Forge-LLC/dictawhisper)

**A local voice journal.** Record in the browser, drop a file, or (optionally) sync a phone folder. DictaWhisper transcribes on your GPU with [faster-whisper](https://github.com/SYSTRAN/faster-whisper), then turns the raw speech into readable notes and tags via [ollanet](https://ollanet.dev) on localhost or another box with a cleanup model.

The name is the product: **dicta** (dictation, a dictaphone) plus **Whisper**. Audio stays on your workstation. The sidecar `.json` next to each recording is the source of truth: no database, no cloud account, no external servers.

Open the inbox at [http://localhost:7777](http://localhost:7777). On Tailscale, the same inbox is reachable from your phone.

---

## Why it exists

Voice notes are easy to make and hard to keep. Phone recordings pile up as undated blobs. Cloud speech-to-text wants the audio. Desktop Whisper dumps a wall of filler words and repeated phrases. A journal you can reread needs three things:

1. **Capture that fits your tools:** record or drop a file in the browser. Syncthing from a phone is optional.
2. **Accurate, local transcription:** `large-v3` on CUDA, names you actually say, word times that survive cleanup.
3. **Usable notes:** cleaned prose, tags, playback that follows the cleaned paragraphs, files you can copy and back up.

DictaWhisper is a **personal workstation service**. By default the API binds to `127.0.0.1`. Turn on `http.tailscale` and the inbox listens on your tailnet so a phone or laptop on the same Tailscale can open it. File APIs only accept paths under your watch roots. If cleanup is asleep, you still get the raw transcript.

---

## Daily loop

1. Talk. Hit Record in the inbox, or drag an audio file onto the page.
2. Browser files start **immediately**. If you also watch a phone folder (Syncthing is optional), those files **settle for 30 minutes** so the transfer can finish.
3. Dated names (`YYYY-MM-DD…`) are filed into `YYYY/MM/` on **that** watch root. Collisions go to `_holding`. Undated files go to `_unfiled`.
4. Optional ffmpeg denoise. Then a long-lived Whisper worker (model loaded once) writes a sidecar `.json`.
5. ollanet cleans the text and adds tags onto the **same** JSON. Raw speech is kept.
6. The inbox groups notes by month, shows cleaned text by default, and plays audio with cues aligned to those cleaned sections.

```
Browser record/drop →  drop folder →  immediately ─────────────┐
Optional phone folder →  watch roots  →  settle 30m  →  YYYY/MM/ ┼─→ whisper → sidecar.json → ollanet → inbox
Force / retranscribe ─────────────────────────────────────────┘
```

---

## What it is good at

**Two clocks, one pipeline.** The browser path has no wait. Folder sync (via Syncthing or any sync tool) can fail if transcription starts while the file is still transferring, so watched roots settle for 30 minutes before organizing and transcribing the final path.

**Files are the database.** Each note is `audio` + `audio.json`. You can rsync the tree, open a sidecar in an editor, or point `pnpm retranscribe` at one month. Identity is the path. There is nothing to export.

**Whisper here; cleanup wherever it is best.** Faster-whisper stays on this GPU. [ollanet](https://ollanet.dev) finds Ollama on localhost and across your network. Put the instruct model on this box or on a quieter machine: that is a quality choice, not an architecture requirement. Cleanup sends text, not audio. If ollanet is down, doctor and `/health` report it; raw mode still works.

**Inbox on the tailnet.** Default bind is localhost. Set `http.tailscale` (or `DICTA_TAILSCALE=1`) and `pnpm dev` advertises `http://<magicdns>:7777` / `http://<100.x>:7777` so you can read and record from a phone that is on the same Tailscale. Still no public internet, still no auth: the mesh is the door.

**A transcript you can listen through.** Cleanup drops fillers and collapses loops, but playback cues align back to Whisper **word timestamps**, not guessed from bag-of-words. Copy uses the same sections the player shows.

**Names you actually say.** `whisper.promptTerms` (a person, a company, a street) go into Whisper’s initial prompt. Preferred tags from your existing inventory are fed into cleanup so the model does not invent a new spelling every week. A consolidate preview/apply pass merges near-duplicates when you ask.

**Explicit checkup.** `pnpm run doctor` and startup `/health` probe the same things: Node, config, watch roots, ffmpeg, `faster-whisper` import, CUDA vs CPU, ollanet reachability, and port availability. Failures refuse to start queues. Warnings (CPU mode, ollanet asleep, port already in use) are labeled clearly.

**Batch without reloading the model.** `pnpm retranscribe --dir=… --limit=5 --reclean` walks newest-first, keeps the worker warm, and can rewrite words/times without throwing away cleaned text unless you ask.

---

## Inbox

The UI is a journal, not a file manager dump.

- Year / month groups; **Holding** and **Unfiled** stay visible
- Cleaned text by default; raw segments on a toggle
- Search (filename, tags, cleaned and raw text) plus tag-chip AND filter
- Expand loads the full sidecar (`GET /note`) so a thousand notes do not hit the wire at once
- Older months load as you scroll
- Playback follows cleaned paragraphs
- Tag consolidate: local clusters, optional model synonyms, preview then apply

---

## Privacy and network boundary

DictaWhisper is built to run on a private workstation without cloud dependencies:

- **Zero telemetry or analytics:** Nothing pings an external telemetry server or cloud service.
- **Audio stays local:** Faster-whisper processes audio files directly on your GPU or CPU. Audio never leaves the machine.
- **Cleanup sends text, not audio:** If ollanet is configured, only the raw transcript text is sent to your designated Ollama host (localhost or your private network).
- **Strict loopback default:** API (`8008`) and UI (`7777`) bind to `127.0.0.1`. They only listen on `0.0.0.0` if you explicitly turn on `http.tailscale`.
- **Path allowlisting:** Every HTTP route that touches the filesystem resolves realpaths and rejects any path outside configured `watch.roots` and `browserDropFolder` with a `403`.

---

## Requirements

- Node 20+ and [pnpm](https://pnpm.io)
- NVIDIA GPU + CUDA for local Whisper (or set `whisper.device` to `cpu` and wait)
- Python with [`faster-whisper`](https://github.com/SYSTRAN/faster-whisper) — point `whisper.python` at that interpreter
- `ffmpeg` on PATH if denoise is on
- [ollanet](https://ollanet.dev) + an Ollama model for cleanup (localhost or another reachable host; optional for raw transcripts)
- Optional: [Tailscale](https://tailscale.com) if you want the inbox from another device on your tailnet
- Optional: a watched folder ([Syncthing](https://syncthing.net), a shared drive, a dump directory) if you already record outside the browser

The inbox alone is enough: record or drag files at [localhost:7777](http://localhost:7777). This is meant to live on a desktop you already leave on.

---

## Setup

```bash
cp config.example.json config.json
# edit whisper.python, whisper.promptTerms, ollanet.machine / cleanModel
# watch.roots is optional: record or drop files in the inbox without Syncthing
pnpm install
pnpm run doctor
```

`config.json` is gitignored. The inbox can record and accept dropped files with no Syncthing. Add `watch.roots` only if you already have a phone folder or dump directory. Then: which Python has CUDA Whisper, and which Ollama (local or remote) ollanet should use for cleanup.

Optional sanity check (machine can be this computer or another name ollanet already sees):

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

The UI proxies `/socket.io` and API paths, so open **7777** only. API defaults to `127.0.0.1:8008`.

To reach the inbox from a phone on your Tailscale:

```json
"http": { "tailscale": true }
```

or `DICTA_TAILSCALE=1`. Doctor and startup print the MagicDNS / `100.x` URL. There is still no login: only devices on that tailnet should be able to open it.

```bash
pnpm retranscribe                              # newest first, skip notes that already have word times
pnpm retranscribe --dir="./notes/2026/08" --limit=5 --reclean
pnpm retranscribe --force                      # rewrite Whisper even if words exist
```

`--reclean` runs ollanet again after the new transcript. Without it, cleaned text and tags are kept; only words/times/raw text update.

---

## HTTP

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Shared doctor report, queues, Whisper worker, ollanet reachability (`?fresh=1` to skip cache) |
| GET | `/status` | pending / raw / done counts |
| GET | `/notes/index` | Inbox summaries (path, tags, preview, search body) |
| GET | `/note?file=` | Full sidecar (allowlisted) |
| GET | `/audio?file=` | Stream allowlisted audio (sidecar or audio path) |
| POST | `/audio` | Multipart `file` (or `audio`) + optional `clipName` → drop folder, process immediately |
| POST | `/transcribe/force` | `{ "file": "..." }` retry transcription |
| POST | `/process/force` | Re-run cleanup on an existing note |
| POST | `/process/skip` | Leave the raw transcript; skip later cleanup |
| POST | `/holding/resolve` | `{ "file", "action": "overwrite" \| "rename" \| "unfile" }` |
| POST | `/tags/consolidate/preview` | Merge plan (`useModel`, default true) |
| POST | `/tags/consolidate/apply` | `{ "groups": [{ "keep", "drop" }] }` |

Force/delete/read only accept realpaths under configured watch roots.

---

## Config and env

| Env | Meaning |
|---|---|
| `HOST` / `PORT` | API bind (default `127.0.0.1:8008`; Tailscale mode listens on `0.0.0.0`) |
| `DICTA_TAILSCALE` | `1` / `true`: expose UI + API on the tailnet |
| `WHISPER_MODEL` | `large-v3` or `turbo` |
| `WHISPER_PYTHON` | Interpreter with faster-whisper |
| `WHISPER_DEVICE` | `cuda` or `cpu` |
| `VOICE_SETTLE_MINUTES` | Phone/watch settle; default 30 |
| `VOICE_BROWSER_SETTLE_MS` | Browser-drop settle; default 0 |
| `OLLANET_MACHINE` / `OLLANET_CLEAN_MODEL` | Cleanup host and model |
| `OLLAMA_PROMPT_TIMEOUT_MS` | ollanet abort; default 900000 (15m) |

Useful `config.json` knobs (see `config.example.json`):

- `watch.createMissingRoots`: create empty watch roots instead of failing doctor
- `whisper.promptTerms`: names and terms Whisper should prefer
- `whisper.computeType`: `float16`, or `int8_float16` if VRAM is tight
- `audio.preprocess`: ffmpeg denoise
- `queues.*.concurrency`: keep transcription at 1 on a single GPU
- `http.tailscale`: bind beyond localhost and allow Tailscale origins for the inbox
- `ollanet.required`: treat missing cleanup host/model as a failure (default false; raw transcripts still work)

---

## Site

Marketing site (FilePress): [`site/`](site/). `pnpm site:dev` / `pnpm site:build` / `pnpm ship`. Live: [dictawhisper.com](https://dictawhisper.com). Page copy follows [aiBreze](https://aibreze.com); see [`docs/aibreze-overlay.md`](docs/aibreze-overlay.md).

## License

MIT
