# DictaWhisper Improvement Spec

**Status:** draft for review — no implementation until this is locked  
**Date:** 2026-08-16  
**Repo state:** single commit (`dc7d63e` *Initial DictaWhisper extract from Chilon*), no remote, no tests, no CI

This spec is a post-extract pass: what DictaWhisper is now, what should stay, what is rough because it was a Chilon module plus an MDN dictaphone demo, and what to change so the daily loop is seamless.

---

## 1. What this is

DictaWhisper is a **local voice-journal pipeline**:

1. Audio lands in watched folders (phone via Syncthing, or browser record/drop).
2. After the file is stable, optional ffmpeg denoise.
3. `faster-whisper` writes a sidecar `.json` (`text`, `segments`, engine metadata).
4. `ollanet` on another machine cleans the text and adds tags onto the same JSON.
5. A Svelte UI can record, drop files, and browse results over Socket.IO.

The extract already has a real pipeline. It does **not** yet have a product shell: first-run, health, a note inbox, or a single-command daily start. Most pain is leftover coupling, path/Windows assumptions, and a UI that never caught up with the sidecar model.

**Keep (do not rewrite):**

- Sidecar JSON next to the audio as the source of truth (no database for v1).
- 30-minute mtime settle for Syncthing roots.
- Two queues: GPU transcription, then remote cleanup.
- `faster-whisper` + CUDA on this machine; `ollanet` for cleanup on another.
- File-as-identity for notes (path + sidecar), with a later escape hatch if moves become common.

---

## 2. Target daily loop

After this pass, the loop should be:

1. `pnpm install` once (workspace), `cp config.example.json config.json`, edit three things: watch roots, Python path, ollanet machine/model.
2. `pnpm run doctor` tells you ffmpeg, Python/`faster-whisper`, CUDA (or CPU fallback), watch folders, and ollanet are reachable — or exactly what is missing.
3. `pnpm dev` starts API + UI with matching ports and CORS.
4. Phone note via Syncthing: appears as *settling*, then *transcribing*, then *cleaning*, then *done*. No silent 30-minute void.
5. Browser record or drop: transcribes **immediately** (no Syncthing settle).
6. Inbox shows cleaned text, tags, raw segments, audio playback, queue position, and retry/force/delete.
7. Failures are visible and retryable. Nothing depends on “last connected socket” or a hardcoded `localhost:8008`.

---

## 3. Architecture as extracted

```
Phone (Syncthing) --> watch.roots --> organize YYYY/MM/ --> settle 30m --+
Browser record/drop --> browserDropFolder ------------------------------+--> ffmpeg? --> whisper.py --> sidecar.json --> ollanet --> UI
POST /transcribe/force  or  socket force -------------------------------+
```

| Piece | Role | Extract leftover |
|---|---|---|
| `src/server.ts` | Express + Socket.IO + queue wiring | Last-socket-wins; no preflight; no shutdown |
| `src/config.ts` | JSON + env merge | Personal defaults; mutates `process.env`; no Zod |
| `src/lib/fileSettleLib.ts` | Debounce until mtime is old | Comment says 60m, code is 30m; `started` never clears |
| `src/lib/organizationLib.ts` | `YYYY-MM-DD*` → `YYYY/MM/` | Windows `\\` regex; always dest = `roots[0]` |
| `src/lib/whisperLib.ts` + `scripts/*.py` | Spawn Python per file | Reloads `large-v3` every note |
| `src/lib/audioLib.ts` | Denoise + browser save | Shell-interpolated ffmpeg; always encodes MP3 then keeps original extension |
| `src/lib/transcriptionLib.ts` | Watch → queue → clean → emit | In-memory map; incomplete extension list |
| `src/classes/Queue.ts` | `async.queue` wrapper | Chilon pause-condition comments; callback shape `{err}` vs `(err, result)` |
| `client/` | SvelteKit 1 / Svelte 3 recorder + table | MDN dictaphone; hardcoded socket; no cleaned text/tags |

---

## 4. Friction map (journeys)

These are the places a user hits resistance. Each one should become invisible or explicit.

### 4.1 First run / machine setup

