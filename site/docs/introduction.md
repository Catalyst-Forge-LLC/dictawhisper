---
title: Introduction
---

**DictaWhisper** is a local voice journal. Record in the browser, drop a file, or (optionally) sync a phone folder. It transcribes on your GPU with [faster-whisper](https://github.com/SYSTRAN/faster-whisper), then turns the raw speech into readable notes and tags via [ollanet](https://ollanet.dev) on localhost or another box with a cleanup model.

The name is **dicta** (dictation, a dictaphone) plus **Whisper**. Audio stays on this computer. The `.json` next to each recording is the note: no database, no account.

The npm package is a name hold. Clone this repo to run it.

## Why it exists

Voice notes are easy to make and hard to keep. Phone recordings pile up as undated blobs. Cloud speech-to-text wants the audio. Desktop Whisper dumps a wall of filler words and repeated phrases. A journal you can reread needs three things:

1. **Capture that fits your tools:** record or drop a file in the browser. Syncthing from a phone is optional.
2. **Accurate, local transcription:** `large-v3` on CUDA, a prompt seeded with your own vocabulary, word times that survive cleanup.
3. **Usable notes:** cleaned prose, tags, playback that follows the cleaned paragraphs, files you can copy and back up.

## What it is good at

**Files are the database.** Each note is `audio` + `audio.json`. You can rsync the tree, open a sidecar in an editor, or point `pnpm retranscribe` at one month. The file path is the note's identity, so there is nothing to export.

**The Whisper model stays loaded.** The worker loads the model once and keeps it for the next file. That is the normal path, not a special command.

**Audio never leaves this computer.** Faster-whisper runs here. If you point ollanet at Ollama on another machine on your own network, only the transcript text crosses the network. If ollanet is unreachable, doctor and `/health` report it and you still have the raw words.

**Playback aligned to word timestamps.** Cleanup drops fillers and collapses repeated phrases, but playback cues map back to Whisper word timestamps rather than being inferred from the cleaned wording.

**Custom vocabulary and stable tags.** `whisper.promptTerms` go into Whisper's initial prompt. Tags already in your inventory are fed into cleanup so the model does not spell them a new way every week.

## Privacy and network boundary

- **No telemetry.** Nothing contacts an external analytics or telemetry service.
- **Audio stays here.** Faster-whisper processes files on this GPU or CPU.
- **Text only, and only on your network.** If cleanup runs on another machine you already use, only the transcript text is sent there.
- **Loopback by default.** API (`8008`) and UI (`7777`) bind to `127.0.0.1`. With `http.tailscale`, the inbox also binds to this machine's Tailscale address, not to every interface.
- **Path allowlisting.** File routes resolve realpaths and reject anything outside `watch.roots` and `browserDropFolder` with a `403`.

By default the API binds to `127.0.0.1`. Turn on `http.tailscale` and the inbox also listens on this machine's Tailscale address (`100.x`, plus MagicDNS when you have it) so a phone on the same tailnet can open it. The API stays on loopback; Vite proxies to it.

## Next

- [Install](/docs/install) — clone, config, doctor
- [Quick start](/docs/quick-start) — record, drop, optional phone folder
- [Config](/docs/config) — env and `config.json`
