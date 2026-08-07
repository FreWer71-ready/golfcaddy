# Changelog

All notable changes to this project are documented in this file.

## v1.2.4 - 2026-08-07

- Add per-hole historical scores JSON (assets/data/hole_scores.json) generated from the provided Excel file.
- Profile view fetches and renders per-hole historical scores under "Min statistik".
- Includes original Excel source at assets/data/scores.xlsx for traceability.

Notes:
- The app shows "Ingen data" when the JSON is missing.
- No changes to score-entry logic; this release only bundles and surfaces historical data for offline use.
