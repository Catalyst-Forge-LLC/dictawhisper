# Inbox restyle: Engram chrome, DictaWhisper object

**Status:** implemented in `client/` (U0–U5). Marketing site unchanged.  
**Surface:** the local inbox at port 7777 (`client/`). Not the FilePress marketing site.  
**Reference:** `z:/workspace/engram` (`src/app.css`, `AppHeader.svelte`, `search/+page.svelte`, `ThreadMonthGroups.svelte`, `TagChip.svelte`, `SegmentedControl.svelte`, `SearchHitCard.svelte`).

Engram is a local archive you *read*. DictaWhisper is a local journal you *record and reread*. Steal the chrome. Do not steal the object. Notes stay notes-with-audio. Do not grow a multi-route app, a user picker, SMS bubbles, or an ingest page.

Do not take Tailwind or Svelte 5 as a prerequisite. Port tokens and class names into the existing Svelte 3 + SCSS client. Prefix: `dw-` (not `eg-`).

---

## 1. What “looks like Engram” actually is

Not “dark mode.” These are the parts that make Engram feel finished:

1. **A page atmosphere**, not a white sheet. Near-black field (`#030305`), two faint radial washes (amber top-left, cool cyan bottom-right), a 2.5% fractal-noise grain over the viewport.
2. **Glass cards.** `rounded-2xl`, hairline white border at 8% opacity, 165° zinc gradient, `backdrop-filter: blur(20px) saturate(1.3)`, inset highlight on the top edge, deep drop shadow. Hover lifts 1px and picks up a warm rim.
3. **One accent.** Amber `#f59e0b` / `#fcd34d` → `#ea580c`. Used for primary buttons, focus rings, active nav pills, playing cues, selection. Almost nothing else is colored.
4. **Type hierarchy.** Antialiased zinc-100 body. Eyebrow labels are 10px, semibold, uppercase, widest tracking, zinc-500. Counts and times are `font-mono tabular-nums`. Search and titles are readable, not tiny.
5. **Controls from one kit.** `eg-input` (inset well, amber focus glow). `eg-btn-primary` (gold gradient, dark text). `eg-btn-secondary` (ghost glass). Segmented pill groups in a recessed `bg-black/30` track. Tag chips: idle zinc, active amber fill + ring.
6. **Archive grouping.** Year = collapsible section with mono year + count. Month = sticky rail (`bg-zinc-950/85`, backdrop blur) that stays under the header while you scroll. Rows are cards, not table lines.
7. **Motion is 200–300ms and small.** Hover `-1px`. Active press back to 0. Focus is a 3px amber ring, not an inset white glow. Scrollbars are 6px, thumb zinc at 30%.
8. **Selection and mark.** Text selection is warm amber. Search hits use `<mark>` in amber wash. Deep-link / “now playing” uses a short pulse, then a left amber rail.

Copy that system. Do not invent a second one.

---

## 2. What to keep from DictaWhisper

- Single page. Record, drop, search, read, play.
- Year / month groups, Holding and Unfiled as real groups (not a pitch, just folders).
- Cleaned text first; raw segments on a toggle.
- Tag AND-filter. Search via `GET /notes/search` (FTS / hybrid), not a client Fuse of the corpus.
- Playback cues aligned to word timestamps. Click a paragraph to seek.
- Retry / skip cleanup. Holding resolve (File, File as copy, Unfile).
- Help aside (rewrite the chrome; keep the facts).
- Logo mark (`/logo.png`). Do not replace it with Engram’s mark.

---

## 3. What not to copy from Engram

- Routes (Search / Chats / SMS / Stats / Ingest). We have one inbox.
- User picker.
- Facet explosion (platform, account, corpus, SMS year, media). We have search + tags + year/month.
- Bulk archive toolbar. Out of scope unless Holding review later needs a bar.
- Virtualized thread reader. ~2.8k notes already lazy-load by year/month; keep that.
- Tailwind, Svelte 5 runes, `$app/state`.
- Amber *and* sky *and* cyan badges on every row. One accent.

---

## 4. Design tokens (port to `client/src/variables.scss`)

```scss
:root {
  --dw-bg: #030305;
  --dw-bg-elevated: rgb(24 24 27 / 0.7);
  --dw-bg-hover: rgb(255 255 255 / 0.06);
  --dw-border: rgb(255 255 255 / 0.08);
  --dw-text: rgb(244 244 245);
  --dw-text-muted: rgb(161 161 170);
  --dw-accent: #f59e0b;
  --dw-accent-bright: #fcd34d;
  --dw-accent-deep: #ea580c;
  --dw-danger: #f87171;
  --dw-radius: 1rem;      // 16px cards
  --dw-radius-sm: 0.75rem; // inputs, pills
  --dw-max: 52rem;        // ~832px; Engram uses max-w-3xl/4xl
}
```

