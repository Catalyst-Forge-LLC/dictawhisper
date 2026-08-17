---
title: "Hello from dictawhisper.com"
date: 2026-08-17
description: Product home for the local voice journal — files next to the audio, Whisper on the GPU, cleanup over ollanet.
tags: [meta, releases]
---

**dictawhisper.com** is the public home for DictaWhisper: the promise, the install path, and a place that is *not* the GitHub README.

What the workstation already does:

- **Watch** phone folders (Syncthing-safe 30-minute settle) and browser record/drop (immediate)
- **Organize** `YYYY-MM-DD` names into `YYYY/MM/`, with `_holding` and `_unfiled` instead of silence
- **Transcribe** with a persistent faster-whisper worker — model loaded once
- **Clean and tag** over [ollanet](https://ollanet.dev) — localhost or another Ollama, whichever model is better; raw speech stays on the sidecar
- **Inbox** at localhost:7777, or on your Tailscale from a phone

Clone, `pnpm run doctor`, `pnpm dev`. See [/install](/install).

This site is built with [FilePress](https://getfilepress.com) — git-native Markdown, static HTML, Cloudflare Pages.
