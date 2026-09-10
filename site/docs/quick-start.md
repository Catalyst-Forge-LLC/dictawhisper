---
title: Quick start
---

```bash
pnpm dev
```

Open [http://localhost:7777](http://localhost:7777).

1. Talk. Hit Record, or drag an audio file onto the page.
2. Browser files start immediately. Optional ffmpeg denoise, then Whisper (model loaded once) writes a sidecar `.json`.
3. ollanet cleans the text and adds tags onto the same JSON. Raw speech is kept.
4. Notes are grouped by month. Cleaned text is the default; raw speech is one click away. Playback follows the cleaned paragraphs.

If [LocalSlip](https://localslip.dev) is installed, 7777 is the `dictawhisper` slip and 8008 is `dictawhisper-api` (loopback, not `--lan`).

## Failure and recovery

| What failed | What you still have | What to run |
| --- | --- | --- |
| ollanet unreachable or not configured | Recording plus raw `text` / `segments` | Inbox **Retry**, or `pnpm retranscribe --reclean` when the host is up |
| Cleanup error on a note | Same files. Status **cleanup failed** | **Retry** on that note |
| faster-whisper missing | Existing notes on disk. New transcription will not start | Fix `whisper.python`, then `pnpm run doctor` |
| ffmpeg missing and denoise on | Doctor fails. Transcription is not claimed | Install ffmpeg or turn `audio.preprocess` off |

Doctor warnings do not mean Whisper wrote a transcript. A fail on `faster-whisper` means new recordings stay untranscribed. Phone-folder sync stays optional and external.

## Optional phone folder

If you also watch a phone folder ([Syncthing](https://syncthing.net) or any folder sync), those files wait 30 minutes after the last write so the transfer can finish, then dated names are filed into `YYYY/MM/` on that watch root.

```
Browser record/drop →  drop folder →  immediately ─────────────┐
Optional phone folder →  watch roots  →  settle 30m  →  YYYY/MM/ ┼─→ whisper → sidecar.json → ollanet → UI
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