| Friction | Why it hurts | Smooth it |
|---|---|---|
| Two `pnpm install`s (root + `client/`) | Easy to start only half the app | pnpm workspace; `pnpm dev` runs both |
| No Python lockfile | `faster-whisper` / CUDA / CTranslate2 version drift | `requirements.txt` or `pyproject.toml` + documented venv; `whisper.python` points at it |
| ffmpeg “on PATH” is assumed | Denoise fails mid-queue with a shell error | `doctor` checks `ffmpeg -version`; disable preprocess with a clear log if missing |
| CUDA / VRAM not checked | First note dies after a long model load | `doctor` + startup log: device, compute type, suggested fallback (`cpu` / `int8_float16`) |
| ollanet host baked in (`YOUR-OLLANET-HOST`, `YOUR-CLEAN-MODEL`) | Clone/setup looks machine-specific | Example placeholders; `doctor` runs `ollanet prompt <machine> <model> --format json "ping"` |
| `config.json` is committed with real home paths | Repo is not shareable; easy to commit local edits | Gitignore `config.json`; keep only `config.example.json` |
| README ports ≠ Vite ports | Docs say `:5173`; Vite is `:6173`; CORS allowlist is `:5173` | One port story (see §5.1) |

**Blocker:** a cold machine cannot be proven ready. Without `doctor`, every first-note failure looks like a pipeline bug.

### 4.2 Phone → Syncthing → note

| Friction | Why it hurts | Smooth it |
|---|---|---|
| 30-minute settle | Correct for Syncthing, but feels like a hang | Status: *settling, ~Xm left*; `VOICE_SETTLE_MS` for tests; force from UI |
| Transient names (`~syncthing~`, `.tmp`, conflicts) | Already skipped — good | Keep; surface skipped counts in `/status` |
| Filename must be `YYYY-MM-DD*` | Other phone formats never organize; they sit in the root | Broader date parsers; unmatched files go to `_unfiled` with a reason, not silence |
| Organize vs transcribe race | Root watcher (depth 2) can start whisper on the pre-move path while organize moves it | One pipeline: settle → organize → transcribe on the **final** path |
| Collision → `_holding/` | `_holding` is treated as transient, so those files **never transcribe** | Inbox for holding: rename / overwrite / skip; then process |
| `__inbox/` | Staging folder; leave it out of watch/load/organize for now | Same skip list as `_holding` until an inbox flow exists |
| Multi-root dest bug | Every organizer writes into `watch.roots[0]` | Dest = the root that fired the event |

**Blocker:** Syncthing latency is inherent. Do not shorten the default for phone roots. Make the wait visible and skippable.

### 4.3 Browser record / drop

| Friction | Why it hurts | Smooth it |
|---|---|---|
| Same 30-minute settle as Syncthing | Record, then nothing happens for half an hour | `browserDropFolder` settle = 0 (or a few seconds); `saveAudioFile` then `process(..., { force: true })` |
| Mic permission on page load | `getUserMedia` in `onMount` — drop-only users get a prompt | Request mic only on Record |
| Clip “Delete” / rename is cosmetic | DOM-only; server file stays | Delete/rename go through the API and update the sidecar |
| Base64 over Socket.IO (100MB buffer) | Large drops are slow and can fail | `POST /audio` multipart; socket for events only |
| Recording MIME vs filename | Blob is `audio/ogg; codecs=opus`, saved as `.webm` | Use the real MIME / MediaRecorder `audio/webm` and matching extension |
| Date in the filename is US locale | `08-16-2026_15-06-00` does **not** match organize `YYYY-MM-DD` | Always `YYYY-MM-DD_HH-mm-ss` |

**Blocker:** the UI path is the worst settle mismatch. This is the first thing to fix for “I just recorded something.”

### 4.4 Transcription (GPU)

| Friction | Why it hurts | Smooth it |
|---|---|---|
| New Python process + model load **per file** | `large-v3` load can dwarf the audio | Long-lived worker: load once, stdin/stdout or a tiny local HTTP server |
| Windows CUDA teardown `0xC0000409` | Already mitigated (`os._exit(0)` + keep JSON if complete) | Keep; document; treat as success only when JSON validates |
| Concurrency 1 | Correct for VRAM | Keep; show queue depth in UI |
| Language hardcoded `en` | Non-English notes degrade | `whisper.language` in config (`en` default, `null` = auto) |
| No progress in the UI | Python already logs `%` | Forward lines over the socket as `transcription-progress` |

