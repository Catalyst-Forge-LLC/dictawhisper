---
title: Install
description: Put DictaWhisper on a desktop you already leave on, then record or drop a file.
order: 1
---

You run this on a computer at home. It is not a website that holds your audio.

A desktop that can stay on helps. A graphics card makes transcription much faster. A writing model for cleanup is optional; without it you still get the raw transcript.

### Get it running

```bash
git clone https://github.com/Catalyst-Forge-LLC/dictawhisper.git
cd dictawhisper
cp config.example.json config.json
# point it at your speech setup, names you say often,
# and (optionally) which computer should tidy the text
pnpm install
pnpm run doctor
pnpm dev
```

Open [http://localhost:7777](http://localhost:7777). Record, or drag a file onto the page. You do not need Syncthing or an extra folder for that.

`pnpm run doctor` is a checkup. It tells you what is missing instead of failing later in silence. If the writing helper is asleep, that is a warning. Notes still get written.

### Read it from your phone

On the home computer, set `"http": { "tailscale": true }` and start the app again. The checkup prints a private link. Open that from a phone on the same Tailscale. There is no login on the app.

### Already have a pile of recordings?

```bash
pnpm retranscribe
pnpm retranscribe --dir="D:\VoiceNotes\2026\08" --limit=5 --reclean
```

That walks existing notes, newest first. Every flag is in the [GitHub README](https://github.com/Catalyst-Forge-LLC/dictawhisper#readme).
