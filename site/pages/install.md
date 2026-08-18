---
title: Install
description: Put DictaWhisper on a computer you leave turned on, then record or drop a file.
order: 1
---

You run this on a computer at home. It is not a website that holds your audio.

A computer you leave turned on helps. A graphics card makes transcription much faster. A writing model for cleanup is optional; without it you still get the raw transcript.

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

Open [http://localhost:7777](http://localhost:7777). Record, or drag a file onto the page. You do not need an extra sync tool for that.

`pnpm run doctor` is a checkup. It names what is missing up front instead of failing later without explanation. If the cleanup model cannot be reached, that is a warning rather than an error, and notes still get written. `pnpm doctor` without `run` is pnpm's own command and will not check this app.

### Optional: sync a phone folder

If you already record on your phone, install [Syncthing](https://syncthing.net) (or any folder sync tool) on both devices and share a folder to your workstation.

Add that directory to `"roots"` in `config.json`:

```json
"watch": {
  "roots": ["C:\\Users\\YOU\\VoiceNotes"]
}
```

Files arriving via folder sync wait 30 minutes after the last write before organizing into `YYYY/MM/` and transcribing, so recordings never process mid-transfer.

### Optional: read from your phone on Tailscale

If you want to open the inbox from a phone or laptop away from your desk, install [Tailscale](https://tailscale.com) on both devices.

Set `"http": { "tailscale": true }` in `config.json` (or `DICTA_TAILSCALE=1`) and start the app. The checkup and startup logs print a link on this machine's Tailscale address. Open that from a device on the same tailnet. The API stays on `127.0.0.1`. The inbox is not published on your LAN. There is no login on the app.

### Already have a pile of recordings?

```bash
pnpm retranscribe
pnpm retranscribe --dir="./notes/2026/08" --limit=5 --reclean
```

That walks existing notes, newest first. Every flag is in the [GitHub README](https://github.com/Catalyst-Forge-LLC/dictawhisper#readme).

### Optional: agents, read-only

`pnpm mcp` is a stdio MCP server over the notes files. Search, fetch a note, list tags, list recent. It does not write. Point a client at `src/mcp.ts` as in the GitHub README.