**Blocker:** model reload is the largest runtime cost. A persistent worker is the highest-leverage performance change.

### 4.5 Cleanup (ollanet)

| Friction | Why it hurts | Smooth it |
|---|---|---|
| Remote machine / model must be up | Cleanup sits in `rawOnly` with no retry UI | Health + retry + “skip cleanup” mode |
| No timeout / backoff | One hung prompt stalls the processing queue | Timeouts, N retries, then `cleanupError` on the sidecar |
| Prompt + Zod schema are good | Keep | Optionally persist `promptVersion` on the JSON |
| `parseJSON` strips fences | Needed while models wander | Keep until ollanet `format` is reliable; then tighten |

**Blocker:** if the Mac (or whatever ollanet host) is asleep, the GPU work is still useful. Raw text must be first-class in the UI, not a failed end state.

### 4.6 Reading / editing results

| Friction | Why it hurts | Smooth it |
|---|---|---|
| Table shows path + raw segments only | The product output is `cleanedTranscription` + `tags` | Note inbox: cleaned body, tags, raw toggle, player |
| Reconnect appends duplicates | `transcriptions = [...transcriptions, data]` | Upsert by `jsonFile` |
| Copy copies raw segments | Users want cleaned text | Copy cleaned; optional “copy raw” |
| `expandedRows` is a plain array | Svelte 3 will not re-render on `expandedRows[i] = …` | Writable store or reassignment |
| No playback in the list | Must hunt the file on disk | `<audio>` from `GET /audio?file=` (allowlisted) |
| No search / tag filter | Tags are written and then unused | Filter chip + text search |
| Last socket wins | Second tab / reconnect steals live updates | `io.emit` to all clients; drop `ioSocket` singleton |

---

## 5. Rough spots (correctness and leftover extract)

### 5.1 Ports, CORS, and the socket URL — daily-use break

- README and CORS were `http://localhost:5173`; Vite was **6173**; client hardcoded `localhost:8008`.
- CORS also allowed `https://example.com` (Chilon host).

**Locked:** UI origin is **7777**. Vite proxies `/socket.io` and API paths to `127.0.0.1:8008`. Broadcast with `io.emit`. `example.com` is gone from the example.

### 5.2 Organize is Windows-path and first-root only

```text
filePath.split('\\')                          // POSIX / mixed paths drop the name
fileMatchRegex: /\\(\d{4})-(\d{2})-\d{2}/     // needs a backslash in the path
organizeAudioFile(..., sourceFolders[0])      // wrong dest when roots.length > 1
```

**Do:** `path.parse` / `path.basename`. Match `YYYY-MM-DD` on the **filename**, not the full path. Pass the watcher root in as `sourceRoot`.

### 5.3 ffmpeg denoise is brittle

- `child_process.exec` with a quoted path string — spaces/`&`/`'` on Windows will break.
- Filter graph always encodes **libmp3lame**, then copies over the original path, so a `.webm` / `.m4a` may contain MP3 bytes.
- `_clean` leftover if the process dies between write and unlink.
- Success is “`_original` exists”; a failed half-write can skip forever.

**Do:** `spawn` with argv (no shell). Write `_clean` as `.mp3` **or** re-encode in-place and rename to `.mp3` consistently. Atomic replace. Treat `_original` + valid audio as the success mark.

### 5.4 Sidecar filename helper is incomplete

`getTranscriptionFilename` only strips `.mp3|.webm|.m4a`. A future `.wav` / `.ogg` / `.flac` becomes `file.wav.json` or fails the “already transcribed” check.

**Do:** `path.parse(file)` → `${name}.json` in the same directory. One shared `AUDIO_EXTENSIONS` list.

### 5.5 Queue callback shape

`whisperTranscribe` calls `callback({ err, result })`. `async.queue` expects `(err, result)`. `Queue.error` then checks `err?.err`. It works by accident.