Accent is Engram amber on purpose: these two apps sit on the same desk. If the dictaphone mark fights it, change **only** `--dw-accent*` later. Do not restyle the rest.

Body: `color-scheme: dark`. Drop Helvetica 0.8rem. Use the system UI stack Engram uses in practice (Tailwind’s `text-zinc-100 antialiased`):

```scss
font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
font-size: 16px;
font-feature-settings: 'ss01', 'ss02';
```

Kill the global `button { background: #0088cc }` in `app.scss`. Every button must opt into `dw-btn-primary` or `dw-btn-secondary`.

---

## 5. App shell

**Today:** `.wrapper` is a white column, 90% / 1000px, Helvetica, centered h1.

**Target:** match `eg-app-shell`.

- `html, body, .wrapper { height: 100%; }` → `min-height: 100dvh`, column, `overflow: hidden` on the shell, scroll on `main`.
- Background stack (in order):
  1. `#030305`
  2. Radial amber ellipse 70%×50% at 15% / -5%, 14% opacity
  3. Radial cyan ellipse 60%×40% at 85% / 95%, 8% opacity
  4. Mid zinc veil
  5. Fixed grain overlay at 2.5% opacity, `pointer-events: none` (same fractal-noise SVG Engram uses)
- `main` (or the current `.wrapper` content after the header): `max-width: var(--dw-max)`, centered, `px` 12–16, `pt/pb` 12–16, `overflow-y: auto`, `min-h-0 flex-1`.
- Custom scrollbar: 6px, transparent track, zinc thumb.

Header becomes sticky (`z-20`), full-bleed under the grain, `backdrop-blur-2xl`, gradient `rgb(9 9 11 / 0.9) → 0.75`. Content row inside shares `max-width` with main.

Do not put the recorder or the note list outside that max width.

---

## 6. Header

**Today:** centered logo + “DictaWhisper” as an h1. No status. Help is a `❔` that slides a full-screen aside.

**Target:** Engram header rhythm.

```
[ logo + glow ]  DictaWhisper          [ health pills ]  [ Help ]
                 Local voice journal
```

- Logo: 32–36px, `rounded-xl`, ring `white/15`, amber blur halo behind it (`-inset-1`, `bg-amber-500/25`, `blur-lg`). Keep `/logo.png`.
- Wordmark: `text-base md:text-lg font-bold tracking-tight`. Eyebrow under it: `text-[10px] uppercase tracking-widest text-zinc-500` — “Local voice journal”.
- Right side, not a second nav: compact status from `/health` (already exists). Three pills max: Whisper (ready / starting / down), ollanet (up / unreachable), GPU vs CPU. Idle = zinc pill. Fail = danger text, not a toast wall. Clicking Help opens the aside.
- Help control: `dw-btn-secondary` text “Help”, not a giant `❔`. Aside becomes a right-hand `dw-card-elevated` drawer (max 24rem), not a full-viewport slide over everything. Same facts as now. Dark type on dark glass.

No Search/Chats/SMS pills. One page.

---

## 7. Capture card (recorder)

**Today:** MDN leftover. Grey oscilloscope canvas, two fat `#0088cc` buttons at 50% width, a raw file input, “Drag and drop…” as body copy. Unused `.clip` CSS. `querySelector` instead of Svelte bindings.

**Target:** one `dw-card-elevated` at the top of `main`.

```
[ waveform, dark well, amber stroke ]
[ Record ]  [ Stop ]     or drop a file
```

- Visualizer: fill `rgb(0 0 0 / 0.35)`, stroke `--dw-accent-bright`, height 56–64px, `rounded-xl`, hairline border. No light-gray rectangle.
- Record = `dw-btn-primary`. While recording: same button, danger fill (`--dw-danger`), label “Recording…”. Do not set `element.style.background` in JS.
- Stop = `dw-btn-secondary`, disabled until recording.
- File pick: text button or a dashed drop zone *inside* the card, not a native file control as a third primary. Keep drag-and-drop on the card.
- Drop hint: `text-xs text-zinc-500`, one line.
- Rewrite `AudioRecorder.svelte` to Svelte state (`recording`, `armed`, `error`). Delete unused clip CSS. Bind the canvas and buttons with `bind:this` / `on:click`.

