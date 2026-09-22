---
title: Install
description: Hardware and runtimes first, then a git clone. The npm package does not start yet.
order: 1
---

You run this on a computer you leave turned on. It is not a website that holds your audio. There is no installer. The npm package `dictawhisper` `0.1.4` **does not start** from an install (Node will not strip TypeScript under `node_modules`). Clone the repo.

## Before you clone

Exercised path: **Windows**, **Node 22.6+** (the scripts use `--experimental-strip-types`), **pnpm**, a **Python** interpreter with [`faster-whisper`](https://github.com/SYSTRAN/faster-whisper), and an **NVIDIA GPU** with CUDA (`whisper.device` = `cuda`). Point `whisper.python` at that interpreter.

Also required for the default denoise path: `ffmpeg` on PATH.

Optional: [ollanet](https://ollanet.dev) plus an Ollama model for text cleanup (this computer or another you already use). Without it you still get the raw transcript.

CPU mode (`whisper.device` = `cpu`) is supported and marked slow. macOS and Linux have not been recorded as verified in this project. Treat them as unverified.

## Get it running

```bash
git clone https://github.com/Catalyst-Forge-LLC/dictawhisper.git
cd dictawhisper
cp config.example.json config.json
# set whisper.python, whisper.device, and (optionally) ollanet.machine / cleanModel
pnpm install
pnpm run doctor
pnpm dev
```

Ready signal: `pnpm run doctor` exits 0, or prints only warnings (CPU mode, ollanet unreachable, port already in use). Then open [http://localhost:7777](http://localhost:7777). Record, or drag a file onto the page.

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
