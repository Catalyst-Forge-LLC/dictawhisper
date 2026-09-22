---
title: Config
---

Copy `config.example.json` to `config.json` (gitignored).

## Env

| Env | Meaning |
|---|---|
| `HOST` / `PORT` | API bind (default `127.0.0.1:8008`; Tailscale mode does not change this) |
| `DICTA_TAILSCALE` | `1` / `true`: also bind the inbox to this machine's Tailscale address |
| `WHISPER_MODEL` | `large-v3` or `turbo` |
| `WHISPER_PYTHON` | Interpreter with faster-whisper |
| `WHISPER_DEVICE` | `cuda` or `cpu` |
| `VOICE_SETTLE_MINUTES` | Phone/watch settle; default 30 |
| `VOICE_BROWSER_SETTLE_MS` | Browser-drop settle; default 0 |
| `OLLANET_MACHINE` / `OLLANET_CLEAN_MODEL` | Cleanup host and model |
| `DICTA_EMBED_HOST` | Overrides `journal.embedHost` |
| `DICTA_EMBED_MODEL` | Overrides `journal.embedModel` |
| `OLLAMA_PROMPT_TIMEOUT_MS` | ollanet abort; default 900000 (15m) |

## `config.json`

Useful knobs (see `config.example.json`):

- `watch.createMissingRoots`: create empty watch roots instead of failing doctor
- `whisper.promptTerms`: names and terms Whisper should prefer
- `whisper.computeType`: `float16`, or `int8_float16` if VRAM is tight
- `audio.preprocess`: ffmpeg denoise
- `queues.*.concurrency`: keep transcription at 1 on a single GPU
- `http.tailscale`: bind the inbox to this machine's Tailscale address and allow those origins for the UI
- `ollanet.required`: treat missing cleanup host/model as a failure (default false; raw transcripts still work)
- `journal.search`: `hybrid` (default), `semantic`, or `lex`. `lex` matches words only and never embeds note text.
- `journal.embedModel`: embedding model name. Empty picks the first embed-class model on an allowed host.
- `journal.embedHost`: where search indexing may send note text (up to 8,000 characters per note) to embed it.
  - `local` (default): this computer only.
  - `machine`: the `ollanet.machine` host, matched the same way cleanup matches it. If `ollanet.machine` is empty, nothing is embedded.
  - a host name: that one ollanet host (or alias, or address).
  - `any`: this computer first, then any host ollanet discovers from its config, `OLLANET_HOSTS`, or Tailscale.

  If no allowed host has an embedding model, search falls back to words only. `pnpm run doctor` and the inbox Tools panel show a `journal-search` check that says so and why.

## Where text goes

Audio and transcript files stay on this computer. Cleanup sends transcript text only to `ollanet.machine`. Search indexing embeds note text on this computer unless you set `journal.embedHost` to another host.
