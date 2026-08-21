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

<!-- xfacts-nutrition-label -->

## Nutrition label

- **AppFacts:** [viewer](https://appfacts.dev/v#af1.eNpVkltr3DAQhf-KmKcWtGvyqqeASaG5lFDnrZQwK0-8imVJaMbemGX_e5H31n0Tc74ZnTnSHiYwdxoCDgQGWmcFd1vHiTJokDmV6o42ClNS35rm93fQwIIyMhhAK24i0OCdpcCFffn5diRsD2YPHkM3YleUtzlRY7NLotUjTng-v86yjQE05DGIW2z8ii2tP_k_7SPjQLuYezDQTOSFnpxo9fCVMjEvN87eha7IddNoVTcNaEAHBj6QhfLqtJZW0XsMJKDBxmEYg7MoLgYwwNH2JGsX4aChpcRg_uyhKPe8XPrJVe9KZypzcwxCoVVXcwd9xOniq4AbtH3hmPJE-QLd-jqxkjHwkoyLQVHoXKBLx9V5Qb0flF0siEo5WmIuCZzh6zJHPBP6VQlY3a595u-H2JJfBn5JylGijb7itj_1v9Sv6lxWPKYUs8Dhr4bN6HxbHjuh7bGj9wEDdpTBQAppKFlmSpGdxDyDga1IYlNVnZPtuFnbOFQ1CvqZZfUj5o5Wz891dfMVD_8Ay7foKw) · [raw](https://github.com/Catalyst-Forge-LLC/dictawhisper/blob/main/APP_FACTS.md)
- **ToolFacts:** [viewer](https://toolfacts.dev/v#tf1.eNrFlE1v2zAMhv-KoHO-tt2y05ChpwwY0MMORRGoEmNrtSWXop0GQf77XioN9oH1nItjkC_58mEsnexk1x9mNrme7Np-jV7cjzaWgdh823w398QTsZ3ZQBN1GWGoNk5cdyxi7jI3hCQkJeaE1GqxWnxCpIiTsSDgvMRJNV30lIqafBmcb2n-cbFC-DmmgFjvh3m5evGYJOo8J0uv5Ee59O6yd9184OypFMiEXSpDZkGuSIjZnmfWMwVCueuK1jO9jBEhu354RJYa1lokhDrqSfiI4pQTVcQiMTl1K296yVn7PJyuCwq6oMNlQbtCjn2rtDHQjvZ78qLMTC4oBoFTvfaxo4J9Ua-TemxR04nkkPn5t_8bGaHFHuMT_NG3H7IAyK6FR4Jo5CHXNd5XdzNlLNYkiIp5Ohq0DGVmxDV4ZjbqrbN_NkwycipmcNIiFxwqrkKXgnGmtFimGZimSAcs8__UDclO7W7FfUcCbJRWaGXWMbzjSqbMY4ovIzKu_IPuO3KJghF6lcqs9O-CdrHIripuRLrFAHVEE5ORlszPDAzXmUMEqM84Ju9Pz-S16S1HT3Qg_anf5j4y3uvkedAzBg6w1b8huKPBYW5IP1fBZWLPjzPb5p4G12i7VmQo6-XyT8KFz30FgWWUXE_yVdfAZnxSxfJ6Wc3rZTXfbjd_dan3yJg8TkO4YJx_AeesyY0) · [raw](https://github.com/Catalyst-Forge-LLC/dictawhisper/blob/main/TOOL_FACTS.md)

## Development

```bash
pnpm test
pnpm typecheck
pnpm site:dev
```

Site (FilePress + docs mount): `pnpm --dir site ship`

## License

MIT · [Catalyst Forge LLC](https://www.catalystforge.com)
