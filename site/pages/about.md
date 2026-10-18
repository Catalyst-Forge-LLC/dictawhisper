---
title: "Turn a recording into a note you can reread."
description: "Record a thought or drop an audio file into DictaWhisper. It transcribes the speech on your computer and keeps a readable note beside the recording, so the words are useful after the moment passes."
order: 1
---

<section class="value-hero" aria-label="DictaWhisper overview"><div class="value-intro"><p class="value-kind">Voice journal running on your computer</p><h1>Turn a recording into a note you can reread.</h1><p class="value-lede">Record a thought or drop an audio file into DictaWhisper. It transcribes the speech on your computer and keeps a readable note beside the recording, so the words are useful after the moment passes.</p><div class="cta-row"><a class="cta cta-primary" href="/install">Set up DictaWhisper</a><a class="cta cta-secondary" href="#where-the-files-live">See how a note is kept</a></div><p class="value-limit">Setup needs Node, Python, and faster-whisper. The exercised path uses an NVIDIA GPU. Optional cleanup sends text only to the machine you configure.</p></div><figure class="value-proof"><figcaption>Illustrative example</figcaption><p><strong>Starting point</strong><br>A recording from a walk, saved as <code>walk-note.webm</code>.</p><div class="value-result"><p><strong>What you get</strong><br>A neighboring notes file with raw words and a readable version in the inbox.</p></div><p>Revisit the note, search it, and play the audio without exporting a journal from an account.</p><p class="value-note">Illustrative note pair. Transcription quality depends on the recording and model.</p></figure></section>

Package releases from 0.1.11 include compiled JavaScript and the inbox UI. Earlier npm releases do not start from an npm installation. Full prerequisites and setup are on [Install](/install).

## What you get

- Hit Record in the inbox, or drag an audio file onto the page. A phone folder that syncs in later (via [Syncthing](https://syncthing.net) or any folder sync) is optional.
- Copy the folder and you copied the journal. Open a note in any editor. There is nothing to export.
- Speech is transcribed on this computer. A second pass can tidy the prose here, or on another computer you already use. If that computer is off or offline, you still have the raw words.
- At home the inbox is a page on this machine. On [Tailscale](https://tailscale.com) the same page works from your phone.
- Readable paragraphs, a few tags, and playback that follows what you are reading.

## A normal day

1. Say something. Record in the inbox, or drop a file you already have.
2. DictaWhisper writes the words, then a cleaner pass that drops the ums and adds tags.
3. Open the inbox. Notes are grouped by month. The readable version is first; the raw speech is one click away.

If a phone app is also dropping files into a folder, those wait until the copy is finished. Browser recordings start right away.

## Where the words get tidied

<div class="mesh-panel">
  <p>Transcription happens on your desktop. Tidying the prose can happen here too, or on another machine with a stronger writing model. <a href="https://ollanet.dev">ollanet</a> is how DictaWhisper finds that helper.</p>
  <p>The recording and its notes stay on this computer. Cleanup text goes only to the computer you name in <code>ollanet.machine</code>. Search indexing embeds note text on this computer, and uses another computer only if you set <code>journal.embedHost</code>. If this computer has no embedding model, search matches words only.</p>
</div>

## Where the files live

Browser recordings and drops go under `watch.browserDropFolder` (default `./data/audio-files`). Optional phone folders are `watch.roots`. Each note is a pair:

```text
data/audio-files/2026-09-10_walk-note.webm
data/audio-files/2026-09-10_walk-note.webm.json
```

The JSON holds raw Whisper text (`text`, `segments`) and, when cleanup ran, `cleanedTranscription` and tags. The inbox **Raw** control shows the transcript. **Sidecar** downloads that file. A search index may also live at `journal.index` (default `./data/journal.sqlite`). That index is not the journal. The pair is.

Sample names above are fictional.

## If cleanup is down

The inbox still lists the recording. Status can read **raw only**, **cleanup skipped**, or **cleanup failed**. **Retry** queues another cleanup pass. `pnpm retranscribe --reclean` does the same from the terminal. Doctor warns when ollanet is unreachable. It does not claim Whisper succeeded if faster-whisper is missing.

## Quick start

Read [Install](/install) for hardware first. Then:

```bash
git clone https://github.com/Catalyst-Forge-LLC/dictawhisper.git
cd dictawhisper
cp config.example.json config.json
pnpm install
pnpm run doctor
pnpm dev
```

Ready signal: doctor exits 0, or only warnings remain. Then open [http://localhost:7777](http://localhost:7777). Flags live in the [docs](/docs).

<div class="cta-row">
  <a class="cta cta-primary" href="/install">Get started →</a>
  <a class="cta cta-secondary" href="/writing">Read the posts</a>
</div>

Built by [Catalyst Forge LLC](https://www.catalystforge.com).
