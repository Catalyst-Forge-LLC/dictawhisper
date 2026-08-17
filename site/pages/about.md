---
title: A voice journal that stays on your computer.
description: Record or drop a file. Get a readable note. Nothing is uploaded to a cloud account.
order: 1
---

Voice notes are easy to *make* and hard to *keep*. **DictaWhisper** turns what you said into a note you can actually reread — on your own computer, next to the recording.

The name is the product: **dicta** (dictation, a dictaphone) plus **Whisper**. There is no account and no “upload to our servers.” Each recording keeps a small notes file beside it. That *is* the journal.

<div class="cta-row">
  <a class="cta cta-primary" href="/install">Get started →</a>
  <a class="cta cta-secondary" href="https://github.com/Catalyst-Forge-LLC/dictawhisper">View on GitHub</a>
</div>

<p class="kicker">Runs on your desktop · your audio stays put · MIT</p>

## What you get

- **Talk, or drop a file** — hit Record in the inbox, or drag an audio file onto the page. That is enough. A phone folder that syncs in the background is optional.
- **Notes live next to the audio** — you can copy the folder, back it up, or open a note in any editor. There is nothing to export.
- **Speech on this machine; cleanup wherever it sounds best** — transcription runs on your computer. Tidying the text can happen here or on another computer you already trust. If that helper is asleep, you still have the raw words.
- **Read it from your phone** — at home it is just a page on this computer. On [Tailscale](https://tailscale.com), the same page works from your phone. No public website, no login.
- **A note you can listen through** — cleaned paragraphs, simple tags, and playback that follows what you are reading.

## A normal day

1. Say something. Record in the inbox, or drop a file you already have.
2. DictaWhisper writes the words, then a cleaner pass that drops the ums and adds tags.
3. Open the inbox. Notes are grouped by month. You see the readable version first; the raw speech is one click away.

If a phone app is also dropping files into a folder, those wait until the copy is finished. Browser recordings start right away.

## Who does the writing

<div class="mesh-panel">
  <p>Transcription happens on your desktop. A second step can tidy the prose — on this same computer, or on another one that has a stronger writing model. <a href="https://ollanet.dev">ollanet</a> is how DictaWhisper finds that helper, whether it is in the next room or on this machine.</p>
  <p>The recording does not leave. Only the text does, and only if you asked another computer to help clean it up.</p>
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

Then open [http://localhost:7777](http://localhost:7777). Setup notes are on [Install](/install). Flags and wiring live in the [GitHub README](https://github.com/Catalyst-Forge-LLC/dictawhisper#readme).

<div class="cta-row">
  <a class="cta cta-primary" href="/install">Get started →</a>
  <a class="cta cta-secondary" href="/writing">Read the posts</a>
</div>

Built by [Catalyst Forge LLC](https://www.catalystforge.com).
