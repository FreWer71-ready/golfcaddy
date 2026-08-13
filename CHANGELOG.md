# Changelog

All notable changes to this project are documented in this file.

## [v1.5.0] - 2026-08-13
- Omdesign av flikstrukturen:
  - **Caddy**: renodlad till hålinfo, avståndsväljare, personligt råd och hålskiss (samt vindjustering, som är en indata till rådet). "Personlig hålstatistik"-kortet (puttar/hål, fairway/GIR, birdie–sämre-fördelning) är borttaget härifrån.
  - **Min statistik**: renodlad till hål-fokuserad statistik — "Personliga resultat på hål #" visar nu Ronder, Snitt score och (nytt) Snitt poäng (Stableford, scratch: eagle+=4, birdie=3, par=2, bogey=1, dubbel+=0) samt senaste resultaten, allt i ett enda kort.
  - **Ny flik "Mitt Spel"**: handikap, HCP-utveckling, snittpoäng/bana, fairway %, greenträff %, puttar/rond samt en övergripande analys (birdie–sämre-fördelningen som tidigare låg under Caddy) och Caddyns fokus.
- Håldropdownen ("Välj hål") är flyttad från flik-raden till headern, direkt efter bannamnet "Torshälla GK".
- Bump APP_VERSION to 1.5.0.

## [v1.4.1] - 2026-08-13
- UI (Min statistik): slog ihop "Personlig nuläsgesbild"-kortet och det separata "Hålscorer"-kortet till ett kort. Rubriken byter namn till "PERSONLIGA RESULTAT PÅ HÅL {hål}" och uppdateras dynamiskt när man byter hål (via `renderHoleScores()`); hålscore-infot (Ronder/Snitt/Senaste) visas nu direkt i samma kort istället för i ett eget kort under.
- Bump APP_VERSION to 1.4.1.

## [v1.4.0] - 2026-08-13
- Data: hålstatistiken byter format till ett platt objekt `{ "1": [scorer...], ..., "18": [...] }` i `assets/data/hole_scores.json`, uppdaterad med nya rondvärden. Det klubb-nästlade `hole_scores_by_club.json` (all/torshallagolfklubb/eskilstunagolfklubb/kvicksundgolfklubb) behövs inte längre sedan appen låstes till enbart Torshälla GK (v1.3.1) och används inte längre av `app.js` — filen ligger kvar orörd men oanvänd.
- Kod: konsoliderade de två separata klubb-nästlade fetcharna (`clubDataGlobal`/`clubData`) till en enda `holeScores`-variabel som hämtas en gång från `hole_scores.json` och används rakt av av `aiAdvice` (hål-historik), `computeClubStats` (header-statistik) och `renderHoleScores` (Min statistik). Tog samtidigt bort de nu obehövliga `selectedClub`/`clubDisplayNames`.
- Bump APP_VERSION to 1.4.0.

## [v1.3.4] - 2026-08-13
- Fix: v1.3.3's "Driver only from tee" rule was too loose — since the bag has a big gap between Järn 5 (115 m snitt) and Driver (145 m snitt), *every* tee distance from 116–497 m ended up recommending Driver, including par-3 tee shots (t.ex. hål 8: 140 m, hål 12: 166 m) where the shot always targets the green directly, not a fairway landing area.
- Tightened the rule: Driver is only ever recommended for a tee shot on a par 4/5 (`allowDriver = isDefaultDist && h.par !== 3`) — a genuine positional shot, not a shot aimed at a green. Par-3 tee shots and all custom/eget-avstånd shots now always exclude Driver and fall back to the longest suitable club (t.ex. Järn 5) instead.
- Bump APP_VERSION to 1.3.4.

## [v1.3.3] - 2026-08-13
- Rule: Driver ska bara rekommenderas för slag från tee. `club()` and `aiAdvice()` now take a `fromTee` flag — when advice is generated for a custom/typed-in distance (i.e. not the hole's default Tee distance), Driver is excluded from the candidate bag entirely, both for the reachable-club pick and the "nothing reaches" transport-shot fallback (which now falls back to the longest non-Driver club instead of Driver). Tee shots (default distance) are unaffected.
- Confirmed per user: current club-average data in `C` (Järn 7/Järn 8) reflects real range stats as of today and may change over time — left untouched.
- Bump APP_VERSION to 1.3.3.

## [v1.3.2] - 2026-08-13
- Fix: `aiAdvice()` always upgraded to the *second*-shortest reaching club whenever 2+ clubs reached the target ("prefer longer... in most cases"), instead of the shortest one that actually reaches. This systematically over-clubbed (e.g. recommended Driver on a 114 m shot instead of Järn 5). The dead `prevIdx` line that should have gated this behavior was computed but never used.
- Fix: the par-3 hål-rubriken (`club()`, nearest-average-match) and the REKOMMENDATION-texten (`aiAdvice()`, reachable-based) could pick *different* clubs for the same distance. Unified into one `club()` helper — smallest average-carry club (from your range stats in `C`) that reaches, else Driver as a transport shot — used by both, so they can no longer disagree.
- Bump APP_VERSION to 1.3.2.

## [v1.3.1] - 2026-08-13
- Fix: club-header-select (byt-klubb-listan) gjorde att man kunde "byta bana" i headern utan att hålskisser, avstånd, par/index eller annan hålinformation följde med (de är och förblir Torshälla-specifika). Appen är nu medvetet anpassad enbart för Torshälla GK — klubbväljaren är borttagen och `selectedClub` är låst till `torshallagolfklubb`.
- Data: rättat hål 16 — avståndet var felaktigt satt till Vit tees längd (379 m) istället för Gul tee (331 m), som alla andra håls avstånd i appen är baserade på.
- Verifierat samtliga 18 håls par, hcp-index och avstånd (gul tee) mot https://torshallagk.se/spela/banan/ — alla övriga hål stämde redan.
- Bump app version to 1.3.1.

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
