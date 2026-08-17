---
title: Install
description: Clone DictaWhisper, point it at your GPU, then record or drop files in the inbox.
order: 1
---

This is a **personal workstation service**, not an npm global. It wants a desktop you already leave on, a Python with [faster-whisper](https://github.com/SYSTRAN/faster-whisper), and optionally [ollanet](https://ollanet.dev) talking to Ollama — on this machine or another.

Requires **Node.js 20+**, [pnpm](https://pnpm.io), and `ffmpeg` on PATH if denoise is on. CUDA is the happy path; `whisper.device=cpu` works and is slow.

### Clone and doctor

```bash
git clone https://github.com/Catalyst-Forge-LLC/dictawhisper.git
cd dictawhisper
cp config.example.json config.json
# edit whisper.python, whisper.promptTerms, ollanet.machine / cleanModel
# watch.roots is optional — the inbox can record and accept drops on its own
pnpm install
pnpm run doctor
pnpm dev
```

Inbox: [http://localhost:7777](http://localhost:7777). The UI proxies the API, so open **7777** only.

`config.json` is gitignored. The inbox can record and accept dropped files with no Syncthing and no extra watch roots. Add `watch.roots` only if you already have a phone folder or dump directory. Then: which Python has CUDA Whisper, and which Ollama ollanet should use (this computer or another name it already sees).

### Confirm cleanup (optional)

```bash
ollanet prompt YOUR-OLLANET-HOST YOUR-CLEAN-MODEL --format json "ping"
```

Localhost is a valid host. If that Ollama is down, raw transcripts still write. Doctor will warn.

### Inbox on Tailscale

On the workstation, set `"http": { "tailscale": true }` (or `DICTA_TAILSCALE=1`) and restart `pnpm dev`. Doctor prints `http://<machine>.<tailnet>.ts.net:7777`. Open that from a phone signed into the same Tailscale. There is no login on the app — the tailnet is the door.

### Retranscribe

```bash
pnpm retranscribe
pnpm retranscribe --dir="D:\VoiceNotes\2026\08" --limit=5 --reclean
pnpm retranscribe --force
```

Newest first. Without `--reclean`, cleaned text and tags stay; only words, times, and raw text update. The Whisper worker stays loaded across the batch.

### What doctor checks

Node, config parse, watch roots, ffmpeg, `faster-whisper` import, CUDA vs CPU, ollanet reachability, API port. Failures block queues. CPU or a sleeping cleanup host is a warning, not a crash.

Full HTTP table, env vars, and sidecar shape: [README on GitHub](https://github.com/Catalyst-Forge-LLC/dictawhisper#readme).
