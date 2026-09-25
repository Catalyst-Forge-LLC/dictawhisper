---
title: Introduction
---

Your phone or browser sends audio to the DictaWhisper server you configure. That computer transcribes it. If refinement is enabled, transcript text goes to the configured Ollama host.

**DictaWhisper** is a local voice journal. Record in the browser, drop a file, or (optionally) sync a phone folder. It transcribes on your GPU with [faster-whisper](https://github.com/SYSTRAN/faster-whisper), then turns the raw speech into readable notes and tags via [ollanet](https://ollanet.dev) on localhost or another box with a cleanup model.

Open the transcript as text. Use the accompanying JSON when you need the structured recording and transcription data.

The name is **dicta** (dictation, a dictaphone) plus **Whisper**. Audio stays on this computer. The `.json` next to each recording is the note: no database, no account.

The npm package (`dictawhisper` `0.1.4`) does not start from an install yet. Clone this repo. There is no installer. Hardware and runtimes belong on [Install](/docs/install) before the clone.

## Why it exists

Voice notes are easy to make and hard to keep. Phone recordings pile up as undated blobs. Cloud speech-to-text wants the audio. Desktop Whisper dumps a wall of filler words and repeated phrases. A journal you can reread needs three things:

1. **Capture that fits your tools:** record or drop a file in the browser. Syncthing from a phone is optional.
2. **Accurate, local transcription:** `large-v3` on CUDA, a prompt seeded with your own vocabulary, word times that survive cleanup.
3. **Usable notes:** cleaned prose, tags, playback that follows the cleaned paragraphs, files you can copy and back up.

## What it is good at

**Files are the database.** Each note is `audio` + `audio.json`. You can rsync the tree, open a sidecar in an editor, or point `pnpm retranscribe` at one month. The file path is the note's identity, so there is nothing to export.

**The Whisper model stays loaded.** The worker loads the model once and keeps it for the next file. That is the normal path, not a special command.

**Audio never leaves this computer.** Faster-whisper runs here. If you point `ollanet.machine` at Ollama on another machine on your own network, only cleanup text goes there. If ollanet is unreachable, doctor and `/health` report it and you still have the raw words.

**Playback aligned to word timestamps.** Cleanup drops fillers and collapses repeated phrases, but playback cues map back to Whisper word timestamps rather than being inferred from the cleaned wording.

**Custom vocabulary and stable tags.** `whisper.promptTerms` go into Whisper's initial prompt. Tags already in your inventory are fed into cleanup so the model does not spell them a new way every week.

## Privacy and network boundary

- **No telemetry.** Nothing contacts an external analytics or telemetry service.
- **Audio and transcript files stay here.** Faster-whisper processes files on this GPU or CPU, and the notes stay next to the audio.
- **Cleanup text goes only to `ollanet.machine`.** Cleanup sends transcript text to that one host and is skipped when it is empty.
- **Search embeds on this computer by default.** Search indexing sends note text (up to 8,000 characters per note) to an Ollama embedding model on this computer. It uses another host only if you set `journal.embedHost`: `machine` for the `ollanet.machine` host, a host name for that host, or `any` for the first host ollanet discovers. If no allowed host has an embedding model, nothing is embedded, search matches words only, and doctor and the inbox Tools panel say why. With `journal.search` set to `lex`, nothing is embedded at all. `journal.embedModel` names the model, not the host.
- **Loopback by default.** API (`8008`) and UI (`7777`) bind to `127.0.0.1`. With `http.tailscale`, the inbox also binds to this machine's Tailscale address, not to every interface.
- **Path allowlisting.** File routes resolve realpaths and reject anything outside `watch.roots` and `browserDropFolder` with a `403`.

By default the API binds to `127.0.0.1`. Turn on `http.tailscale` and the inbox also listens on this machine's Tailscale address (`100.x`, plus MagicDNS when you have it) so a phone on the same tailnet can open it. The API stays on loopback; Vite proxies to it.

## Files on disk

| Item | Default | What it is |
| --- | --- | --- |
| Browser drop folder | `./data/audio-files` | Recordings and drops from the inbox |
| Watch roots | none | Optional phone or dump folders |
| Notes file | `<audio>.json` next to the audio | Raw text, segments, cleaned text, tags |
| Journal index | `./data/journal.sqlite` | Search index, not the source of truth |

Copy the audio and its JSON together and you copied the note.

## Next

- [Install](/docs/install) — hardware, clone, doctor
- [Quick start](/docs/quick-start) — record, drop, recovery
- [Config](/docs/config) — env and `config.json`
