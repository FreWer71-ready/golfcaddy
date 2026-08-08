# Changelog

All notable changes to this project are documented in this file.

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