**Do:** normalize to `(err, result)`. Delete the Chilon “pause until external event” comments. Type `TranscriptionTask` / `ProcessingTask`.

### 5.6 Settle `started` set

After a successful run, the key stays in `started` forever. That is good against double-fire. It is bad for intentional re-run: force still hits `if (started.has(key)) return`.

**Do:** force clears `started` for that key. Optional `resetSettle(file)` for retry.

### 5.7 Comment / default drift

`fileSettleLib.ts` says “default 60” and “VOICE_SETTLE_MINUTES (default 60)”. Code and README are **30**. Fix the comment when touching the file.

### 5.8 Config is not a schema

Zod is a dependency but unused for config. Defaults include a real machine and model. `loadConfig` writes back into `process.env`, so import order matters.

**Do:** Zod `DictaConfig` with `.strict()` or strip-unknown. Fail fast on missing `watch.roots` or unreadable Python. Example file uses `"YOUR-OLLANET-HOST"` / `"YOUR-CLEAN-MODEL"`. Do not mutate env except in a dedicated `applyConfigToEnv()` for the few vars the settle helper still reads — or stop reading env inside `fileSettleLib` and pass `settleMs` in.

### 5.9 Trust model (local-first, not open)

`POST /transcribe/force`, `POST /process/force`, and `delete-transcription` take arbitrary paths. CORS includes a public origin.

**Do:** resolve + allowlist against `watch.roots` + `browserDropFolder` (and their realpaths). Bind `127.0.0.1` by default. Document “this is a personal workstation service.” No auth required for localhost-only v1.

### 5.10 UI is still a demo

- `CollapsibleAside` is MDN “Web dictaphone” help text.
- Recorder is imperative `document.querySelector` / `createElement` inside Svelte.
- Svelte 3 / Kit 1 / Vite 4 — fine to keep for a polish pass; upgrade is a later workstream, not a gate.
- Client depends on `socket.io` (server package) unused.

**Do:** delete the aside or replace with DictaWhisper help (settle, force, tags). Rewrite recorder as Svelte state. Drop unused deps.

### 5.11 In-memory `transcriptions` vs disk

The map is filled only when `emitTranscription` runs. Restart + UI connect only sees what chokidar `add` already processed into memory. `/status` walks disk; the UI does not.

**Do:** on listen, scan roots for sidecar JSON (cap if needed) and emit the set. Disk remains source of truth; memory is a cache.

### 5.12 Identity leftover in docs and defaults

README ping example, `config.ts` fallbacks, `config.example.json`, and the initial commit message all name `YOUR-OLLANET-HOST` / `YOUR-CLEAN-MODEL` / `example.com`. That is fine as *your* `config.json`. It is wrong as the public example.

---

## 6. Workstreams

Priority: **P0** correctness / daily loop, **P1** friction, **P2** product, **P3** harden. Estimates are relative (S/M/L), not calendar.

### W0 — Identity and repo hygiene (P0, S)

- Gitignore `config.json`; stop tracking the personal file (keep a local copy).
- Neutral `config.example.json` and README (ports, placeholders, Python deps).
- `pnpm` workspace: root + `client`, one lockfile, `pnpm dev` / `pnpm start` / `pnpm ui`.
- Scripts: `typecheck`, `doctor`. Cross-platform `turbo` (no bare `WHISPER_MODEL=turbo` if you care about cmd.exe; bash is fine if documented).
- Align Vite **7777** with CORS and README.

### W1 — Make the UI path instant (P0, S)

- `browserDropFolder`: settle 0 (or `watch.browserSettleMs`).
- After `saveAudioFile`, `process(file, null, { force: true })`.
- Record filenames `YYYY-MM-DD_HH-mm-ss`.
- Mic only on Record.
- Force-clear settle `started` so retry works.

### W2 — Single pipeline: settle → organize → transcribe (P0, M)

- Per root: wait until settled, organize onto the final path, then enqueue transcription for **that** path.
- Do not run a depth-2 transcribe watcher on the same files independently.
- Filename date on basename; dest = that root.
- `_holding` and `_unfiled` are visible, not skipped-forever. `__inbox` stays skipped until an inbox flow exists.
- Shared `AUDIO_EXTENSIONS`; sidecar via `path.parse`.
- Inbox first load is a summary index; full sidecar hydrates on expand; older months load as you scroll.