Acceptance: a stranger can record or drop a file without reading a paragraph. The card looks like Engram’s elevated search card, not a 2014 demo.

---

## 8. Search and tags

**Today:** a bordered `#ccc` input. Tag cloud in a `<details>` with 2009-blue chips. Consolidate block is a manila `#f7f4ee` panel. Global buttons are still blue.

**Target:** Engram search card + chip language.

- Search sits in a `dw-card` (or the same elevated card under capture). Icon inset left (magnifier, amber at 70% opacity). Input is `dw-input`, `pl-10`, placeholder “Search notes, tags, filenames…”.
- Clear is `dw-btn-secondary` compact, not a grey stub.
- Tags: row of chips, not a second visual language. Idle = `border-zinc-700/80 bg-zinc-900/60 text-zinc-400`. Active = `border-amber-500/40 bg-amber-500/15 text-amber-100`. Count in `tabular-nums` muted. AND-filter stays.
- Eyebrow over the chips: `TAGS` in the 10px tracking style. “N shown · M single-use hidden” stays, as muted meta, not a second heading.
- Consolidate: a `dw-card` nested under tags, not a tan box. Primary action uses `dw-btn-primary`. Checkboxes `accent-color: var(--dw-accent)`.
- Empty search: `dw-card` centered, `text-sm text-zinc-400`. Same sentence as now (“No notes yet…” / no matches).

Do not add Engram’s corpus / platform / account / year `<select>` row. Year is already the group list.

---

## 9. Year and month groups

**Today:** native `<details>` per folder. `border-top: 1px solid #ddd`. Summary is 16px Semibold + grey count. Older months lazy-load via a muted line.

**Target:** `ThreadMonthGroups` structure.

- **Year** = `rounded-xl border border-white/[0.06] bg-black/15`. Header is a full-width button: chevron (rotates when collapsed), `font-mono` year, `ml-auto` count (`12 notes`). Hover `bg-white/[0.04]`.
- **Month** inside an open year: sticky rail `top` = header height (~3.25rem), `bg-zinc-950/85 backdrop-blur`, `uppercase tracking-widest text-[10px]`, count on the right.
- Holding / Unfiled: same year-section treatment, label as the year heading (not a red flag). Keep them visible, not skipped.
- Default collapse: current year + current month open. Older years collapsed. “Focus” / “All years” text buttons (amber / zinc) like Engram, only if more than one year exists.
- Lazy-load older months unchanged. The “scroll to load” line becomes muted zinc, not a second empty-state card.
- Do not use native `<details>` if the chevron + sticky rail is easier as a button + `{#if}`. Either is fine if the visuals match.

---

## 10. Note row and expanded note

**Today:** CSS grid line, `#eee` hairline, `#faf6f6` when open, blue cue rail, action buttons crammed top-right.

**Target:** each note is a `dw-card dw-card-hover`.

Collapsed:

```
[ title / dated name          ]  [ 2m 14s ]
[ preview, two lines zinc-400 ]
[ tag chips                   ]
```

- Title: `font-medium text-zinc-50`. Date/name can stay the filename; do not invent a title field.
- Elapsed and cleanup status: `text-xs tabular-nums text-zinc-500`.
- Preview: `text-sm leading-snug text-zinc-400`, two lines max (`line-clamp-2`).
- Click the card body to expand (keep the header click target large). Do not put Delete on the collapsed face.

Expanded:

- Card stays; inner pad increases slightly. Optional 3px amber gradient rail on the left (SearchHitCard) while playing.
- Audio full width. Native `<audio>` is acceptable in v1 if the chrome around it is dark. Do not skin a custom player in this pass unless the default control is unreadable on `#030305` (then a minimal custom bar: play, time, range).
- Cleaned paragraphs = cue rows. Time in `tabular-nums` accent. Active cue: amber left rail + `bg-amber-500/10`. Hover: `bg-white/[0.04]`. Untimed cues: no seek cursor.
- Raw toggle: segmented pills (“Readable” | “Raw”), not a grey “raw” button.
- Actions: a footer row of `dw-btn-secondary` compact — Copy, Retry, Skip, File / File as copy / Unfile, Delete. Delete uses `--dw-danger` text, still secondary chrome. Confirm stays.

Do not put eight buttons in a 14rem column on the right of the title.

---

## 11. Motion, focus, error

