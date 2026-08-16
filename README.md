# DictaWhisper

Watch a folder of voice notes, transcribe them with [faster-whisper](https://github.com/SYSTRAN/faster-whisper), and clean/tag the text through [ollanet](https://ollanet.dev) on another machine.

Phone recordings can land via Syncthing. A Svelte UI (Socket.IO) can also record or drop files in the browser.

## Pipeline

1. Wait until a file has not been written for **30 minutes** (Syncthing-safe; `VOICE_SETTLE_MINUTES` to change)
2. Organize `YYYY-MM-DD*` names into `YYYY/MM/`
3. Optional ffmpeg denoise (copies `*_original`, overwrites the working file)
4. faster-whisper → sidecar `.json` (`text`, `segments`)
5. ollanet cleanup → `cleanedTranscription` + `tags` on the same JSON

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
pnpm --dir client install
```

Confirm the cleanup host:

```bash
ollanet prompt YOUR-OLLANET-HOST YOUR-CLEAN-MODEL --format json "ping"
```

## Run

```bash
pnpm start                 # large-v3 (default)
pnpm turbo                 # large-v3-turbo
pnpm ui                    # Svelte client → http://localhost:5173
```

## HTTP

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | queues, whisper model, ollanet target |
| GET | `/status` | pending / raw / done counts |
| POST | `/transcribe/force` | `{ "file": "C:\\\\path\\\\note.mp3" }` skip settle |
| POST | `/process/force` | re-run cleanup on an existing note |

## Config / env

| Env | Meaning |
|---|---|
| `WHISPER_MODEL` | `large-v3` or `turbo` |
| `WHISPER_PYTHON` | python.exe with faster-whisper |
| `VOICE_SETTLE_MINUTES` | default 30 |
| `OLLANET_MACHINE` | ollanet host name |
| `OLLANET_CLEAN_MODEL` | model on that host |

## License

MIT
