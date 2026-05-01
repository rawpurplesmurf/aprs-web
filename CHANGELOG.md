# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

---

## [0.2.0] — 2026-05-01

### Added

#### APRS Symbol Icons
- Replaced generic coloured-dot markers with proper APRS symbol icons from the [aprs.fi symbol set](https://github.com/hessu/aprs-symbols) (primary and secondary tables)
- Retina-ready sprite sheets (`@2x` PNGs) rendered at 30 px display via CSS `background-position` cropping
- Symbol table (`/` or `\`) and symbol code select the correct icon from the 16×6 grid automatically
- Icons include drop-shadow and hover-scale effects; callsign label retained below each icon

#### Station Track History
- New `position_history` database table stores every position report with `lat`, `lon`, `speed`, `course`, `comment`, and `timestamp`
- Indexed on `(callsign, timestamp)` for fast range queries
- `aprsHandler.js` inserts a history row on every position and weather-with-position report
- New `GET /api/history/:callsign?period=<seconds>` endpoint (default: 3600 s / 1 h)
- Track History button group in station info panel: **10m · 1h · 3h · 6h · 12h · 24h**
- Clicking a period draws a Leaflet `Polyline` with waypoint dots and directional arrows on the map
- Active tracks extend in real-time as new `station_updated` events arrive
- Track auto-clears when the info panel is closed or a different station is selected
- Toggle behaviour: clicking the active period button clears the track

#### Packet Trace
- Newest entries now appear at the top of the trace log (prepend instead of append)

### Fixed

#### Developer Experience
- `run.sh` — replaced `source .env` with a safe `while IFS='=' read` parser; bash was interpreting `BEACON_SYMBOL_CODE=>` as a redirect operator, silently exiting the script

## [0.1.0] — 2026-05-01

### Added

#### Core Infrastructure
- Node.js / Express web server with Socket.io for real-time communication
- `better-sqlite3` database with WAL mode; auto-initialised on startup
- Three database tables: `stations`, `weather_logs`, `messages`
- All configuration via environment variables — no hardcoded values (Docker/k8s ready)
- `.env.example` template with full documentation for each variable

#### Direwolf / TNC Interface (`server/direwolf.js`)
- TCP KISS client connecting to Direwolf on a configurable host and port
- Stream-safe byte buffer handling for TCP fragmentation
- Full KISS unframing: `0xC0` boundary detection, `0xDB`/`0xDC`/`0xDD` escape handling
- Full AX.25 address field decoding (bit-shift, SSID extraction, end-of-address flag)
- Full AX.25 frame encoder for outbound TX (callsign bit-shifting, SSID byte, control/PID)
- KISS escape and framing for outbound frames
- Automatic reconnect with exponential backoff (2 s → 30 s max)

#### APRS Parsing (`server/aprsHandler.js`)
- Integration with `aprs-parser` v1.x (named export `{ APRSParser }`)
- Position packet handling: upserts `stations` table, emits `station_updated`
- Weather packet handling: upserts `stations`, inserts `weather_logs`, emits `weather_updated` + `station_updated`
- Message packet handling: stores to `messages` table if addressed to `MY_CALLSIGN`, emits `message_received`
- APRS position info string builder (DDMM.mm format, configurable symbol)
- APRS message info string builder (9-char padded addressee, message number)
- `packet_log` event emitted for every parsed frame (including parse errors)

#### REST API (`server/routes.js`)
- `GET /api/stations` — all stations ordered by last heard
- `GET /api/weather/:callsign` — last 24 h of weather logs for a callsign
- `GET /api/messages` — message history for `MY_CALLSIGN`
- `POST /api/transmit/beacon` — build and transmit a position beacon via Direwolf
- `POST /api/transmit/message` — send an APRS message, log as outgoing

#### Frontend Map (`public/js/map.js`)
- Leaflet map with OpenStreetMap tiles
- Browser geolocation request on load to centre the map
- Custom `DivIcon` markers with callsign labels and glow effect
- Green dot variant for weather stations
- `updateStationMarker()` — creates or moves marker on `station_updated`
- `flyToStation()` and `getMapCenter()` helpers

#### Frontend UI (`public/js/ui.js`)
- Station info sidebar: callsign, last heard (relative time), coordinates, comment
- Weather sub-section in info panel with temperature (°C/°F), humidity, wind, rain
- Chat-style messaging panel with incoming/outgoing bubble layout
- Beacon modal: pre-fills current map centre coordinates, sends POST to `/api/transmit/beacon`
- Packet Trace panel: real-time scrolling log of all APRS packets
  - Colour-coded by type: position (blue) / weather (green) / message (amber) / error (red)
  - Columns: time · callsign · type · raw TNC2 string
  - Clear button; capped at 500 entries
- Toast notifications for TX success/failure
- Unread message badge on the Messages button

#### Styling (`public/css/style.css`)
- Dark-mode colour palette (deep navy `#060c18`, sky blue `#38bdf8` accent)
- Glassmorphism panels with `backdrop-filter: blur(14px)`
- Google Fonts: Inter (UI) + JetBrains Mono (trace, coordinates)
- Smooth slide-in animations for panels and pop-in for modal
- Leaflet tile dark filter (`brightness(0.7) saturate(0.8)`)
- Custom scrollbars, responsive breakpoints for mobile

#### Developer Experience
- `run.sh` — local launcher: validates Node version, checks/creates `.env`, installs deps, auto-selects nodemon
- `Dockerfile` — multi-stage build (Alpine); separate build stage for native addon compilation; non-root runtime user; `HEALTHCHECK`
- `docker-compose.yml` — named volume for SQLite persistence, `env_file` passthrough, health check
- `nodemon` dev dependency for auto-restart

[Unreleased]: https://github.com/yourusername/aprs-web/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/yourusername/aprs-web/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/yourusername/aprs-web/releases/tag/v0.1.0
