---
title: A local voice journal.
description: Record or drop a file in the browser. Transcribe on your GPU. Keep notes as files next to the audio.
order: 1
---

Voice notes are easy to *make* and hard to *keep*. **DictaWhisper** waits until the file is really there, transcribes it on your workstation with [faster-whisper](https://github.com/SYSTRAN/faster-whisper), then turns the raw speech into readable notes and tags via [ollanet](https://ollanet.dev).

The name is the product: **dicta** (dictation, a dictaphone) plus **Whisper**. Audio stays on your machine. The sidecar `.json` next to each recording is the source of truth — no database, no cloud account, no “upload to our servers.”

<div class="cta-row">
  <a class="cta cta-primary" href="/install">Install DictaWhisper →</a>
  <a class="cta cta-secondary" href="https://github.com/Catalyst-Forge-LLC/dictawhisper">View on GitHub</a>
</div>

<p class="kicker">pnpm · Node 20+ · CUDA Whisper · MIT</p>

## What you get

- **Record or drop — Syncthing is optional** — the inbox is enough. If you also watch a phone folder, those files settle for 30 minutes; browser files start immediately.
- **Files are the database** — each note is `audio` + `audio.json`. Rsync the tree. There is nothing to export.
- **Whisper here; cleanup wherever it is best** — faster-whisper stays on this GPU. [ollanet](https://ollanet.dev) finds Ollama on localhost and the network. Put the instruct model on this box or another; that is a quality choice.
- **Inbox on Tailscale** — default bind is localhost. Turn on `http.tailscale` and open the same inbox from a phone on your tailnet.
- **A note you can listen through** — cleaned paragraphs, tags, playback cues aligned to Whisper word times.
- **Honest first run** — `pnpm run doctor` reports ffmpeg, faster-whisper, CUDA, watch roots, and ollanet. Failures refuse to start queues.

## Daily loop

1. Talk. Hit Record in the inbox, or drag an audio file onto the page. A watched phone folder is optional.
2. Dated names (`YYYY-MM-DD…`) file into `YYYY/MM/`. Collisions go to `_holding`. Undated files go to `_unfiled`.
3. A long-lived Whisper worker (model loaded once) writes the sidecar.
4. ollanet cleans the text and adds tags onto the **same** JSON.
5. Open [localhost:7777](http://localhost:7777) — or the MagicDNS URL if Tailscale is on — cleaned text by default, raw on a toggle.

## The ollanet loop

<div class="mesh-panel">
  <p><a href="https://ollanet.dev"><strong>ollanet</strong></a> already looks at localhost and the rest of your mesh. Cleanup can run on this machine or on a quieter one with a better instruct model. Same API either way.</p>
  <p>Audio stays on the workstation. Only text leaves, and only if you pointed cleanup at another host. Doctor and <code>/health</code> say when that host is down.</p>
</div>

## Quick start

```bash
git clone https://github.com/Catalyst-Forge-LLC/dictawhisper.git
cd dictawhisper
cp config.example.json config.json
pnpm install
pnpm run doctor
pnpm dev
```

Inbox: [http://localhost:7777](http://localhost:7777). Flags and HTTP live on the [install](/install) page and the [GitHub README](https://github.com/Catalyst-Forge-LLC/dictawhisper#readme).

<div class="cta-row">
  <a class="cta cta-primary" href="/install">Get started →</a>
  <a class="cta cta-secondary" href="/writing">Read the posts</a>
</div>

Built by [Catalyst Forge LLC](https://www.catalystforge.com).
