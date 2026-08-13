# Changelog

All notable changes to this project are documented in this file.

## [v1.3.0] - 2026-08-13
- Add selectable distance on the Caddy view: a new "Avstånd" card lets you step (±1 m) or type a custom distance, defaulting to the hole's Tee distance.
- Recommendation (`aiAdvice`), club pick, and target score now recalculate from the selected distance instead of always using the fixed Tee distance.
- Distance resets to Tee automatically when navigating to a different hole.
- Fix: "Välj hål" dropdown was always empty because the version-injection script overwrote the whole `.eyebrow` div (including the `#club-header-select` element) via `textContent`, which made the hole-dropdown setup code bail out early. Now targets `#version-text` only.
- Bump app version to 1.3.0 for cache-busting.

## [v1.2.6] - 2026-08-08
- Move inline JS into app.js and bump in-page asset version to 1.2.6
- Guard service worker registration to avoid 404/registration crashes
- Remove corrupted localStorage.gcScores on parse error (auto-cleared)
- Cache-bust frequently-changing assets (querystring ?v=1.2.6)
- Add sw.js to preview and ensure production has sw.js to prevent registration 404

## [v1.2.5]
- Fix: populated hole_scores.json and UI rendering; replaced v1.2.4 which contained empty JSON

## v1.2.4 - 2026-08-07

- Add per-hole historical scores JSON (assets/data/hole_scores.json) generated from the provided Excel file.
- Profile view fetches and renders per-hole historical scores under "Min statistik".
- Includes original Excel source at assets/data/scores.xlsx for traceability.

Notes:
- The app shows "Ingen data" when the JSON is missing.
- No changes to score-entry logic; this release only bundles and surfaces historical data for offline use.
