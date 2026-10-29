---
title: Quick start
---

```bash
pnpm dev
```

Open [http://localhost:7777](http://localhost:7777).

1. Talk. Hit Record, or drag an audio file onto the page.
2. Browser files begin processing immediately. Audio assessment/preparation runs before the selected transcription engine writes a sidecar `.json`. Bark Pro is the English default; Whisper is an alternative.
3. If cleanup is configured, ollanet cleans the text and adds tags to the same JSON. The raw transcript is kept.
4. Notes are grouped by month. Cleaned text is the default; raw speech is one click away. Playback follows the cleaned paragraphs.

If [LocalSlip](https://localslip.dev) is installed, 7777 is the `dictawhisper` slip and 8008 is `dictawhisper-api` (loopback, not `--lan`).

## Failure and recovery

| What failed | What you still have | What to run |
| --- | --- | --- |
| ollanet unreachable or not configured | Recording plus raw `text` / `segments` | Inbox **Retry**, or `pnpm retranscribe --reclean` when the host is up |
| Cleanup error on a note | Same files. Status **cleanup failed** | **Retry** on that note |
| Selected engine runtime missing | Existing recordings and notes on disk. New transcription cannot finish | Complete Bark setup, or fix `whisper.python` for a selected Whisper model, then run `pnpm run doctor` |
| ffmpeg or ffprobe missing | Recordings and existing notes remain; audio preparation is unavailable | Install both tools. Unfiltered mode still requires them |

A healthy cleanup connection does not establish successful transcription. Check the selected engine’s result in Activity and use its recovery action when needed. Phone-folder sync stays optional and external.

## Optional phone folder

If you also watch a phone folder ([Syncthing](https://syncthing.net) or any folder sync), those files wait 30 minutes after the last write so the transfer can finish, then dated names are filed into `YYYY/MM/` on that watch root.

```
Browser record/drop →  drop folder →  immediately ─────────────┐
Optional phone folder →  watch roots  →  settle 30m  →  YYYY/MM/ ┼─→ local transcription → sidecar.json → optional cleanup → UI
Force / retranscribe ─────────────────────────────────────────┘
```

Add the directory to `"roots"` in `config.json`:

```json
"watch": {
  "roots": ["C:\\Users\\YOU\\VoiceNotes"]
}
```

## Optional Tailscale

To reach the UI from a phone on your Tailscale:

```json
"http": { "tailscale": true }
```

or `DICTA_TAILSCALE=1`. Doctor and startup print the MagicDNS / `100.x` URL. There is still no login: only devices on that tailnet should be able to open it. The inbox is not bound to `0.0.0.0` or your LAN.

See [Run](/docs/run) for the other commands.
