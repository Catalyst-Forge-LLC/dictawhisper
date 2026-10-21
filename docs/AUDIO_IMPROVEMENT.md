# Audio improvement and retranscription

Date: 2026-10-21

Scope: A per-entry recovery flow for difficult audio using FFmpeg and the existing faster-whisper runtime. Parakeet, Qwen, neural denoiser installation, bulk reprocessing, and changes to routine import preprocessing are outside this batch. No operator recordings are automatically retranscribed.

## Experience

Open **Reader → More → Improve audio & retranscribe…**. This is separate from **Reprocess readable transcript**, which only reruns text cleanup.

1. Select Quiet speech (default), Uneven volume, Background noise, or Unfiltered original.
2. Choose large-v3 (default for this action) or turbo. This is a per-attempt setting; it does not change the global model preference. Speech detection is an optional disclosure, off by default to include faint speech; the copy explains possible false words during silence.
3. Prepare the audio preview. Original lookup checks every supported `_original` container before using the ordinary working file. If no separate original exists, the UI identifies the available source instead of claiming it is untouched.
4. Switch original/enhanced at the same playhead. Only one player plays at a time. Recording pauses the preview.
5. Create a candidate transcript. Closing the dialog or reloading the page does not discard server work. Reopen the same entry action to check progress. Progress uses actual phases, not invented percentages.
6. Compare current and candidate machine transcripts. Desktop places them side by side; phones show the new transcript first. Select **Use new audio & transcript** or **Keep current version**. Readable cleanup remains an explicit next action after acceptance.
7. Reopen the action for **Undo · restore previous version**. Undo is conditional on the accepted transcript remaining unchanged; later text/cleanup changes block automatic Undo rather than overwriting newer work. Earlier snapshots remain on disk.

The dialog uses native modal focus containment, Escape/Close, focus return to More, visible focus, native inputs, keyboard-scrollable/copyable read-only textareas, 44px action targets, and a sticky action row. A failed request keeps the attempt and offers Refresh status to reconcile an uncertain write.

## Audio contract

All presets read a private snapshot of the source and write PCM WAV. They never trim leading silence, stretch time, re-encode MP3, or alter source bytes. Duration must remain within 150ms of the source or the attempt fails. There is a 30-minute FFmpeg timeout.

| Preset | Processing | Limits |
| --- | --- | --- |
| Quiet speech | Measure average and peak; gain toward -22 dB average, limited by -1 dB peak headroom and a 30 dB boost cap | Loud peaks can limit useful gain; the preview recommends Uneven volume in that case. Near-silence gets a warning. |
| Uneven volume | `dynaudnorm=f=250:g=15:p=0.89:m=10` | Conservative peak target and maximum gain. No claim of improved recognition on every recording. |
| Background noise | 80 Hz high-pass, `afftdn=nr=8:nf=-50:tn=1`, then the same leveling | Mild steady-noise/rumble treatment; not source separation, dereverberation, or reconstruction. |
| Unfiltered original | PCM conversion only | A baseline transcription from the source without enhancement. |

The existing import preprocessing remains unchanged. The new action bypasses it and always starts from the best available original rather than repeatedly processing an enhanced version. FFmpeg and faster-whisper are existing dependencies; no new model family/runtime is installed.

## State, storage, and preservation

- Job phases: preparing → preview → transcribing → ready → applied. Discarded, failed, and reverted are explicit outcomes. On restart, unfinished jobs become retryable failures; no model runs automatically on restoration.
- Each attempt has a random UUID and is bound to a stable entry ID. Source snapshots, candidate WAV/JSON, the previous entry JSON, and job receipts live under a configured root's `.dictawhisper/audio-improvements/<id>/`. Watchers ignore this directory.
- Acceptance copies and verifies an immutable `<entry>_enhanced-<uuid>.wav` sibling before atomically selecting it and its transcript in one sidecar write. The new sidecar field is `audioEnhancement: { versionId, preset, model, appliedAt }`. A missing selected WAV is an audio error, not a silent fallback to differently timed audio.
- Enhanced siblings are excluded from independent import/indexing and included in entry move/Trash/restore bundles. UUID-based saved history continues to resolve after path changes. Confirmed permanent Trash deletion also removes that entry's hidden improvement artifacts.
- Current display title, recording identity/date, stars, tags, arbitrary unrelated sidecar fields, MayDo IDs/titles/statuses, and extraction provenance survive acceptance. Transcript-dependent cleanup and playback cues are replaced/invalidated. Existing MayDo timestamps become null because older preprocessing may have trimmed the source timeline. Quotes and decisions remain available; extraction refreshes their relationship to the new transcript.
- Baseline transcript fingerprints reject stale acceptance. Undo restores only transcript-owned fields, preserving subsequent human metadata and MayDo status edits. Saved source quotes are used to restore matching prior MayDo timings.
- Entry operation locks prevent concurrent processing/moves during a running attempt or acceptance. Whisper jobs, model switches, and one-shot fallbacks share one queue. VAD options reach both worker and fallback paths. Fallback processes have a 45-minute timeout and late worker exits cannot reset a newer worker.
- Discard removes only the known candidate artifacts; accepted history persists for recovery until confirmed permanent deletion. Lossless files and retained versions consume additional disk space.