### W3 — Live updates and inbox v1 (P0, M)

- `io.emit('transcription' | 'progress' | 'status')` to every client.
- Client upsert by `jsonFile`; show cleaned text, tags, status, elapsed.
- Copy cleaned; expand raw segments; delete/force from the row.
- `GET /status` on a timer or socket for pending / raw / done / queues.
- Remove MDN aside.

### W4 — Preflight and honest health (P0, M)

`pnpm run doctor` and `/health` should report, not assume:

- Node version, config parse
- Each watch root exists (or create-if-empty flag)
- ffmpeg
- `whisper.python` import `faster-whisper`
- Device: cuda vs cpu (warn, do not crash on cpu)
- ollanet ping (warn if down — raw mode still works)
- Port bind

Startup prints the same summary. Do not start queues until config is valid; ollanet may be degraded.

### W5 — Path allowlist and bind localhost (P0, S)

- All file APIs: realpath is under an allowed root.
- `http.host` default `127.0.0.1`.
- Drop `example.com` from the example.

### W6 — ffmpeg without the shell (P1, S)

- `spawn` argv; consistent output format; atomic replace; leftover `_clean` cleanup.

### W7 — Persistent Whisper worker (P1, L)

- Long-lived Python process, model loaded once.
- Node sends `{audio, output, model, device, ...}`; worker streams progress; writes JSON; replies `{ok, elapsed}`.
- Keep `os._exit` / CUDA teardown handling on **worker shutdown**, not per file.
- Fallback: current spawn path if the worker dies.

This is the main GPU-friction item. Do it after W1–W2 so you are not optimizing a racy pipeline.

### W8 — Cleanup resilience (P1, M)

- Timeout, retry, `cleanupError` + `cleanupAttempts` on the sidecar.
- UI: Retry cleanup / Skip.
- Config: `ollanet.required` (default false).
- Optional `promptVersion` on the JSON.

### W9 — Upload and audio serving (P1, M)

- `POST /audio` multipart → `browserDropFolder` → force process.
- `GET /audio` allowlisted stream for the player.
- Shrink Socket.IO `maxHttpBufferSize` after uploads leave the socket.

### W10 — Config schema (P1, S)

- Zod for `DictaConfig`.
- `fileSettleLib` takes `settleMs` from config, not a parallel env world.
- Stop baking personal hostnames into code defaults.

### W11 — Inbox v2 (P2, M)

- Search, tag chips, date grouping (`YYYY/MM`).
- Player + cleaned/raw toggle.
- Tag consolidation: preview near-duplicates (local spelling + ollanet synonyms), apply rename across sidecars.
- Holding / unfiled review.
- Empty and first-run states that point at `doctor`.

### W12 — Types, tests, shutdown (P3, M)

- Shared `TranscriptionDocument` type (TS + JSON Schema).
- Tests: settle, organize dest, filename dates, allowlist, config merge, `parseJSON`.
- Graceful shutdown: close watchers, drain or persist queue, kill Whisper worker.
- `pnpm typecheck` in both packages.

### W13 — Client stack (P3, L, optional)

- Svelte 4/5 + Kit 2 **or** drop Kit (this is a SPA; `adapter-auto` is unused in daily use).
- TypeScript in `client/`.
- Not a gate for W1–W11.

---

## 7. External blockers (cannot code away)

| Blocker | What we can still do |
|---|---|
| Syncthing is eventually consistent | Visible settle; force; ignore temp/conflict names |
| CUDA / VRAM / Windows driver | `doctor`; CPU / `int8_float16` fallback; keep teardown workaround |
| ollanet host asleep or unreachable | Degraded mode; raw text is complete enough to read |
| `large-v3` is slow and heavy | Persistent worker; `turbo` as a first-class switch in the UI |
| Phone app filename format | Document the `YYYY-MM-DD*` convention; parse more variants; `_unfiled` |
| Two-machine split (GPU PC + LLM Mac) | Health that names **which** machine failed |
| Personal journal on disk | Localhost bind; no cloud; `saveChats: false` by default (already) |

