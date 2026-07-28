# Journal Reading Analytics

A GA4-based reading-analytics layer for a single-page journal entry.
It measures **observable reading behaviour only** — scroll depth, dwell
time per section, idle vs. active time, copy events, and return visits.
It cannot and does not infer emotion, regret, or intent.

## Files

- `index.html` — the journal content. Each content block is wrapped in
  `<section class="j-section" id="..." data-section-name="...">` so
  `analytics.js` can time and label it.
- `styles.css` — visual styling (unchanged from the original).
- `analytics.js` — all tracking logic. Nothing else needs to change when
  you edit the journal text — just keep each block inside a `.j-section`.

## How to add/rename a section

Add a new `<section class="j-section" id="section-x" data-section-name="Readable Name">...</section>`
block. `analytics.js` auto-discovers sections on load — no config edit needed
elsewhere.

## Event schema sent to GA4

| Event | When | Params |
|---|---|---|
| `journal_opened` | On load | `visit_type` (first_visit / return_visit), `visit_count`, `days_since_last_visit` |
| `reading_started` | On load | — |
| `<Section Name>` (e.g. `Loneliness`, `Hope`) | First time a section becomes 50% visible | `section_id` |
| `scroll_25` / `_50` / `_75` / `_100` | Scroll milestone crossed | `scroll_percent` |
| `reader_idle` | No interaction for 15s while tab is visible/focused | — |
| `reader_resumed` | Activity resumes after idle | — |
| `tab_hidden` / `tab_visible` | Tab visibility changes | — |
| `window_blur` / `window_focus` | Browser window loses/gains focus | — |
| `text_copied` | Copy event fires | `char_count` (length only, never content) |
| `performance_timing` | On `load` | `page_load_ms`, `dom_ready_ms` |
| `performance_lcp` | When LCP is measured | `lcp_ms` |
| `journal_completed` | Scroll ≥ 95%, most sections visited, ≥ 45s elapsed | `reading_time` |
| `section_timing` | On exit | one param per section id → seconds spent |
| `exit_analytics` | On `beforeunload` / tab hidden | `last_section`, `scroll_percent`, `reading_time`, `active_time`, `idle_time`, `reading_score`, `copy_events`, `copy_chars` |

## Reading Score (0–100)

An **engagement** score, not an emotional one:

- 30% — scroll completion
- 30% — proportion of sections visited
- 25% — active reading time (caps out at 5 active minutes)
- up to −10 — idle-time penalty (2 pts per idle minute, capped at 5 min)
- +10 — bonus if this is a return visit

## Tuning

All thresholds live at the top of `analytics.js` in the `CONFIG` object:

```js
const CONFIG = {
  idleAfterMs: 15000,
  minSecondsForCompletion: 45,
  minScrollForCompletion: 95,
  sectionVisibilityThreshold: 0.5,
};
```

## Limitations (by design)

This system tells you *what happened in the browser* — how far someone
scrolled, how long they lingered, whether they came back. It cannot tell
you what someone felt, whether a passage moved them, or why they left.
Treat the "Reading Score" as an attention signal, not a verdict on the
reader's state of mind.
