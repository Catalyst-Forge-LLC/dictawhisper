---
title: Install
---

The npm package is a name hold (`dictawhisper` `0.0.10`). Clone this repo. There is no desktop installer.

## Before you clone

| Need | Status |
| --- | --- |
| Node 20+ and [pnpm](https://pnpm.io) | Required |
| Python with [`faster-whisper`](https://github.com/SYSTRAN/faster-whisper) | Required. Set `whisper.python` |
| NVIDIA GPU + CUDA, `whisper.device` = `cuda` | Exercised path |
| `whisper.device` = `cpu` | Supported, slow, doctor warning |
| `ffmpeg` on PATH | Required when denoise (`audio.preprocess`) is on |
| [ollanet](https://ollanet.dev) + Ollama model | Optional. Raw transcripts still work |
| Windows | Exercised (paths and doctor probes use it) |
| macOS, Linux | Unverified |

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

Ready signal: doctor exits 0, or only warnings remain. Then `pnpm dev` and open [http://localhost:7777](http://localhost:7777).

The UI can record and accept dropped files with no Syncthing. Add `watch.roots` only if you already have a phone folder or dump directory.

`pnpm run doctor` and startup `/health` run the same probes: Node, config, watch roots, ffmpeg, `faster-whisper` import, CUDA vs CPU, ollanet reachability, and port availability. A fail is loud. The inbox still serves notes already on disk. Warnings (CPU mode, ollanet unreachable, port already in use) are reported without blocking. `pnpm doctor` without `run` is pnpm's own command and will not check this app.

Optional sanity check (machine can be this computer or another name ollanet already sees):

```bash
ollanet prompt YOUR-OLLANET-HOST YOUR-CLEAN-MODEL --format json "ping"
```

## Site and docs

This documentation is [dictawhisper.com/docs](https://dictawhisper.com/docs). Product pages live on FilePress; these docs are a path mount at `/docs`.
