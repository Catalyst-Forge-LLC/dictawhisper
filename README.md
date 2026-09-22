<p align="center">
  <img src="site/static/logo.png" alt="DictaWhisper logo" width="128" />
</p>

# DictaWhisper

**A local voice journal.** Record in the browser, drop a file, or (optionally) sync a phone folder. Transcribe on your GPU with [faster-whisper](https://github.com/SYSTRAN/faster-whisper). Clean the note with [ollanet](https://ollanet.dev). The `.json` next to each recording is the journal.

Install from a Git checkout ([below](#from-a-checkout)). The npm package `dictawhisper` 0.1.4 does not start yet: its bin runs TypeScript from `node_modules`, and Node refuses to strip types there. It would not install Python or faster-whisper either.

**Docs:** [dictawhisper.com/docs](https://dictawhisper.com/docs) · **Site:** [dictawhisper.com](https://dictawhisper.com)

## Before you clone

Exercised path: Windows, Node 22.6+ (the scripts use `--experimental-strip-types`), pnpm, Python with [faster-whisper](https://github.com/SYSTRAN/faster-whisper), and an NVIDIA GPU with CUDA. `ffmpeg` is required when denoise is on. macOS and Linux are unverified. CPU mode works and is slow. Cleanup via [ollanet](https://ollanet.dev) is optional.

## From a checkout

```bash
git clone https://github.com/Catalyst-Forge-LLC/dictawhisper.git
cd dictawhisper
cp config.example.json config.json
pnpm install
pnpm run doctor
pnpm dev
```

Ready signal: `pnpm run doctor` exits 0, or only warnings remain. Then open [http://localhost:7777](http://localhost:7777). Point `whisper.python` at the interpreter that has CUDA Whisper. Cleanup host and model are optional; raw transcripts still work.

## Quick start

```bash
pnpm dev     # API + UI  →  http://localhost:7777
pnpm start   # API only on 127.0.0.1:8008
```

Hit Record, or drag an audio file onto the page. Flags, HTTP, MCP, and `retranscribe` live in the [docs](https://dictawhisper.com/docs).

## What you get

Files are the database. Each note is the recording plus a neighboring `.json`. The Whisper model stays loaded. Audio stays on this computer. Cleanup sends transcript text to the `ollanet.machine` you set, and is skipped when that is empty. Journal search also sends note text to an Ollama embedding model: a local one first, otherwise the first host ollanet finds (config or Tailscale) that has one. `journal.embedModel` picks the model name, not the host. The inbox is loopback by default; `http.tailscale` puts the same page on your tailnet. Playback follows cleaned paragraphs using Whisper word times. If cleanup is skipped or fails, the inbox shows **raw only** or **cleanup failed**, and **Retry** is available. Transcription itself still needs faster-whisper.

<!-- xfacts-label -->

## xFacts label

- **AppFacts:** [viewer](https://appfacts.dev/v#af1.eNpVkltr3DAQhf-KmKcWtGvyqqeASaG5lFDnrZQwK0-8imVJaMbemGX_e5H31n0Tc74ZnTnSHiYwdxoCDgQGWmcFd1vHiTJokDmV6o42ClNS35rm93fQwIIyMhhAK24i0OCdpcCFffn5diRsD2YPHkM3YleUtzlRY7NLotUjTng-v86yjQE05DGIW2z8ii2tP_k_7SPjQLuYezDQTOSFnpxo9fCVMjEvN87eha7IddNoVTcNaEAHBj6QhfLqtJZW0XsMJKDBxmEYg7MoLgYwwNH2JGsX4aChpcRg_uyhKPe8XPrJVe9KZypzcwxCoVVXcwd9xOniq4AbtH3hmPJE-QLd-jqxkjHwkoyLQVHoXKBLx9V5Qb0flF0siEo5WmIuCZzh6zJHPBP6VQlY3a595u-H2JJfBn5JylGijb7itj_1v9Sv6lxWPKYUs8Dhr4bN6HxbHjuh7bGj9wEDdpTBQAppKFlmSpGdxDyDga1IYlNVnZPtuFnbOFQ1CvqZZfUj5o5Wz891dfMVD_8Ay7foKw) · [raw](https://github.com/Catalyst-Forge-LLC/dictawhisper/blob/main/APP_FACTS.md)
- **ToolFacts:** [viewer](https://toolfacts.dev/v#tf1.eNrFlE1v2zAMhv-KoHM-1h2zY4YCA1JgQAfsUBSBKjG2WltyKdppEOS_76XSYB9Yz7kksfiSLx_G1NFOdnUzs8n1ZFf2a_TifraxDMTmbv3d3BNPxHZmA03UZRxDtXbiukMRc5u5IQQhKTEnhD4tbhafcVLEyVhw4LzESTVd9JSKmtx9-4Hnl5gCHno_zMvFhMckURs5WnojP8q5aJe96-YDZ0-lQCbsUhkyC2JFQsz2NLOeKRDSXVc0n-l1jDiyq4dHRKlhzUVAqKOehA9ITjlRZSsSk1O38q6XnLXOw_EymaCT2Z8nsy3k2LeKGQNtabcjLwrL5IJikEMUXrvYUcGgqNdOPcan4USyz_zy2_-djFBih_YJ_qjbD1kAZFfCI0E08pDr_O6ru5kyJmoSRMU8HQxKhjIz4hp8Zjbqrb1_MUwycipmcNIiFhwyLkKXgnGmtBimGZimSHsM8__UDclW7a7FfUsCbKRWaGXWNrzjSqbMY4qvIyKu_IPuO3KJghF6k8qs9B-CdrHItiquRLpBA7VFE5ORlsxzBobrzD4C1GesycfdM3ktes3WE-1Jv-q7uYuM37XzPOiOgQNs9W8I7mCwzA3p6yq4RezpcWbb3NPgGi3XigxltVz-Sbjwua8gsIyS6yZfdA1sxidVLC-31LzeUvPNZv1XlXqPjMljG8IZ4_QLRYvHeA) · [raw](https://github.com/Catalyst-Forge-LLC/dictawhisper/blob/main/TOOL_FACTS.md)

## Development

```bash
pnpm test
pnpm typecheck
pnpm site:dev
```

Site (FilePress + docs mount): `pnpm --dir site ship`

## License

MIT · [Catalyst Forge LLC](https://www.catalystforge.com)
