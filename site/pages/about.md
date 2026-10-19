---
title: "Turn a recording into a note you can reread."
description: "Record a thought or drop an audio file into DictaWhisper. It transcribes the speech on your computer and keeps a readable note beside the recording, so the words are useful after the moment passes."
order: 1
---

<section class="value-hero" aria-label="DictaWhisper overview"><div class="value-intro"><div class="value-headline"><p class="value-kind">Voice journal running on your computer</p><h1>Turn a recording into a note you can reread.</h1></div><div class="value-pitch"><p class="value-lede">Record a thought or drop an audio file into DictaWhisper. It transcribes the speech on your computer and keeps a readable note beside the recording, so the words are useful after the moment passes.</p><div class="cta-row"><a class="cta cta-primary" href="/install">Set up DictaWhisper</a><a class="cta cta-secondary" href="#note-example">See raw speech become a note</a></div><p class="value-limit">Setup needs Node, Python, and faster-whisper. The exercised path uses an NVIDIA GPU. Optional cleanup sends text only to the machine you configure.</p></div></div>
<figure class="value-proof worked-example" id="note-example" tabindex="-1">
<figcaption>Keep the thought without replaying the whole walk</figcaption>
<p class="example-context">Fictional recording and cleanup. Both versions belong to the same note; the audio remains available when you need to check what was said.</p>
<section class="example-step" aria-labelledby="example-step-1">
<h2 id="example-step-1"><span>1 · Raw words</span> The useful thought is inside the ramble</h2>
<p><code>walk-note.webm</code> → transcription</p><blockquote><p>Um, for the garden, I think we should move the tomatoes to the south bed. Yeah, that’s the bit that gets sun in the afternoon.</p></blockquote>
</section>
<section class="example-step example-report" aria-labelledby="example-step-2">
<h2 id="example-step-2"><span>2 · Saved note excerpt</span> A readable version beside the recording</h2>
<p><code>walk-note.json</code> · selected fields</p><pre><code>{
  "cleanedTranscription": "For the garden, I think we should move the tomatoes to the south bed. It gets sun in the afternoon.",
  "tags": ["garden", "tomatoes"]
}</code></pre><p>The sidecar also keeps the raw transcript. Cleanup is optional.</p>
</section>
<section class="example-step" aria-labelledby="example-step-3">
<h2 id="example-step-3"><span>3 · Revisit in the inbox</span> Find the reason when you need it</h2>
<p>Search for <strong>tomatoes</strong>, open the note, and read the thought: move them to the south bed for afternoon sun.</p><p>Play <code>walk-note.webm</code> to check the wording. Copy the audio and JSON together to keep the note with its source.</p><p class="example-payoff">The recording becomes something you can find and reread.</p>
</section>
<p class="value-note">Illustrative text, not a transcription-quality benchmark. If cleanup is unavailable, the raw transcript remains useful; check important details against the recording.</p>
<p class="example-links"><a href="#where-the-files-live">See where the audio and notes live</a></p>
</figure></section>

## Read the note beside your library

![Actual DictaWhisper Inbox: searchable library, selected transcript with timestamps, audio controls, and MayDos tab.](/screenshots/dictawhisper-inbox.jpg)

The actual Inbox with fictional entries and synthetic transcript, timing, and action data. Select an entry to read it without leaving the library. The MayDos tab keeps possible actions alongside their source note. This capture shows the interface, not transcription or cleanup quality.

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
