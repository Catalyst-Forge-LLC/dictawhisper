# DictaWhisper

Watch a folder of voice notes, transcribe them with [faster-whisper](https://github.com/SYSTRAN/faster-whisper), and clean/tag the text through [ollanet](https://ollanet.dev) on another machine.

Phone recordings can land via Syncthing. A Svelte UI (Socket.IO) can also record or drop files in the browser.

This is a **personal workstation service**. The API binds to `127.0.0.1` by default. Force/delete only accept paths under configured watch roots.

## Pipeline

1. Phone/watch roots: wait until a file has not been written for **30 minutes** (Syncthing-safe; `VOICE_SETTLE_MINUTES` to change)
2. Browser record/drop: process **immediately** (`watch.browserSettleMs`, default 0)
3. Organize `YYYY-MM-DD*` names into `YYYY/MM/`
4. Optional ffmpeg denoise (copies `*_original`, overwrites the working file)
5. faster-whisper → sidecar `.json` (`text`, `segments`)
6. ollanet cleanup → `cleanedTranscription` + `tags` on the same JSON

## Requirements

- Node 20+
- [pnpm](https://pnpm.io)
- NVIDIA GPU + CUDA for local Whisper (or set `whisper.device` to `cpu`)
- Python with `faster-whisper`
- ffmpeg on PATH
- [ollanet](https://ollanet.dev) able to reach the cleanup host

## Setup

```bash
cp config.example.json config.json
# edit watch.roots, whisper.python, ollanet.machine / cleanModel
pnpm install
pnpm run doctor
```

Confirm the cleanup host (use the machine and model from your `config.json`):

```bash
ollanet prompt YOUR-OLLANET-HOST YOUR-CLEAN-MODEL --format json "ping"
```

## Run

```bash
pnpm dev                  # API + UI (UI → http://localhost:7777)
pnpm start                # API only on 127.0.0.1:8008
pnpm turbo                # API with large-v3-turbo (bash)
pnpm ui                   # UI only → http://localhost:7777
```

The UI proxies `/socket.io` and API paths to the server, so open **7777** only.

## HTTP

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | host, queues, whisper model, ollanet target |
| GET | `/status` | pending / raw / done counts |
| POST | `/transcribe/force` | `{ "file": "..." }` retry transcription (allowlisted) |
| POST | `/process/force` | re-run cleanup on an existing note (allowlisted) |

## Config / env

| Env | Meaning |
|---|---|
| `HOST` | bind address (default `127.0.0.1`) |
| `PORT` | API port (default `8008`) |
| `WHISPER_MODEL` | `large-v3` or `turbo` |
| `WHISPER_PYTHON` | python.exe with faster-whisper |
| `VOICE_SETTLE_MINUTES` | phone/watch settle; default 30 |
| `VOICE_BROWSER_SETTLE_MS` | browser-drop settle; default 0 |
| `OLLANET_MACHINE` | ollanet host name |
| `OLLANET_CLEAN_MODEL` | model on that host |
| `OLLAMA_PROMPT_TIMEOUT_MS` | ollanet abort timeout; default 900000 (15m) |

`config.json` is local and gitignored. See `config.example.json`.

## License

MIT
