# Bark Pro: one-recording comparison

Status: implemented, experimental. Bark Pro is an optional English recognition engine for listening comparisons. Whisper remains the normal import, batch and replacement engine. No journal is reprocessed by setup.

## Try one recording

1. Install the runtime below once. Restart DictaWhisper after updating the app and refresh the browser.
2. Open an entry → **More → Improve audio & retranscribe…**.
3. Choose **Bark Pro · experimental comparison**. Start with **Unfiltered original** to judge recognition, or **Uneven volume** for the quiet/uneven recordings that already benefited from leveling. Automatic is also available; audio preparation is shared with Whisper.
4. **Prepare audio preview**, listen if needed, then **Create new transcript**. The transcription queue must be enabled. Closing the dialog leaves the job running.
5. Compare the raw text with the audio. Use Passage, Previous/Next and Play from; switch Original/Enhanced at the same position. Expand **Full transcript comparison** to see the current and Bark text together. **Copy Bark text** and **Download comparison JSON** preserve the raw output.
6. **Done · keep comparison** saves it for later review. Reopen from the entry's new-transcript banner or the same More action. **Discard comparison** removes that attempt. Bark has no Use new action in this trial; the server also rejects attempts to apply it.

Listen for omissions, added words, negatives, names, numbers, quiet speech, fillers and transitions between input windows. A fluent sentence is not evidence that the words match. No accuracy score is inferred from model confidence. Existing Readable text is not a suitable verbatim baseline; compare Original machine text and listen to the source.

## Isolated Windows setup

Requires Python 3.11, FFmpeg/ffprobe and, by default, an NVIDIA GPU/driver supporting CUDA 12.8 and BF16. The exercised GPU is an RTX 4000 Ada Generation Laptop GPU with 12 GB VRAM. Allow several GB for PyTorch and model files.

From the package/repository root in PowerShell:

```powershell
& ./scripts/setup-bark.ps1 -Python 'C:/path/to/Python311/python.exe'
& ./.venv-bark/Scripts/python.exe ./scripts/transcribe_bark.py --check
```

The installer creates `.venv-bark` and downloads model data into `data/models/bark-pro`. It never changes `whisper.python` or installs into the Whisper environment. PyTorch 2.8.0 + CUDA 12.8, Transformers 5.19.0 and the small runtime requirements are pinned. Setup uses official PyTorch/PyPI/Hugging Face sources. Inference is offline, uses `trust_remote_code=False` and accepts only the pinned model revision. The weights, environment, generated audio and comparison output are excluded from Git and the npm package.

CPU testing is explicit: pass `-Cpu` to setup, then set `$env:DICTA_BARK_DEVICE='cpu'` in the shell that starts DictaWhisper. CPU performance/quality parity is not verified. There is no silent CPU fallback. Optional `DICTA_BARK_PYTHON` and `DICTA_BARK_MODEL_DIR` point to an existing isolated runtime and model directory. macOS/Linux setup is not automated by this Windows installer.

If the model option reports missing setup, run the installer and choose **Check Bark setup**. Runtime/CUDA errors stay on the attempt and offer Retry transcription. The app never downloads a model as a side effect of selecting the option. A run times out after 45 minutes; the saved entry remains in place.

## Timing and transcript fidelity

Transformers' Parakeet TDT decoder returns token durations. The adapter converts these into word and passage estimates, accounts for the model runner's 0.25-second leading silence, and checks that the timed token text equals the decoded text. It rejects nonfinite, reversed, out-of-window or out-of-order timing. Timing is never borrowed from Whisper or distributed evenly over a recording.

Passages break at model-generated punctuation or 45 words; this changes presentation only. Punctuation, wording, repetitions and fillers are not rewritten by DictaWhisper or passed to a cleanup LLM. Bark itself can still omit or hallucinate words.

Long recordings are streamed in contiguous windows of at most 60 seconds, with the cut chosen near a low-energy point in the final quarter of the window. There is no VAD or dropped quiet audio. Every input sample belongs to exactly one window, but recognition context can be lost at boundaries. Native timing is an estimate, not forced alignment or a correctness guarantee. If any nonempty window has unusable timing, all passage times are withheld and the UI offers recording-window navigation explicitly labeled as input windows, not word locations.

