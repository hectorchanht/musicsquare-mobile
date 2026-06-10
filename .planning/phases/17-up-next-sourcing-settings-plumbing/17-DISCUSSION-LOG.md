# Phase 17: Up-Next Sourcing + Settings Plumbing - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-10
**Phase:** 17-up-next-sourcing-settings-plumbing
**Areas discussed:** Up-next sourcing & contexts, Queue management gestures, Settings: text-size + accent, Deezer enrichment

---

## Up-next sourcing & contexts

| Option | Description | Selected |
|--------|-------------|----------|
| Full set | liked/search/downloads/playlist/album/artist/home/history each own override, all default generated | ✓ |
| Minimal trio | Only search/liked/downloads; rest follow global | |
| You decide | Claude picks from setQueue call sites | |

**User's choice:** Full set

| Option | Description | Selected |
|--------|-------------|----------|
| Settings page only | Rows under Settings → Playback, grouped drill-in pattern | ✓ |
| Settings + queue chip | Plus quick toggle in Up-Next header | |
| Queue chip only | Header chip is the only control | |

**User's choice:** Settings page only

| Option | Description | Selected |
|--------|-------------|----------|
| Snapshot at tap | Queue the visible list as-is at tap (today's setQueue behavior); exhaust → auto-generate | ✓ |
| Snapshot from tapped track down | Tapped track + rows after it | |
| Live-follow the list | Queue mirrors list changes | |

**User's choice:** Snapshot at tap

| Option | Description | Selected |
|--------|-------------|----------|
| User-tap only | Keep autoExpandOnPlay but fire only on explicit user plays | ✓ |
| Remove the setting | Delete autoExpandOnPlay entirely | |
| You decide | | |

**User's choice:** User-tap only

---

## Queue management gestures

| Option | Description | Selected |
|--------|-------------|----------|
| Full row swipe, axis-locked | Horizontal swipe past threshold removes; axis committed after slop; grip stays vertical | ✓ |
| Swipe reveals delete button | Partial swipe + confirm tap | |
| No swipe — X button per row | Icon-only removal | |

**User's choice:** Full row swipe, axis-locked

| Option | Description | Selected |
|--------|-------------|----------|
| Header button, keep current | Clear in Up-Next header; playing track survives | ✓ |
| Header button, full stop | Clear stops playback too | |
| In track menu / overflow | Hidden behind overflow | |

**User's choice:** Header button, keep current

| Option | Description | Selected |
|--------|-------------|----------|
| Stay empty until near end | ensureAhead refills only as current track nears end | ✓ |
| Regenerate immediately | Instant refill | |
| Ask via undo toast | Undo toast + exhaust refill | |

**User's choice:** Stay empty until near end

| Option | Description | Selected |
|--------|-------------|----------|
| Session-exclude | In-memory removed-uid set excluded from generation | ✓ |
| No exclusion | Regeneration may re-suggest | |
| You decide | | |

**User's choice:** Session-exclude

| Option | Description | Selected |
|--------|-------------|----------|
| Wipe everything | Manual pins go too; manualUids resets; only playing track survives | ✓ |
| Keep manual pins | Clear only auto portion | |
| Two actions | Clear auto + Clear all | |

**User's choice:** Wipe everything

| Option | Description | Selected |
|--------|-------------|----------|
| Slide + fade, snap back | Row follows finger, flick via velocity tracker, springs back below threshold | ✓ |
| Reveal red background | iOS Mail style delete layer | |
| You decide | | |

**User's choice:** Slide + fade, snap back

---

## Settings: text-size + accent

| Option | Description | Selected |
|--------|-------------|----------|
| All five sliders | One FONT_SCALE_MIN/MAX change (50/200) everywhere | ✓ |
| List sliders only | NP sliders stay 70–160 | |
| You decide | | |

**User's choice:** All five sliders

| Option | Description | Selected |
|--------|-------------|----------|
| Current/last-played track | Real song/artist name previews; static fallback | ✓ |
| Static localized sample | Fixed sample per locale | |
| You decide | | |

**User's choice:** Current/last-played track

| Option | Description | Selected |
|--------|-------------|----------|
| Audit + fix all dead spots | Sweep hardcoded hex / dead hover var; auto-derive hover shade | ✓ |
| Verify only, fix what's reported | Quick check, no full sweep | |
| You decide | | |

**User's choice:** Audit + fix all dead spots

---

## Deezer enrichment

| Option | Description | Selected |
|--------|-------------|----------|
| Fan count + hi-res picture | Stats line + hero fallback | ✓ |
| Related artists row | Tappable similar-artist tiles | ✓ |
| Albums/discography list | Fill thin discography | ✓ |
| You decide | Claude picks subset | ✓ |

**User's choice:** All of the above + free text: "port in whatever Deezer provides and you may decide what and how"

| Option | Description | Selected |
|--------|-------------|----------|
| Everything useful, Claude decides | Mirror artist posture for album page | ✓ |
| Stats only | Release date + track count + duration | |
| Cover + date only | Minimal | |

**User's choice:** Everything useful, Claude decides

| Option | Description | Selected |
|--------|-------------|----------|
| Best-quality wins | Field-by-field; highest-res image wins; additive rule preserved | ✓ |
| Last.fm primary, Deezer fills gaps | | |
| Deezer primary | | |

**User's choice:** Best-quality wins

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, add both routes | /api/deezer/artist + /api/deezer/album, existing proxy pattern + TTL cache | ✓ |
| Single combined route | /api/deezer/info?type= | |
| You decide | | |

**User's choice:** Yes, add both routes

| Option | Description | Selected |
|--------|-------------|----------|
| Shape-matched skeletons | Per-section skeletons; clean disappear on miss | ✓ |
| Render-when-ready | No skeleton | |
| You decide | | |

**User's choice:** Shape-matched skeletons

| Option | Description | Selected |
|--------|-------------|----------|
| Keep existing list, Deezer informs order | Playable CN-source list stays; Deezer rank = ordering hint | ✓ |
| Separate Deezer section | Popular-on-Deezer row via resolveStub | |
| Ignore Deezer top tracks | Info/images only | |

**User's choice:** Keep existing list, Deezer informs order

---

## Claude's Discretion

- Per-context setting object shape + player context-tracking field design
- Which Deezer fields earn a UI row; exact artist/album layout ("what and how" delegated)
- Accent hover-shade derivation; swipe thresholds (reuse existing constants)
- Settings → Playback ordering of new rows; Deezer route TTLs

## Deferred Ideas

- Queue-header sourcing toggle chip (settings-only won; revisit if discoverability suffers)
- Undo toast on clear/remove (i18n cost; Phase 23 candidate)
- Persistent cross-session removed-uid exclusion (session-only for now)
