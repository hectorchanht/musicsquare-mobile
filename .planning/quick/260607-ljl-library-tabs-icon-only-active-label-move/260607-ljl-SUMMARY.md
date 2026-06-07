---
quick_id: 260607-ljl
slug: library-tabs-icon-only-active-label-move
date: 2026-06-07
status: complete
commits:
  - c3b068f
---

# Library tabs: icon-only + active label up top

5 pills (Liked / Playlists / Downloads / Favourite artists / History)
overflowed at narrow widths once kyf added the 5th. Shrunk each pill to
icon-only (no text), surfaced the active tab's label beside the heading
as "Library · {tabLabel}".

- `tabLabel` is a `$derived` string switching on the `Tab` union (5 cases).
- Pills keep aria-label + title (the original i18n string) for screen
  readers and hover tooltips. Visual content is the lucide icon only.
- Header is now `display: flex; align-items: baseline; flex-wrap: wrap`
  so the heading row can wrap on truly narrow viewports without crowding
  the Edit pill.

Verified live: 5 pills render in a 374px-wide container with
`scrollWidth === clientWidth` (no horizontal overflow). Header text reads
"Library · Favourite artists" when the 4th tab is active.

Single file. check 0/0, 415/415 tests.
