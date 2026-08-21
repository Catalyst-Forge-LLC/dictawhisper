# Voice inbox: file, convert, stamp

**Status:** first pass in progress (organize + convert inside `__inbox` only)  
**Date:** 2026-08-20  
**Surface:** watch-root filing, not a new UI route  
**Sources:** `E:\archives\old-webroot\sandbox\tools\voicenote_sanity.php`; live tree `C:\Users\acmegeek\VoiceNotes`; sibling [mediatuna](https://github.com/Catalyst-Forge-LLC/mediatuna)

**First pass (locked):** work only under `VoiceNotes/__inbox`. File into `__inbox/YYYY/MM/` (not the live `2021/`–`2026/` journal). Convert non-MP3 → MP3 with MediaTuna. No transcription, no denoise, no sidecars. Older `.txt` / subtitle transcriptions stay put. Commands: `pnpm inbox:organize --dry-run` then `--apply`; `node scripts/inbox-convert-non-mp3.mjs`.

The UI spec said do not grow an ingest page. This is a **folder pipeline** (CLI + the existing voice watcher). The Engram inbox stays a reader.

---

## 1. What the old tool actually did

`voicenote_sanity.php` was a desk for a folder of recordings plus a MySQL table (`ss_voicenote`). The table and status radio buttons (`new` / `transcribed` / `processed` / `archived` / `starred`) are historical. DictaWhisper already replaced that with sidecar JSON. Do not bring the database back.

The parts that still matter are the **three buttons** and the timestamp helper they call:

| Action | What it did |
|---|---|
| **Convert .WAV to .MP3** | Walk the tree for `.wav`, ffmpeg `-ab 128k`, `CopyTS` (copy filesystem times onto the MP3), delete the WAV |
| **Process Inbox** | Take `___INBOX` MP3s whose names start `YY-MM-DD-HH-MM-SS-…` and move them to `20YY-MM/` with a four-digit year on the filename. Then flatten day folders `YYYY-MM-DD/` into `YYYY-MM/YYYY-MM-DD-originalname.mp3` and remove the empty day folder |
| **Process/Print** | Scan dated folders, insert missing rows, play + transcribe in a textarea. getID3 for duration. `filemtime` as `voicenote_createdate` |

Inbox rename (the important bit). For `10-09-25-12-34-56-Recording.mp3`:

1. Match `^(?:[0-9]{2}-){5,}` → `10-09-25-12-34-56-`
2. Folder `20` + first two groups → `2010-09`
3. Filename = `2010-09` + the rest of the original name after `YY-MM` → `2010-09-25-12-34-56-Recording.mp3`
4. Skip if the dest already exists (print “File Exists”, leave the inbox copy)

Collision policy was **leave both**, not `_holding`. DictaWhisper already has holding; use that instead of silent skip.

`CopyTS` is not in this PHP file. The convert path always called it before deleting the WAV. That is the same job MediaTuna now does as `copyAndRepairTimestamps` (`lib/timestamps.js`): copy atime/mtime, and on Windows set CreationTime. If Created is more than 30 days after Modified (a copy/move artifact), set Created = Modified.

---

## 2. What the live tree looks like

Config watch root: `C:\Users\acmegeek\VoiceNotes`.

**Live journal** (DictaWhisper already reads this):

```
2021/ … 2026/          YYYY/MM/ + sidecar JSON
_holding/  _unfiled/
```

**Staging dump** (skipped today — `fileSettleLib` `SKIP_FOLDERS` is `__inbox` only):

```
__inbox/
  ___INBOX/            old drop box (three underscores)
  ___INBOX-convert.log
  ___INBOX-stamp.log
  ___TRANSCRIBE/  ___TRANSCRIBED/  ___UNFILED/  __SYNC/
  _holding/  _unfiled/
  2006-01/ … 2010-02/ …   old month folders (YYYY-MM, not YYYY/MM)
```

Files already in `__inbox` include both dated names (`2009-10-27-Recording001.mp3`) and bare names (`Recording10.mp3`, `grace.mp3`, `save the fed.mp3`). MediaTuna has already been run here (state + stamp/convert logs).

Two inbox spellings exist. The PHP tool used `___INBOX`. DictaWhisper skips `__inbox`. Treat both as staging. Do not watch `__SYNC` or Syncthing junk.

Old archive layout was **`YYYY-MM/` + dated basename**. Current layout is **`YYYY/MM/` + dated basename**. Filing from inbox must land in `YYYY/MM/`. Do not invent a third tree. A later optional pass can migrate leftover `YYYY-MM/` folders into `YYYY/MM/`; that is not required for the first inbox slice.

---

## 3. What DictaWhisper does today

| Step | Today | Gap |
|---|---|---|
| Watch | `initVoiceRootPipeline`: settle → `organizeAudioFile` → transcribe on the final path | `__inbox` (and anything under it) never enters the pipeline |
| Date from name | `dateFromFilename`: basename must start `YYYY-MM-DD` | `10-09-25-12-34-56-…`, `VR_2017-…`, `AudioNote-…`, `20130326 194851` go to `_unfiled` or stay put |
| Dest | `YYYY/MM/` or `_unfiled`; collision → `_holding` | Correct for the live tree. Inbox never runs |
| Convert | `cleanAudioFile` denoise → working `.mp3`, keeps `*_original` | Transcription preprocess only. No inbox “make this an MP3 first.” `copyFileSync` does **not** copy Windows Created. `moveFile` is copy+unlink (Created becomes now) |
| Extensions | `webm mp3 m4a wav ogg` | Old phones: AMR, 3GP, QCP, WMA, AAC. MediaTuna already maps those → MP3 |
| Sidecar | JSON next to audio | Keep. Inbox filing must move the sidecar with the audio if one exists |

`IMPROVEMENT_SPEC` §4.2 already named this: *“`__inbox/` stays skipped until an inbox flow exists”* and *“broader date parsers.”* This spec is that flow.

---

## 4. What to steal from MediaTuna

Do not reimplement ffmpeg date/tag/timestamp logic. MediaTuna already has the hard parts. Prefer **calling the CLI** for convert/stamp, or **importing `lib/`** if we want in-process and the APIs stay stable. First slice: CLI is enough and easier to review.

| MediaTuna piece | Use in DictaWhisper |
|---|---|
| `--audio-only` convert | Inbox (and leftover non-MP3 in `__inbox`) → MP3. Presets already exist; default `medium` (not the old 128k CBR unless we say so) |
| `--map_metadata` / ID3 | Embedded tags survive convert |
| `copyAndRepairTimestamps` | After convert **and** after `moveFile` |
| `parseFilenameDate` / `normalizeDatedBasename` | Same encodings the PHP inbox regex only half-handled, plus the ones MediaTuna already lists |
| `--stamp-dates` | Names with no date: prefix from `creation_time`, or `--prefer-mtime` as `MTIME_YYYY-MM-DD_HH-MM-SS_` (visibly not a recording time) |
| `--prefer-mtime` | Bare `Recording.mp3` in a `2009-02/` folder: folder year-month is a hint; mtime is a bound, not a lie |
| `--dry-run` | Inbox process must have a preview |
| `--stamp-dates --backup` | Optional copy of inbox originals before rename |

Do **not** pull video, `--recup-map`, or `--dupe-report` into the daily loop. Those stay MediaTuna.

Call shape (illustrative, not locked):

```bash
mediatuna "__inbox" --audio-only --recursive --prefer-mtime
mediatuna "__inbox" --stamp-dates --prefer-mtime --backup "__inbox/_originals"
```

Then file the resulting MP3s into `__inbox/YYYY/MM/` for this pass (live `VoiceNotes/YYYY/MM/` later).

If `mediatuna` is not on PATH, doctor warns; inbox convert is skipped; already-MP3 files can still file.

---

## 5. Target pipeline

```
drop / Syncthing / dump
        │
        ▼
  __inbox or ___INBOX     (settle if the root is a sync folder)
        │
        ├─ 1. convert   non-mp3 → mp3   (MediaTuna; CopyTS)
        ├─ 2. stamp     put a date on the basename if missing or nonstandard
        ├─ 3. file      YYYY/MM/<stamped-name>   (collision → _holding)
        └─ 4. transcribe  existing process() on the final path
```

Browser record/drop stays on `browserDropFolder` (immediate). Do not force those through `__inbox` unless the user drops into the watch-root inbox on purpose.

### 5.1 Convert

- Inputs: MediaTuna audio list (WAV, M4A, AAC, AMR, 3GP audio, WMA, OGG, OPUS, FLAC, QCP, …) plus our current `webm`.
- Output: sibling `.mp3` (or replace-in-place after verify, matching MediaTuna `--cleanup-originals` only when the operator asked).
- Always copy timestamps from the source onto the MP3 (and onto `*_original` if we keep one).
- Map tags. Do not invent title/album.
- Already-good MP3s: skip encode (MediaTuna `skip (normalized)`).

Old tool deleted the WAV after convert. Default here: **keep the source until the MP3 verifies**, then optional delete. Safer for a 2006–2010 dump.

### 5.2 Stamp (date in the filename)

Canonical basename (match MediaTuna + current organize):

```
YYYY-MM-DD_HH-MM-SS[_rest].mp3
```

Date-only when there is no trustworthy clock (do not invent `00-00-00` on the name):

```
YYYY-MM-DD[_rest].mp3
```

mtime-only bound (never pretend it is the recording):

```
MTIME_YYYY-MM-DD_HH-MM-SS[_rest].mp3
```

Resolution order:

1. Filename encodings MediaTuna already parses (including `YY-MM-DD-HH-MM-SS-…` → 20xx).
2. Parent folder `YYYY-MM` or `YYYY/MM` or `YYYY-MM-DD` when the basename has no date (`Recording10.mp3` in `2009-02/` → date-only `2009-02` is **not** enough for a day; use folder year-month + mtime day, or `MTIME_`, or `_unfiled` with reason `folder-month-only`). **Lock this in review.** Recommendation: folder `YYYY-MM` + file mtime, if mtime falls in that month; else `MTIME_` from mtime and leave a note in the sidecar `ingest` field; else `_unfiled`.
3. Container `creation_time` / ID3 date (ffprobe).
4. `--prefer-mtime` → `MTIME_` prefix.
5. `_unfiled` with an explicit reason. Never silent.

`dateFromFilename` must understand the canonical form **and** the old `YYYY-MM-DD-…` / `YY-MM-…` forms so already-filed notes keep grouping.

### 5.3 File into `YYYY/MM/`

- Dest root = the watch root that owns the inbox (not `roots[0]` blindly).
- Dest name = stamped basename (not the PHP `substr($file, 5)` trick).
- Collision: `_holding` + existing resolve actions. Log both paths.
- Move sidecar JSON with the audio. `relocateTranscription`.
- After move: `copyAndRepairTimestamps` (or equivalent) so Created/Modified stay the recording’s, not “today.”
- Empty day folders and empty inbox subfolders: remove only if we created them or they are now empty **and** named like a date. Do not delete `__inbox` itself.

### 5.4 Flatten day folders

Keep the PHP second pass: `YYYY-MM-DD/` (or `__inbox/YYYY-MM-DD/`) → files into `YYYY/MM/` with the date on the name if missing. Then remove the empty day folder.

Old `YYYY-MM/` folders **inside `__inbox`**: treat as already-month-grouped inbox contents. Stamp + file into live `YYYY/MM/`. Do not leave a second `2009-02/` at the watch-root top level.

---

## 6. How the operator runs it

**Daily (automatic):** watcher sees a new file under `__inbox` / `___INBOX` (not `__SYNC`). After settle, run convert → stamp → file → transcribe. Same 30-minute settle as other Syncthing drops unless the file is in the browser drop folder.

**Backfill (explicit):** a command, newest-or-oldest first, dry-run default or required `--apply`:

```bash
pnpm inbox --dir="./__inbox" --dry-run
pnpm inbox --dir="C:\\Users\\acmegeek\\VoiceNotes\\__inbox" --apply --limit=20
```

Print a table: source, action (convert/stamp/file/skip), dest, date source (filename / folder / creation_time / mtime), collision.

No new Svelte route. A later Holding-style list of “inbox queued” is optional and out of this spec.

---

## 7. Sidecar ingest record

When we convert or stamp, write a small `ingest` object on the sidecar (create a stub JSON if none exists yet):

```json
{
  "ingest": {
    "sourcePath": "…/__inbox/2009-02/Recording10.mp3",
    "sourceExt": ".wav",
    "dateSource": "filename|folder+mtime|creation_time|mtime",
    "convertedBy": "mediatuna",
    "at": "2026-08-20T…"
  }
}
```

Do not overwrite `cleanedTranscription`. Transcribe after filing as today.

---

## 8. Workstreams (after lock)

**I0 — Date parser.** Adopt MediaTuna `parseFilenameDate` / `normalizeDatedBasename` (copy or import). Expand `dateFromFilename` tests. No moves yet.

**I1 — Timestamp copy on move/convert.** `moveFile` and `cleanAudioFile` must preserve mtime and Windows Created. Share MediaTuna’s repair rule (Created ≫ Modified → Created = Modified).

**I2 — Inbox file (MP3 only).** Process `__inbox` / `___INBOX` (and day / `YYYY-MM` children) into `YYYY/MM/`. Dry-run + `--apply`. Collisions → `_holding`. Watcher: stop skipping inbox **files** once settled; still skip `__SYNC` and transients.

**I3 — Convert via MediaTuna.** Non-MP3 in inbox → MP3 first. Doctor: `mediatuna` on PATH (warn). Keep sources until verify.

**I4 — Stamp leftovers.** Bare names using §5.2 order. `MTIME_` must stay visible in the UI filename.

**I5 — Watcher hookup.** Settled inbox file runs I3→I4→I2→`process()`. Backfill command stays for the existing dump.

Order: I0 → I1 → I2, then I3/I4, then I5. I2 alone already files the dated MP3s sitting in `__inbox/2009-10/`.

---

## 9. Out of scope

- MySQL / status enums / starred / print-to-HTML from the PHP desk
- A new `/ingest` page or FilePress docs page (add a short `/docs` note later if we ship a command)
- Changing the live `2021/…/2026/` tree layout
- Video
- Shortening Syncthing settle
- Re-encoding MP3s that already meet the bar
- Deleting `__inbox` after a successful backfill (operator does that)
- Importing Engram or MediaTuna UI

---

## 10. Acceptance

1. Dry-run of the current `__inbox` prints dest paths under `VoiceNotes/YYYY/MM/` and names the date source. Nothing moves.
2. `--apply --limit=N` files that many MP3s. Sidecars move. Created/Modified on the dest match the source (Windows Created repaired if it was a copy artifact).
3. `10-09-25-12-34-56-Recording.mp3` → `2010/09/2010-09-25_12-34-56_Recording.mp3` (or the MediaTuna-normalized equivalent). Not `_unfiled`.
4. `Recording10.mp3` in `__inbox/2009-02/` follows the locked §5.2 rule. Never a silent drop.
5. WAV/M4A/AMR in inbox become MP3 with tags + timestamps when MediaTuna is present; without it, doctor warns and MP3-only filing still works.
6. Dest collision goes to `_holding` and shows up in the existing Holding UI.
7. Browser record on 7777 is unchanged (no inbox detour).
8. `__inbox` leftovers that we did not apply stay put. The skip list still ignores `__SYNC` and Syncthing temps.

---

## 11. Open questions for review

1. **Bare name + month folder:** folder+mtime vs `MTIME_` vs `_unfiled`? (§5.2 recommendation: folder month + mtime if they agree.)
2. **Canonical clock separator:** MediaTuna uses `YYYY-MM-DD_HH-MM-SS`; old PHP used `YYYY-MM-DD-HH-MM-SS`. Organize already accepts `YYYY-MM-DD` prefix. Prefer underscore to match MediaTuna?
3. **Call MediaTuna vs import `lib/`?** CLI for I3/I4 keeps the boundary clean. Import if we want one Node process and no PATH dependency.
4. **Keep converted-from originals** in `__inbox/_originals` or next to the MP3 as `*_original` (today’s denoise style)?
5. **Watcher on `__inbox`:** auto after settle, or backfill command only until the dump is cleared?
6. **Bitrate:** MediaTuna VBR `medium` vs old 128k CBR. Recommendation: MediaTuna default; do not lock 128k.