- Transitions: 200–300ms, `transform` and `box-shadow` only. No bounce. No page-wide fade.
- Focus visible: `0 0 0 3px rgb(251 191 36 / 0.14)` plus border `--dw-accent`. Keyboard must match click.
- Playing cue pulse: reuse Engram’s `eg-msg-highlight-pulse` (2s, once) when a cue becomes active from playback, not on every tick.
- Errors: `rounded-xl border border-red-500/25 bg-red-950/30 px-4 py-3 text-sm text-red-300`. One place (inboxError, recorder error). No `alert()`.
- `::selection`: `rgb(251 191 36 / 0.35)`.
- Reduced motion: honor `prefers-reduced-motion: reduce` (no translateY, no pulse).

---

## 12. Help aside and first-run

- Replace the full-screen translateX overlay. Drawer from the right, `dw-card-elevated`, padding 1.25rem, heading “DictaWhisper”, same three short paragraphs.
- Close: button in the drawer, Escape, click on the dimmer (`bg-black/50`).
- First-run empty list: one `dw-card`, one sentence, pointer at Record. Do not mention doctor unless `/health` is actually failing (then a warn pill in the header is enough).

---

## 13. File map (implementation)

| File | Work |
| --- | --- |
| `client/src/variables.scss` | Tokens. |
| `client/src/app.scss` | Reset, shell, grain, scrollbar, selection. Delete global blue buttons. |
| `client/src/routes/+page.svelte` | Shell + header + `<main>`. Move masthead here or into a small `AppHeader.svelte`. |
| `client/src/lib/components/AppHeader.svelte` | **New.** Logo, wordmark, health pills, Help. |
| `client/src/lib/components/AudioRecorder.svelte` | Card + Svelte state + dark visualizer. |
| `client/src/lib/components/Transcriptions.svelte` | Search card, chips, year/month, note cards. Split if it stays >900 lines: `NoteCard.svelte`, `TagChip.svelte`, `YearGroup.svelte`. |
| `client/src/lib/components/CollapsibleAside.svelte` | Drawer. |
| `client/src/app.html` | `color-scheme: dark` on `<html>` if needed for native controls. |

No new dependencies. No Tailwind. Optional later: one webfont. Not in this pass (Engram does not load one).

---

## 14. Workstreams

Do these in order. Each should be shippable alone.

**U0 — Tokens and shell.** Variables, `dw-app-shell`, grain, max-width, kill global `#0088cc`. Page will look dark and half-broken. That is expected.

**U1 — Header + help drawer.** Sticky header, logo glow, Help as a drawer. Health pills can be static “…” until `/health` is wired; wire in the same slice if it is cheap (`GET /health` already exists).

**U2 — Capture card.** Recorder rewrite. Dark visualizer. Primary/secondary buttons.

**U3 — Search + tags.** Input well, chips, consolidate panel restyle. Behavior unchanged.

**U4 — Groups + note cards.** Year/month chrome, card rows, expanded layout, cue rails, action footer. This is the large slice.

**U5 — Pass.** Focus rings, reduced motion, empty/error cards, native `<audio>` contrast, scrollbar, 800px and 400px widths. Kill leftover MDN selectors.

Do not restyle `site/` in this plan. If the marketing site should pick up amber later, that is a different page and `landing.md`.

---

## 15. Acceptance

The inbox passes when:

1. A cold `pnpm dev` looks like a sibling of Engram at a glance: black field, grain, amber, glass, not a white Helvetica form.
2. Record / drop is one card. No MDN grey canvas. No 50%-width blue buttons.
3. 870 notes still group by year/month, lazy-load, search, and AND-filter. No new routes.
4. Playing a note paints the active paragraph like Engram paints a deep-linked message (rail + wash, not a blue inset glow).
5. Holding / Unfiled are still findable without a tutorial.
6. Keyboard: tab through search, chips, year headers, expand, cues, actions. Focus is visible on dark glass.
7. `/health` fail does not blank the page. A pill or the existing empty/error card is enough.
8. Read-aloud: no new marketing copy. Labels stay “Record”, “Search”, “Readable”, “Raw”, “Copy”, “Help”.

---

## 16. Out of scope

- Custom waveform player beyond the capture visualizer.
- Virtualize the note list. (Done later: `VirtualList.svelte` windows months and hit lists over 16 cards.)
- Tag pages or URL-synced filters — see [`INBOX_SEARCH_UX_SPEC.md`](./INBOX_SEARCH_UX_SPEC.md).
- Light theme.
- Matching `dictawhisper.com` to this dark shell.
- Porting Engram components by file copy (different Svelte major, different object).
