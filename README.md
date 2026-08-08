# Golfcaddy

Fredriks Golfcaddy — enkel offline‑vänlig SPA för Torshälla GK.

## Releases & preview
- v1.2.6 — 2026-08-08: Fix service worker registration, move inline JS to app.js, clear corrupted localStorage.gcScores, add cache-bust querystrings for assets, and preview sw.js fix.
- Preview site: https://frewer71-ready.github.io/golfcaddy-preview/ (use hard refresh / incognito to bypass caches)

## Notes
- If users see a blank UI after upgrading, ask them to hard-refresh or uninstall the PWA (if installed). The release adds safer SW registration to avoid registration errors when sw.js is not present.
- To change the offline asset behavior, edit `sw.js` in the repo root.