## HTTP contract

Every operation resolves the configured watch-root allowlist and binds attempts to the requested entry. Client paths cannot choose storage destinations or arbitrary FFmpeg filters.

| Method | Path | Input/result |
| --- | --- | --- |
| GET | `/notes/audio-improvement` | `file`, optional `id`; current attempt, current text, active version, history summaries, transcription availability |
| GET | `/notes/audio-improvement/audio` | `file`, `id`, `variant=source|enhanced`; native range-capable audio response |
| POST | `/notes/audio-improvement/prepare` | `{file,preset,model,vadFilter}`; 202 durable attempt, duplicate running requests reuse it |
| POST | `/notes/audio-improvement/transcribe` | `{file,id}`; 202 queued/running attempt, supports failed transcription retry |
| POST | `/notes/audio-improvement/apply` | `{file,id}`; acknowledged, idempotent acceptance |
| POST | `/notes/audio-improvement/restore` | `{file,id}`; conditional, idempotent Undo of the active version |
| POST | `/notes/audio-improvement/discard` | `{file,id}`; retain current entry and remove unaccepted artifacts |

## Delivery tracker

| Packet | Status | Evidence | Notes / issues |
| --- | --- | --- | --- |
| AR01 — Preparation and model options | Verified | `audioEnhancement.test.ts`: real FFmpeg tests for all four presets, level/peak limits, source immutability, duration, cross-format original discovery; `whisperOptions.test.ts`: actual Node/Python worker and forced one-shot fallback with a fake ASR module, model-switch serialization and VAD propagation; runtime build | No accuracy benchmark on the operator's recordings. |
| AR02 — Durable candidates and preservation | Verified | `audioRescue.test.ts` and `entryRecovery.test.ts`: acceptance/Undo, stale changes, current human edits, restart retry, empty model output, entry binding, path confinement, moves/Trash/restore, permanent deletion | Recovery snapshots are local files; arbitrary historical-version browsing is not added. |
| AR03 — Reader workflow | Verified | Production client build; isolated browser fixture uses real FFmpeg and deterministic ASR output | Desktop 1280×720 and phone 390×844 inspected; prepare, original/enhanced switching, close/reopen, reload, accept, updated reader, Undo, restored reader, and Escape/focus return exercised. Physical touch and assistive-technology testing remain manual. |
| AR04 — Optional later work | Deferred | Explicitly outside this implementation batch | Resumable bulk queue, neural enhancement, alternative engines, accuracy comparisons, and revisiting routine import preprocessing. |

### Execution notes

- 2026-10-21: Inspected the current fixed silence-removal/denoise/gain/MP3 chain and existing worker, identity, operation-lock, bundle, and reader contracts. Chose an opt-in recovery path to preserve existing entries and avoid applying one enhancement to the entire journal.
- 2026-10-21: Complete test suite passed: 175 tests, no failures or skips. Real FFmpeg fixtures verify signal processing behavior. ASR is controlled in service/browser tests; these do not establish recognition quality or GPU performance.
- 2026-10-21: Browser inspection at 1280×720 caught hidden review actions; shortened comparison panels and made the action row sticky. At 390×844 the candidate appears before the current transcript.
- 2026-10-21: Two additional Python bridge tests passed, covering large-v3/turbo and VAD options through both worker and forced fallback. The installed tarball smoke test passed (help/init/refusal/doctor) using a temporary npm cache after the default cache rejected writes. No publication was attempted.
- A system TTS smoke sample could not be generated because the executor had no usable installed voice. No operator recording was substituted. Actual model recognition quality remains unmeasured.

## Package/release record

The enrolled npm package is `dictawhisper` at `Z:/workspace/dictawhisper`, not the private `client` harness. Version authority: root `package.json` (0.1.15). README source: root `README.md`. Build: `pnpm build` (runtime TypeScript plus client). Pack: `npm pack` invokes `prepack`; isolated validation uses `node scripts/pack-smoke.mjs` after building and packs with `--ignore-scripts` to avoid repeating the build. Release is a separate operator-authorized action through LocalHelm Publish or `npm publish` after checks/versioning.

LocalHelm read-only status resolved the correct root package, manifest, README and CLI executable. Its initial Git inspection hit sandbox ownership; a process-scoped `safe.directory` setting corrected that without changing global Git configuration. The Publish plan currently skips the dirty checkout and reports unavailable npm authentication. Registry and local version both read 0.1.15; that does not mean these new source changes have been published. No push, version bump, or publication is performed in this batch.

## Reproduce browser verification

Build the client, then run the existing isolated fixture with `DICTA_FIXTURE_AUDIO_RESCUE=1`:

```powershell
pnpm --dir client build
$env:DICTA_FIXTURE_AUDIO_RESCUE='1'
node --experimental-strip-types scripts/ux01-fixture.mjs
```

Open `http://127.0.0.1:17778/`, search `filename:198` or `filename:199`, and open More → Improve audio & retranscribe. Source audio is a generated tone, enhancement is real FFmpeg, and candidate speech text is explicitly synthetic. No real journal or LLM service is used. Stop the fixture after testing; its guarded shutdown deletes only its own temporary fixture directory.