Do not add a cloud STT or a hosted LLM in this pass. The point of the extract is local GPU + ollanet.

---

## 8. Recommended sequence

```
W0 hygiene     ─┐
W1 UI instant  ─┼─► W2 single pipeline ─► W3 inbox v1 ─► W4 doctor
W5 allowlist   ─┘                              │
                                               ├─► W6 ffmpeg
                                               ├─► W8 ollanet retry
                                               ├─► W9 upload/player
                                               ├─► W10 config schema
                                               └─► W7 whisper worker (after pipeline is single-path)
W11 inbox v2, W12 tests, W13 client upgrade
```

**First implementation slice (smallest “it feels like a product”):** W0 + W1 + W5 + port/socket fix from W3. That removes the 30-minute browser wait, the CORS/port trap, and the committed personal config.

**Second slice:** W2 + W3 + W4. Pipeline stops racing itself; the inbox shows cleaned notes; first-run is diagnosable.

**Third slice:** W6–W10. Less brittle I/O, faster GPU, cleanup that fails loudly.

---

## 9. Success criteria

- Fresh clone: example config + `pnpm run doctor` + `pnpm dev` is the whole setup story (plus Python venv and ffmpeg).
- Browser record appears in the inbox within seconds of Stop, not after `settleMinutes`.
- Phone notes show *settling* then move to `YYYY/MM/` and transcribe **once**, on the final path.
- Two browser tabs both receive live updates.
- Cleaned text and tags are the default view; raw segments are one click.
- `/health` and the UI agree on queue depth, whisper model, and ollanet reachability.
- Force / delete / process only accept paths under configured roots.
- `config.json` is local; the repo example has no personal hostname or home directory.
- Re-running force on a note actually re-runs.

---

## 10. Out of scope for this pass

- Multi-user / auth beyond localhost bind.
- Mobile app (Syncthing + phone recorder stays).
- Cloud transcription or non-ollanet cleanup (keep a config hook, do not build it).
- Full-text search index / embeddings.
- Speaker diarization, timestamps-as-editor, or a timeline editor.
- Windows service / tray app (nice later; `pnpm start` is enough).
- Publishing to npm or a GUI installer.
- Chilon feature parity that is not voice-journal (chat, other watchers, etc.).

---

## 11. Decision log (locked 2026-08-16)

1. **UI port:** **7777**. API stays `127.0.0.1:8008`. Vite proxies `/socket.io` and API paths so the browser only opens 7777.
2. **Browser settle:** **0**, plus `{ force: true }` on save. Phone/watch roots stay at 30 minutes. `{ retry: true }` clears the in-process latch so force actually re-runs.
3. **Denoise output:** **always `.mp3`** for the working file; keep `_original` with the real source bytes. (W6, not this slice.)
4. **Whisper worker:** **stdin/stdout JSON lines**. (W7, not this slice.)
5. **Client upgrade:** **after inbox v1** (W13).
6. **Kit vs Vite SPA:** keep Kit for now.

---

## 12. File-level touch list (when implementation starts)

| Area | Files |
|---|---|
| Hygiene | `.gitignore`, `config.example.json`, `README.md`, `package.json`, `pnpm-workspace.yaml`, `config.ts` |
| Settle / browser | `fileSettleLib.ts`, `audioLib.ts`, `transcriptionLib.ts`, `server.ts` |
| Organize | `organizationLib.ts`, `fsLib.ts` |
| Live / API | `server.ts`, `socketEvents.ts`, `apiRoutes.ts` |
| UI | `+page.svelte`, `Transcriptions.svelte`, `AudioRecorder.svelte`, `CollapsibleAside.svelte`, `vite.config.js` |
| Doctor | new `src/doctor.ts` or `scripts/doctor.ts` |
| ffmpeg | `audioLib.ts` |
| Worker | `scripts/transcribe_faster_whisper.py`, `whisperLib.ts` |
| Schema | `config.ts`, new `src/types/transcription.ts` |

Do not “tidy” the Python script’s CUDA `os._exit(0)` without a replacement. That is load-bearing on this Windows box.
