---
title: Install
---

Starting with 0.1.11, the npm package ships compiled JavaScript and the inbox UI. Earlier releases through 0.1.10 do not start from npm installations. The selected transcription engine and its Python runtime remain separate prerequisites. There is no desktop installer.

## Before you clone

| Need | Status |
| --- | --- |
| Node 22.13+ (scripts use `--experimental-strip-types`) and [pnpm](https://pnpm.io) | Required |
| Bark Pro (English, default): isolated Python 3.11 / CUDA 12.8 / BF16 runtime | Required for Bark; run `scripts/setup-bark.ps1` |
| Whisper: Python with [faster-whisper](https://github.com/SYSTRAN/faster-whisper) | Alternative. Set `transcription.model` to `large-v3` or `turbo`, and set `whisper.python` |
| NVIDIA GPU + CUDA | Exercised path on Windows |
| CPU transcription | Bark available but unverified; Whisper slower |
| `ffmpeg` and `ffprobe` on PATH | Required for audio assessment and preparation, including unfiltered mode |
| [ollanet](https://ollanet.dev) + Ollama model | Optional. Raw transcripts still work |
| Windows | Exercised (paths and doctor probes use it) |
| macOS, Linux | Unverified |

Record or drag files at [localhost:7777](http://localhost:7777). Run it on a computer you leave turned on.

## From a checkout

Bash:

```bash
git clone https://github.com/Catalyst-Forge-LLC/dictawhisper.git
cd dictawhisper
cp config.example.json config.json
```

PowerShell: copy the example configuration to the working configuration file, then edit the server settings before starting it.

```powershell
git clone https://github.com/Catalyst-Forge-LLC/dictawhisper.git
cd dictawhisper
Copy-Item config.example.json config.json
```

For the default Bark Pro engine, set up its isolated runtime in PowerShell:

```powershell
& ./scripts/setup-bark.ps1 -Python C:/path/to/Python311/python.exe
```

For Whisper instead, set `transcription.model` to `large-v3` or `turbo` and point `whisper.python` at its interpreter. Once running, select the default in **Settings → Transcription**.

Then, in either shell:

```bash
# configure the selected engine; optionally set ollanet.machine / cleanModel
# watch.roots is optional: record or drop files in the UI without Syncthing
pnpm install
pnpm run doctor
```

Ready signal: doctor exits 0, or only warnings remain. Then `pnpm dev` and open [http://localhost:7777](http://localhost:7777).

The UI can record and accept dropped files with no Syncthing. Add `watch.roots` only if you already have a phone folder or dump directory.

`pnpm run doctor` and startup `/health` run the same probes: Node, config, watch roots, audio tools, the selected transcription engine, ollanet reachability, and port availability. A fail is loud. The inbox still serves notes already on disk. Warnings (CPU mode, ollanet unreachable, port already in use) are reported without blocking. `pnpm doctor` without `run` is pnpm's own command and will not check this app.

Optional sanity check (machine can be this computer or another name ollanet already sees):

```bash
ollanet prompt YOUR-OLLANET-HOST YOUR-CLEAN-MODEL --format json "ping"
```

## Site and docs

This documentation is [dictawhisper.com/docs](https://dictawhisper.com/docs). Product pages live on FilePress; these docs are a path mount at `/docs`.
