---
title: A voice journal that stays on your computer.
description: Record or drop a file. Get a readable note. Nothing is uploaded to a cloud account.
order: 1
---

Voice notes pile up. **DictaWhisper** turns a recording into a note you can reread, on your own computer, sitting next to the audio.

The name is **dicta** (dictation, a dictaphone) plus **Whisper**. There is no account. Each recording keeps a small notes file beside it. That file is the journal.

<div class="cta-row">
  <a class="cta cta-primary" href="/install">Get started →</a>
  <a class="cta cta-secondary" href="https://github.com/Catalyst-Forge-LLC/dictawhisper">View on GitHub</a>
</div>

<p class="kicker">Runs on your desktop. MIT.</p>

## What you get

- Hit Record in the inbox, or drag an audio file onto the page. A phone folder that syncs in later (via [Syncthing](https://syncthing.net) or any folder sync) is optional.
- Copy the folder and you copied the journal. Open a note in any editor. There is nothing to export.
- Speech is transcribed on this computer. A second pass can tidy the prose here, or on another computer you already use. If that helper is asleep, you still have the raw words.
- At home the inbox is a page on this machine. On [Tailscale](https://tailscale.com) the same page works from your phone.
- You get readable paragraphs, a few tags, and playback that follows what you are reading.

## A normal day

1. Say something. Record in the inbox, or drop a file you already have.
2. DictaWhisper writes the words, then a cleaner pass that drops the ums and adds tags.
3. Open the inbox. Notes are grouped by month. The readable version is first; the raw speech is one click away.

If a phone app is also dropping files into a folder, those wait until the copy is finished. Browser recordings start right away.

## Where the words get tidied

<div class="mesh-panel">
  <p>Transcription happens on your desktop. Tidying the prose can happen here too, or on another machine with a stronger writing model. <a href="https://ollanet.dev">ollanet</a> is how DictaWhisper finds that helper.</p>
  <p>The recording stays. Only the text moves, and only if you asked another computer to help.</p>
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

Then open [http://localhost:7777](http://localhost:7777). Setup is on [Install](/install). Flags live in the [GitHub README](https://github.com/Catalyst-Forge-LLC/dictawhisper#readme).

<div class="cta-row">
  <a class="cta cta-primary" href="/install">Get started →</a>
  <a class="cta cta-secondary" href="/writing">Read the posts</a>
</div>

Built by [Catalyst Forge LLC](https://www.catalystforge.com).
