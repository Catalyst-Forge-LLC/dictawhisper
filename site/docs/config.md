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
