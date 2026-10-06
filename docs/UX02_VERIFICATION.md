# UX02 shell and reader geometry — verification

2026-10-05. Implementation complete; **Needs review** for actual 200% browser zoom and physical touch (UX02-V01). No known implementation blocker. PH01 remains In progress. UX03 is the next implementation packet.

## Changes

- Centered shell capped at 1920 CSS px, 12px outer spacing and pane gaps (8px outer spacing below 960px).
- Desktop navigation rail 200px, entry list 360px with a reader; intermediate list 320px. Below 1200px navigation opens as a drawer. Below 960px the reader replaces the list.
- Search and filters belong to the entry pane. Reader and search start at the same top edge.
- One reader heading, two-line title clamp with full-title tooltip, star and navigation controls, flat reader surface, full-width audio controls, and transcript passages capped at 72ch.
- Grid cards use 1–3 columns, 280px minimum target width and 8px spacing; selected mode uses one compact column. Two visible tags plus the remaining count reduce card height.
- Virtual measurements are keyed by row identity and width/column context. List, navigation, and reader scroll independently.
- `LibraryRail`, `EntryListPane`, and `EntryReader` own their respective layout and DOM surfaces. Transcriptions remains the state coordinator, preserving existing URL, session, and mutation behavior.
- Mobile reader/header controls and entry-section tabs have 44px minimum heights. Navigation drawer traps Tab, closes with Escape, and restores focus; crossing the desktop breakpoint closes the drawer without losing selection.

## Automated checks

- `pnpm test`: 117 passed.
- `pnpm typecheck`: passed.
- `pnpm build:runtime`: passed.
- `pnpm --dir client build`: passed; no Svelte accessibility or unused-selector warnings in the final build.
- `git -c core.whitespace=cr-at-eol diff --check`: passed.

## Browser evidence

Used the actual built client with `scripts/ux01-fixture.mjs`, an isolated Express/Socket.IO adapter and real JournalIndex filtering. It creates 200 dated notes across three years, holding/unfiled notes, 100 transcript passages per dated entry, audio, MayDos, and a deliberately long title with 22 tags. No real journal, configuration, worker, model, or server was used.

| Case | Observation |
| --- | --- |
| A02, desktop 1440×900 | Rail 200px, list 360px; search and reader y60.67. One heading. Two-line long title, 22 tags behind their tab. First passage y198.98; chrome approximately 138.31px. |
| A03, 390×844 / 768×900 | Reader replaces list; Back stays inside the pane; no horizontal document overflow. Closing restores the selected card focus and search. |
| A03, 1024×768 | Navigation drawer collapsed by default; list 320px; remaining reader space used; no horizontal overflow. |
| A03, 1440×900 / 1920×1080 | Separate scrolling panes; list remains compact with a reader; no horizontal overflow. |
| A04, deep grid | At about 76% of scroll range, direct pointer selection of Fixture 050 changed its identity-anchor offset from 28.40625px to 28.46875px (0.0625px). |
| A05, hydration and edit | Hydrated reader without displacing the list. Starring the selected fixture retained its 28.46875px anchor. Adjacent measured gaps: 8px, 7.99998px, 8.00002px. |
| A31, focus | Drawer opens on Close library; Escape restores Library button focus. Mobile Back restores the selected card focus. Navigation does not discard the selected entry. |
| Responsive reader continuity | Passage 27 remained the first visible passage after desktop/mobile reflow; offset differed by 0.25px, audio time stayed at zero. Pixel scrollTop changed with text wrapping, preserving passage identity. |
| A32, reflow portion | 720×450 CSS viewport (the available area of a 1440×900 browser at 200% zoom) retains Back, search/list return, and a scrollable transcript without horizontal overflow. This is reflow evidence, not proof of actual browser zoom. |
| Runtime | No browser console errors or warnings. Only fixture-side star mutation was performed. |

Desktop screenshot: `Z:/workspace/__tmp/dictawhisper-ux02.jpg` (sample data). The list in that screenshot intentionally retains its previously browsed date/scroll context while showing the selected entry independently.

## Remaining manual review — UX02-V01

The browser interface exposes viewport dimensions, but no zoom or physical touch emulation. These required A32 cases are explicitly unrun:

1. In a normal browser at 1440×900, set browser zoom to 200%. Open a long-title entry, navigate, open/close Library, open filters after Back, and verify controls remain reachable without horizontal page scrolling.
2. On a touch device, open an entry, scroll its transcript, switch sections, use Back, open the Library drawer, and choose another date. Confirm controls are comfortable to tap and selection/list context survive navigation.
3. Record results in the packet tracker. Mark UX02 Verified when both checks pass; record any concrete failure before further changes.

## Reproduction

Build the client, run `node --experimental-strip-types scripts/ux01-fixture.mjs`, and visit `http://127.0.0.1:17778/`. Use the Library header button to collapse/open navigation; search `Fixture 199` for the long-title case. Search hits may land directly on the matching passage; click Transcript to inspect the reader's top controls. Clear search to return to the saved browsing context. Stop the fixture afterward; its temporary data is disposable and unrelated to the user's journal.

The production server remained stopped. Existing lockfile changes were preserved. UX03 title metadata, copy/playback/find behavior, and original-only presentation were not started in this packet.
