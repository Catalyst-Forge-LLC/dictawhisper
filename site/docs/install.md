---
title: Install
---

Requires **Node 20+** and [pnpm](https://pnpm.io).

- NVIDIA GPU + CUDA for local Whisper (or set `whisper.device` to `cpu`, which is far slower)
- Python with [`faster-whisper`](https://github.com/SYSTRAN/faster-whisper): point `whisper.python` at that interpreter
- `ffmpeg` on PATH if denoise is on
- [ollanet](https://ollanet.dev) + an Ollama model for cleanup (localhost or another reachable host; optional for raw transcripts)
- Optional: [Tailscale](https://tailscale.com) if you want the UI from another device on your tailnet
- Optional: a watched folder ([Syncthing](https://syncthing.net), a shared drive, a dump directory) if you already record outside the browser

Record or drag files at [localhost:7777](http://localhost:7777). Run it on a computer you leave turned on.

## From a checkout

```bash
git clone https://github.com/Catalyst-Forge-LLC/dictawhisper.git
cd dictawhisper
cp config.example.json config.json
# edit whisper.python, whisper.promptTerms, ollanet.machine / cleanModel
# watch.roots is optional: record or drop files in the UI without Syncthing
pnpm install
pnpm run doctor
```

The UI can record and accept dropped files with no Syncthing. Add `watch.roots` only if you already have a phone folder or dump directory. Then: which Python has CUDA Whisper, and which Ollama (this computer or another on your network) ollanet should use for cleanup.

`pnpm run doctor` and startup `/health` run the same probes: Node, config, watch roots, ffmpeg, `faster-whisper` import, CUDA vs CPU, ollanet reachability, and port availability. A fail is loud. The inbox still serves notes already on disk. Warnings (CPU mode, ollanet unreachable, port already in use) are reported without blocking. `pnpm doctor` without `run` is pnpm's own command and will not check this app.

Optional sanity check (machine can be this computer or another name ollanet already sees):

```bash
ollanet prompt YOUR-OLLANET-HOST YOUR-CLEAN-MODEL --format json "ping"
```

## Site and docs

This documentation is [dictawhisper.com/docs](https://dictawhisper.com/docs). Product pages live on FilePress; these docs are a path mount at `/docs`.