The candidate JSON on disk retains raw text, native word/passage estimates, window text, model/revision, runtime/device/dtype, prepared-audio SHA-256 and timing warnings. The browser receives passage times and run metadata; its JSON export omits word-level arrays. Processing duration includes Python imports, model load, preprocessing and inference inside the runner, but excludes queue waiting and FFmpeg preparation. Model-load and generation durations are separately reported. The Python process exits after the comparison; the next Whisper job reloads its worker.

## Storage and integration boundaries

Uses existing audio-improvement jobs under the entry's allowed watch root: `.dictawhisper/audio-improvements/<attempt-id>/`. `source.<ext>` is a snapshot, `enhanced.wav` the prepared 16 kHz copy, `candidate.json` the experiment, and `job.json` its durable state. Setup alone creates none of these entry jobs. Preparation may assign the existing stable `entryId`; original audio, current transcript, cleanup, stars, tags and MayDo decisions are retained.

Bark and Whisper share the process's ASR queue. The active Whisper worker finishes and unloads before Bark starts; the next Whisper job loads normally. This coordination applies inside one DictaWhisper server process, not unrelated external GPU applications. Background import and batch model choices are unchanged. Acceptance, cleanup, MayDo extraction and library-wide Bark backfill are deliberately outside this first comparison.

For CLI experiments, prepare a separate WAV first; output must be a new file:

```powershell
ffmpeg -n -i 'recording.m4a' -ar 16000 -c:a pcm_s16le 'comparison.wav'
& ./.venv-bark/Scripts/python.exe ./scripts/transcribe_bark.py --audio 'comparison.wav' --output 'bark-comparison.json'
```

## Evidence and remaining work

| Packet | Status | Evidence / notes |
| --- | --- | --- |
| BK01 — Local adapter and setup | Verified | Isolated installer rerun; `pip check`; CUDA/BF16 readiness; pinned weights loaded locally. A known 22.016s synthesized recording matched every word, including “um,” negation and number corrections, with five native timed passages. |
| BK02 — Long inputs and timing | Verified on synthetic audio | A 66.049s repetition crossed a 45.42s quiet-point boundary with contiguous coverage, identical normalized words and valid native timing. Unit tests cover subwords, punctuation, padding/offsets, invalid timing and unchanged text across passage sizing. This is not validation on noisy personal recordings. |
| BK03 — App comparison and isolation | Verified | 222 tests passed without skips; typecheck and production build passed. Timed/untimed candidates, restart review, apply rejection, error/retry, source/human metadata preservation and shared queue ordering are covered. Actual FFmpeg → Node adapter → GPU model → stored candidate smoke also passed: 22.016s input, five timed passages, exact expected text, approximately 20.2s end to end (17.2s inside the Python runner, including imports). |
| BK03a — Reader review and export | Verified with synthetic UI fixtures | Desktop 1280×720 and phone 390×844 checked; no horizontal overflow. Passage seeking, navigation, exact clipboard text, JSON download, close/reopen, reload discovery and clearing Whisper-only VAD on a Bark selection passed. The export carries raw text, passage timing and run metadata. No production journal was modified. |
| BK04 — Real-recording quality decision | Awaiting operator listening | Try a difficult recording. Decide whether timing and verbatim fidelity justify a later acceptance path. No default engine change or bulk Bark run. |

## Upstream and licensing

Model: [Conway Research / Underdog Bark 3.0 Pro](https://huggingface.co/ConwayResearch/Underdog-Bark-3.0-Pro), revision `4b5c51e04aa8d16dda9ecdff71bc29f7360149e4`. The model card declares CC BY 4.0; setup retains its README and NOTICE. Preserve upstream attribution and notices when redistributing the model. This repository packages the adapter, not model weights. [Transformers Parakeet documentation](https://huggingface.co/docs/transformers/model_doc/parakeet) describes the TDT timing API. The Pro model is used for verbatim comparison; the Clean variant is not used.

Release target remains root `dictawhisper` at 0.1.15, version from root `package.json`, README from root `README.md`. Build with `pnpm build`; `npm pack` invokes that build through prepack. The private `client` package is only the UI build harness. LocalHelm read-only status and Publish plan resolved the root package; the plan skipped dirty work and reported unavailable npm authentication. Pack inspection verified the runtime, four Bark setup/runner files, this guide, root README and UI assets, with no model weights, environments, private client harness or audio. No version bump, push or publication. Restart the existing app process and refresh its browser to load this checkout change.
