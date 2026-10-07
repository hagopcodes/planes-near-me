# PlaneRadar

PlaneRadar is a mobile-first Progressive Web App that draws nearby aircraft as radar blips on a compass-oriented scope.

## Features

- No backend: all data fetched client-side from free APIs.
- Radar/sonar dial (canvas), concentric rings, cardinal lines, callsign labels.
- Tap blips for a detail page with route data and aircraft photo attribution.
- iPhone compass mode (dial rotates with heading) with north-up fallback.
- Dynamic query radius based on dial size and zoom level, clamped to 250 NM.
- Distance-scale setting (linear or square-root), persisted in localStorage.
- PWA shell with manifest + service worker (app shell cached for offline launch).

## Data sources

- Nearby aircraft (primary + fallbacks):
  - `https://api.adsb.lol/v2`
  - `https://api.adsb.one/v2`
  - `https://api.avioadsb.com/v2`
- Flight route on tap: `https://api.adsbdb.com/v0/callsign/{callsign}`
- Aircraft photo on detail view: `https://api.planespotters.net/pub/photos/hex/{hex}`

## Local run

Use any static server over HTTPS (required for geolocation + compass in production-like testing):

```bash
python -m http.server 8080
```

Then open `http://localhost:8080` for desktop behavior.

For iOS compass/geolocation behavior, host over HTTPS (for example with Azure Static Web Apps) and open from Safari.

## Deploy (Azure static hosting)

This project is plain static files. Deploy the repository contents as-is to Azure Static Web Apps or Azure Blob static website hosting with HTTPS enabled.

## Notes

- Polling is at most once per second and waits for each response before scheduling the next cycle.
- Ground targets are filtered out by excluding aircraft where `alt_baro === "ground"`.
- Route and photo responses are cached in-memory by callsign/hex for repeated taps.
