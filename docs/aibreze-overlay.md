# DictaWhisper aiBreze overlay

Point at `aibreze` (`node_modules/aibreze/rules/core.md`). Do not fork core.

## Pronouns

| Surface | Voice |
| --- | --- |
| Site (`site/pages`, `site/posts`) | **you** for the reader. Catalyst Forge is named in the footer, not a corporate we. |
| README, `site/docs`, HTTP, flags, doctor | **you** / imperative. Terms of art stay. |
| Chat with the maintainer | **I** is fine. |

## Terms that pass here

- **Whisper / faster-whisper** — the speech model, not a metaphor.
- **inbox** — the local UI at port 7777.
- **sidecar** — the JSON next to the audio. README and APIs may say it. Landing pages should say "notes file next to the recording."
- **ollanet, Ollama, Tailscale, Syncthing** — other products. Name them when they do a job.
- **settle** — wait until a synced file stops changing. Allowed when describing that wait.
- **doctor** — the checkup command. Allowed.
- **GPU / CUDA** — hardware, not hype.

## Protected lines

- Dictation, meet Whisper.
- Earn the word. / Spray the prose, not the author. (package maxims)

## House extras

- Site copy follows `aibreze` `landing.md`. Keep Syncthing, remote Ollama, and Tailscale optional. Do not imply they are required.
- README stays short and points at `site/docs`. Those pages stay technical. Do not flatten them to match the landing pages.
- One concrete landing chant is enough. Do not stack "No X. No Y. No Z." The site spends its chant on the `lede`, "Speak, keep the note, stay on your machine."
- Feature labels name the feature. "Custom vocabulary," not "Names you actually say." See the riddle-label tell in core.
- "Asleep" is allowed for a machine that literally suspends (the ollanet host is often a sleeping laptop). Use "unreachable" for a service, and "loaded" rather than "warm" for the Whisper worker. See cozy machinery in core.
- README "What it is good at" is for product strengths. Settle waits, `_holding` / `_unfiled`, `retranscribe`, and "config is gitignored" belong under Setup, Run, or the Syncthing note. See operator notes in the brochure.
- Say "a computer you leave turned on," not "a desktop you already leave on."
