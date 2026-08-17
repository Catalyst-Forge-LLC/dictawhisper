<p align="center">
  <img src="site/static/logo.png" alt="DictaWhisper logo" width="128" />
</p>

# DictaWhisper

**[dictawhisper.com](https://dictawhisper.com)** · [GitHub](https://github.com/Catalyst-Forge-LLC/dictawhisper)

**A local voice journal.** Record in the browser, drop a file, or (optionally) sync a phone folder. DictaWhisper transcribes on your GPU with [faster-whisper](https://github.com/SYSTRAN/faster-whisper), then turns the raw speech into readable notes and tags via [ollanet](https://ollanet.dev) on localhost or another box with a cleanup model.

The name is **dicta** (dictation, a dictaphone) plus **Whisper**. Audio stays on this computer. The `.json` next to each recording is the note: no database, no account.

Open the UI at [http://localhost:7777](http://localhost:7777). On Tailscale, the same page is reachable from your phone.

---

## Why it exists

Voice notes are easy to make and hard to keep. Phone recordings pile up as undated blobs. Cloud speech-to-text wants the audio. Desktop Whisper dumps a wall of filler words and repeated phrases. A journal you can reread needs three things:

1. **Capture that fits your tools:** record or drop a file in the browser. Syncthing from a phone is optional.
2. **Accurate, local transcription:** `large-v3` on CUDA, a prompt seeded with your own vocabulary, word times that survive cleanup.
3. **Usable notes:** cleaned prose, tags, playback that follows the cleaned paragraphs, files you can copy and back up.

By default the API binds to `127.0.0.1`. Turn on `http.tailscale` and the UI listens on your tailnet so a phone or laptop on the same Tailscale can open it. File APIs only accept paths under your watch roots. If cleanup is unavailable, you still get the raw transcript.

---

## Daily loop

1. Talk. Hit Record, or drag an audio file onto the page.
2. Browser files start immediately. Optional ffmpeg denoise, then Whisper (model loaded once) writes a sidecar `.json`.
3. ollanet cleans the text and adds tags onto the same JSON. Raw speech is kept.
4. Notes are grouped by month. Cleaned text is the default; raw speech is one click away. Playback follows the cleaned paragraphs.

If you also watch a phone folder ([Syncthing](https://syncthing.net) or any folder sync), those files wait 30 minutes after the last write so the transfer can finish, then dated names are filed into `YYYY/MM/` on that watch root.

```
Browser record/drop →  drop folder →  immediately ─────────────┐
Optional phone folder →  watch roots  →  settle 30m  →  YYYY/MM/ ┼─→ whisper → sidecar.json → ollanet → UI
Force / retranscribe ─────────────────────────────────────────┘
```

---

## What it is good at

**Files are the database.** Each note is `audio` + `audio.json`. You can rsync the tree, open a sidecar in an editor, or point `pnpm retranscribe` at one month. The file path is the note's identity, so there is nothing to export.

**The Whisper model stays loaded.** The worker loads the model once and keeps it for the next file. That is the normal path, not a special command.

**Audio never leaves this computer.** Faster-whisper runs here. If you point ollanet at Ollama on another machine on your own network, only the transcript text crosses the network. If ollanet is unreachable, doctor and `/health` report it and you still have the raw words.

**UI on the tailnet.** Default bind is localhost. Set `http.tailscale` (or `DICTA_TAILSCALE=1`) and `pnpm dev` advertises `http://<magicdns>:7777` / `http://<100.x>:7777` so you can read and record from a phone on the same Tailscale. Nothing is published to the public internet, and the app adds no login of its own; tailnet membership is the access control.

**Playback aligned to word timestamps.** Cleanup drops fillers and collapses repeated phrases, but playback cues map back to Whisper word timestamps rather than being inferred from the cleaned wording. Copy uses the same sections the player shows.

**Custom vocabulary and stable tags.** `whisper.promptTerms` (a person, a company, a street) go into Whisper's initial prompt. Tags already in your inventory are fed into cleanup so the model does not spell them a new way every week, and a consolidate preview/apply pass merges near-duplicates when you ask.

---

## Privacy and network boundary

- **No telemetry.** Nothing contacts an external analytics or telemetry service.
- **Audio stays here.** Faster-whisper processes files on this GPU or CPU.
- **Text only, and only on your network.** If cleanup runs on another machine you already use, only the transcript text is sent there.
- **Loopback by default.** API (`8008`) and UI (`7777`) bind to `127.0.0.1`. They listen on `0.0.0.0` only if you turn on `http.tailscale`.
- **Path allowlisting.** File routes resolve realpaths and reject anything outside `watch.roots` and `browserDropFolder` with a `403`.

---

## Requirements

- Node 20+ and [pnpm](https://pnpm.io)
- NVIDIA GPU + CUDA for local Whisper (or set `whisper.device` to `cpu`, which is far slower)
- Python with [`faster-whisper`](https://github.com/SYSTRAN/faster-whisper): point `whisper.python` at that interpreter
- `ffmpeg` on PATH if denoise is on
- [ollanet](https://ollanet.dev) + an Ollama model for cleanup (localhost or another reachable host; optional for raw transcripts)
- Optional: [Tailscale](https://tailscale.com) if you want the UI from another device on your tailnet
- Optional: a watched folder ([Syncthing](https://syncthing.net), a shared drive, a dump directory) if you already record outside the browser

Record or drag files at [localhost:7777](http://localhost:7777). Run it on a computer you leave turned on.

---

## Setup

```bash
cp config.example.json config.json
# edit whisper.python, whisper.promptTerms, ollanet.machine / cleanModel
# watch.roots is optional: record or drop files in the UI without Syncthing
pnpm install
pnpm run doctor
```

The UI can record and accept dropped files with no Syncthing. Add `watch.roots` only if you already have a phone folder or dump directory. Then: which Python has CUDA Whisper, and which Ollama (this computer or another on your network) ollanet should use for cleanup.

`pnpm run doctor` and startup `/health` run the same probes: Node, config, watch roots, ffmpeg, `faster-whisper` import, CUDA vs CPU, ollanet reachability, and port availability. Failures refuse to start queues. Warnings (CPU mode, ollanet unreachable, port already in use) are reported without blocking startup.

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

To reach the UI from a phone on your Tailscale:

```json
"http": { "tailscale": true }
```

or `DICTA_TAILSCALE=1`. Doctor and startup print the MagicDNS / `100.x` URL. There is still no login: only devices on that tailnet should be able to open it.

`pnpm retranscribe` is for a pile of existing notes, or when a transcript went wrong. Newest first; notes that already have word times are skipped unless you pass `--force`.

```bash
pnpm retranscribe
pnpm retranscribe --dir="./notes/2026/08" --limit=5 --reclean
pnpm retranscribe --force
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
- `http.tailscale`: bind beyond localhost and allow Tailscale origins for the UI
- `ollanet.required`: treat missing cleanup host/model as a failure (default false; raw transcripts still work)

---

## Site

Marketing site (FilePress): [`site/`](site/). `pnpm site:dev` / `pnpm site:build` / `pnpm ship`. Live: [dictawhisper.com](https://dictawhisper.com). Page copy follows [aiBreze](https://aibreze.com); see [`docs/aibreze-overlay.md`](docs/aibreze-overlay.md).

## License

MIT
