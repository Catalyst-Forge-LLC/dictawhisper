---
title: Install
description: Put DictaWhisper on a desktop you already leave on, then record or drop a file.
order: 1
---

DictaWhisper is an app you run on a computer at home — not something you install from an app store, and not a website that holds your audio.

You will want a desktop that can stay on, and a graphics card if you have one (it will be much faster). A writing model for cleanup is optional; without it you still get the raw transcript.

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

`pnpm run doctor` is a checkup: it tells you what is missing instead of failing later in silence. If the writing helper is asleep, that is a warning — notes still get written.

### Read it from your phone

On the home computer, turn on Tailscale in the config (`"http": { "tailscale": true }`) and start the app again. The checkup prints a private link. Open that from a phone that is on the same Tailscale. There is no login — if you can see the tailnet, you can see the inbox.

### Already have a pile of recordings?

```bash
pnpm retranscribe
pnpm retranscribe --dir="D:\VoiceNotes\2026\08" --limit=5 --reclean
```

That walks your existing notes, newest first. Details and every flag live in the [GitHub README](https://github.com/Catalyst-Forge-LLC/dictawhisper#readme).
