---
title: Install
description: Hardware and runtimes first, then a git clone. The npm path requires version 0.1.11 or later.
order: 1
---

You run this on a computer you leave turned on. It is not a website that holds your audio. There is no installer. Starting with 0.1.11, the npm package ships compiled JavaScript and the inbox UI. Earlier releases through 0.1.10 do not start from npm installations. The selected transcription engine and its Python runtime remain separate prerequisites.

## Before you clone

Exercised path: **Windows**, **Node 22.13+**, **pnpm**, and an **NVIDIA GPU with CUDA**. The checkout scripts use Node's TypeScript support. macOS and Linux remain unverified.

Choose the transcription engine:

- **Bark Pro (English, default):** isolated Python 3.11 / CUDA 12.8 / BF16 runtime. Set it up with the repository's PowerShell script below. CPU mode is available but unverified.
- **Whisper:** Python with [faster-whisper](https://github.com/SYSTRAN/faster-whisper). Set `transcription.model` to `large-v3` or `turbo` and point `whisper.python` at that interpreter. Whisper CPU mode is slower.

Both paths require **ffmpeg and ffprobe** for audio assessment and preparation, including unfiltered mode. Cleanup through [ollanet](https://ollanet.dev) is optional; without it, raw transcripts remain available.

## Get it running

```bash
git clone https://github.com/Catalyst-Forge-LLC/dictawhisper.git
cd dictawhisper
cp config.example.json config.json
pnpm install
# Set up the default Bark Pro engine in PowerShell, using your Python 3.11 path:
# & ./scripts/setup-bark.ps1 -Python C:/path/to/Python311/python.exe
# For Whisper instead, configure transcription.model and whisper.python.
pnpm run doctor
pnpm dev
```

Ready signal: `pnpm run doctor` exits 0, or prints only warnings (CPU mode, ollanet unreachable, port already in use). Then open [http://localhost:7777](http://localhost:7777). Record, or drag a file onto the page. Once the engines are configured, change the default in **Settings → Transcription**.

`pnpm run doctor` is the checkup. `pnpm doctor` without `run` is pnpm's own command and will not check this app.

If cleanup cannot be reached, that is a warning. Notes still get written. See [Install docs](/docs/install) for the probe list.

## Optional: sync a phone folder

If you already record on your phone, install [Syncthing](https://syncthing.net) (or any folder sync tool) on both devices and share a folder to your workstation.

Add that directory to `"roots"` in `config.json`:

```json
"watch": {
  "roots": ["C:\\Users\\YOU\\VoiceNotes"]
}
```

Files arriving via folder sync wait 30 minutes after the last write before organizing into `YYYY/MM/` and transcribing, so recordings never process mid-transfer. This is external folder synchronization, not a DictaWhisper service.

## Optional: read from your phone on Tailscale

If you want to open the inbox from a phone or laptop away from your desk, install [Tailscale](https://tailscale.com) on both devices.

Set `"http": { "tailscale": true }` in `config.json` (or `DICTA_TAILSCALE=1`) and start the app. The checkup and startup logs print a link on this machine's Tailscale address. Open that from a device on the same tailnet. The API stays on `127.0.0.1`. The inbox is not published on your LAN. There is no login on the app.

## Already have a pile of recordings?

```bash
pnpm retranscribe
pnpm retranscribe --dir="./notes/2026/08" --limit=5 --reclean
```

That walks existing notes, newest first. Flags are in the [docs](/docs/run).

## Optional: agents, read-only

`pnpm mcp` is a stdio MCP server over the notes files. Search, fetch a note, list tags, list recent. It does not write. See [MCP](/docs/mcp).
