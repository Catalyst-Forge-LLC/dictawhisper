<p align="center">
  <img src="site/static/logo.png" alt="DictaWhisper logo" width="128" />
</p>

# DictaWhisper

**A local voice journal.** Record in the browser, drop a file, or (optionally) sync a phone folder. Transcribe on your GPU with [faster-whisper](https://github.com/SYSTRAN/faster-whisper). Clean the note with [ollanet](https://ollanet.dev). The `.json` next to each recording is the journal.

The npm package is a name hold. Clone this repo to run it.

**Docs:** [dictawhisper.com/docs](https://dictawhisper.com/docs) · **Site:** [dictawhisper.com](https://dictawhisper.com)

## Install

```bash
git clone https://github.com/Catalyst-Forge-LLC/dictawhisper.git
cd dictawhisper
cp config.example.json config.json
pnpm install
pnpm run doctor
pnpm dev
```

Open [http://localhost:7777](http://localhost:7777). Point `whisper.python` at the interpreter that has CUDA Whisper. Cleanup host and model are optional; raw transcripts still work.

## Quick start

```bash
pnpm dev     # API + UI  →  http://localhost:7777
pnpm start   # API only on 127.0.0.1:8008
```

Hit Record, or drag an audio file onto the page. Flags, HTTP, MCP, and `retranscribe` live in the [docs](https://dictawhisper.com/docs).

## What you get

Files are the database. The Whisper model stays loaded. Audio stays on this computer. The inbox is loopback by default; `http.tailscale` puts the same page on your tailnet. Playback follows cleaned paragraphs using Whisper word times.

## Development

```bash
pnpm test
pnpm typecheck
pnpm site:dev
```

Site (FilePress + docs mount): `pnpm --dir site ship`

## License

MIT · [Catalyst Forge LLC](https://www.catalystforge.com)
