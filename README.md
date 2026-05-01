# 📡 APRS Dashboard

A self-hosted, real-time APRS (Automatic Packet Reporting System) dashboard that interfaces with a local [Direwolf](https://github.com/wb2osz/direwolf) software TNC over a TCP KISS connection. Decoded station positions, weather data, and messages are persisted in a local SQLite database and displayed on an interactive Leaflet map.


---

## Table of Contents

1. [Features](#features)
2. [How It Works](#how-it-works)
3. [Prerequisites](#prerequisites)
4. [Quick Start (Local)](#quick-start-local)
5. [Configuration Reference](#configuration-reference)
6. [Running with Docker](#running-with-docker)
7. [Running with Docker Compose](#running-with-docker-compose)
8. [API Reference](#api-reference)
9. [Project Structure](#project-structure)
10. [Roadmap](#roadmap)

---

## Features

- **Real-time map** — Leaflet/OSM map with live station markers that move as packets arrive
- **APRS symbol icons** — proper station icons from the [aprs.fi symbol set](https://github.com/hessu/aprs-symbols) (cars, houses, weather stations, digipeaters, etc.)
- **Station track history** — view a station's route as a polyline on the map with selectable time periods (10 min – 24 h); tracks extend in real-time as new positions arrive
- **Packet Trace** — scrollable log of every raw APRS packet received, colour-coded by type, newest first
- **Weather** — weather station data (temperature, humidity, wind, rain) shown in the station info panel
- **Messaging** — send and receive APRS text messages through Direwolf
- **Beacon TX** — transmit your position from the browser with a configurable symbol and digipeater path
- **SQLite persistence** — all stations, weather logs, position history, and messages survive server restarts
- **Dark-mode UI** — glassmorphism panels, JetBrains Mono monospace trace, smooth animations
- **Docker/k8s ready** — all configuration is environment-variable driven; no hardcoded values

---

## How It Works

```
┌────────────────────────────────────────────────────────────────────┐
│                        Your Radio / SDR                            │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ RF
┌──────────────────────────────▼─────────────────────────────────────┐
│              Direwolf Software TNC  (direwolf.localdomain)         │
│                   KISS TCP server on port 8001                     │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ TCP/KISS frames
┌──────────────────────────────▼─────────────────────────────────────┐
│                      aprs-web (Node.js)                            │
│                                                                    │
│  direwolf.js          aprsHandler.js         database.js           │
│  ─────────────        ──────────────         ──────────────        │
│  TCP client           AX.25 decode           SQLite (WAL)         │
│  KISS unframe         aprs-parser            upsert stations      │
│  KISS frame TX        type routing           insert weather/msgs  │
│                                                                    │
│  routes.js            server/index.js                             │
│  ─────────────        ──────────────                               │
│  REST API             Express + Socket.io                          │
│  /api/stations        real-time events                             │
│  /api/weather/:call                                                │
│  /api/history/:call                                                │
│  /api/messages                                                     │
│  POST /transmit/*                                                  │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ HTTP + WebSocket
┌──────────────────────────────▼─────────────────────────────────────┐
│                    Browser (Vanilla JS)                            │
│                                                                    │
│  map.js              ui.js                main.js                 │
│  ──────────          ──────────           ──────────              │
│  Leaflet map         Info panel           Socket.io client        │
│  APRS symbols        Weather panel        Event routing           │
│  Track polylines     Messages UI          Initial data fetch      │
│  Fly-to station      Packet Trace                                 │
│                      Track buttons                                │
│                      Beacon modal                                  │
└────────────────────────────────────────────────────────────────────┘
```

### KISS / AX.25 Protocol

APRS data travels over amateur radio as **AX.25** frames. Direwolf demodulates the audio, decodes the frames, and exposes them over a **KISS TCP** interface on port 8001.

The KISS protocol wraps each AX.25 frame with `0xC0` (FEND) boundary markers and escapes any `0xC0`/`0xDB` bytes that appear in the payload. `direwolf.js` handles KISS unframing and re-framing for transmission.

An AX.25 frame for APRS has this structure:

```
[Destination callsign — 7 bytes, each char << 1]
[Source callsign      — 7 bytes, each char << 1, last byte bit-0 = 1]
[Via digipeaters      — 7 bytes each, last one bit-0 = 1]
[Control byte         — 0x03  (Unnumbered Information)]
[PID byte             — 0xF0  (No Layer 3)]
[Information field    — APRS data string, ASCII]
```

Callsigns are bit-shifted left by 1 (each character's ASCII value `<< 1`) and padded to 6 bytes, followed by a 7th byte encoding the SSID.

### Packet Types

| Type | APRS Info Prefix | Example |
|---|---|---|
| Position | `!`, `=`, `@`, `/` | `!4745.00N/12224.00W>Mobile` |
| Weather | `_`, `@…_` | `@261456z…_220/004g005t077…` |
| Message | `:` | `:W1AW-1   :Hello!{001}` |

---

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| [Node.js](https://nodejs.org) | ≥ 18.0 | Includes npm |
| [Direwolf](https://github.com/wb2osz/direwolf) | ≥ 1.6 | Running on your LAN, KISS TCP enabled |
| A radio / SDR | — | Connected to your Direwolf host |

For Docker:

| Requirement | Version |
|---|---|
| [Docker](https://docs.docker.com/get-docker/) | ≥ 24 |
| [Docker Compose](https://docs.docker.com/compose/) | ≥ 2.20 (V2) |

### Direwolf KISS TCP Setup

Make sure your `direwolf.conf` includes:

```
KISSPORT 8001
```

And that Direwolf is reachable from the machine running aprs-web (test with `nc -z <host> 8001`).

---

## Quick Start (Local)

```bash
# 1. Clone the repo
git clone https://github.com/yourusername/aprs-web.git
cd aprs-web

# 2. Create your environment file
cp .env.example .env
#    → Edit .env with your callsign and Direwolf host

# 3. Run
chmod +x run.sh
./run.sh
```

The script will:
- Verify Node.js ≥ 18 is installed
- Create `.env` from `.env.example` if missing and prompt you to fill it in
- Install npm dependencies if `node_modules` is absent
- Start in **dev mode** (nodemon, auto-restart) if nodemon is available, otherwise plain `node`

Open **http://localhost:3000** in your browser.

### Manual start (without the script)

```bash
npm install
node -r dotenv/config server/index.js

# or for dev with auto-restart:
npm run dev
```

---

## Configuration Reference

All configuration is via environment variables. Copy `.env.example` to `.env` and fill in the values.

| Variable | Required | Default | Description |
|---|---|---|---|
| `MY_CALLSIGN` | ✅ | — | Your callsign with SSID (e.g. `K7NGS-9`) |
| `DIREWOLF_HOST` | ✅ | — | Hostname or IP of your Direwolf instance |
| `DIREWOLF_KISS_PORT` | | `8001` | Direwolf KISS TCP port |
| `WEB_PORT` | | `3000` | Port the web dashboard listens on |
| `BEACON_PATH` | | `WIDE1-1,WIDE2-1` | AX.25 digipeater path for TX beacons |
| `BEACON_SYMBOL_TABLE` | | `/` | APRS symbol table (`/` = primary, `\` = alternate) |
| `BEACON_SYMBOL_CODE` | | `>` | APRS symbol code (`>` = car, `[` = jogger, `-` = house) |

> **Docker/k8s note:** Never commit a populated `.env` to version control. In Kubernetes, inject these as a `Secret` or `ConfigMap`.

---

## Running with Docker

### Pull from GHCR

X86:

```bash
docker pull ghcr.io/rawpurplesmurf/aprs-web:latest
```

ARM:

```bash
docker pull ghcr.io/rawpurplesmurf/aprs-web:arm64
```

### Run the container

```bash
docker run -d \
  --name aprs-web \
  --restart unless-stopped \
  -p 3000:3000 \
  -v aprs-data:/app/data \
  --env MY_CALLSIGN=K7NGS-9 \
  --env DIREWOLF_HOST=direwolf.localdomain \
  --env DIREWOLF_KISS_PORT=8001 \
  --env WEB_PORT=3000 \
  --env BEACON_PATH="WIDE1-1,WIDE2-1" \
  --env BEACON_SYMBOL_TABLE=/ \
  --env 'BEACON_SYMBOL_CODE=>' \
  ghcr.io/rawpurplesmurf/aprs-web:latest
```

Or use your `.env` file:

```bash
docker run -d \
  --name aprs-web \
  --restart unless-stopped \
  -p 3000:3000 \
  -v aprs-data:/app/data \
  --env-file .env \
  ghcr.io/rawpurplesmurf/aprs-web:latest
```

The `aprs-data` named volume persists the SQLite database across container restarts. Use `-v ./data:/app/data` instead if you want the database on the host filesystem.

### Build locally (alternative)

```bash
docker build -t aprs-web:latest .

docker run -d \
  --name aprs-web \
  --restart unless-stopped \
  -p 3000:3000 \
  -v aprs-data:/app/data \
  --env-file .env \
  aprs-web:latest
```

### View logs

```bash
docker logs -f aprs-web
```

### Stop / remove

```bash
docker stop aprs-web && docker rm aprs-web
```

---

## Running with Docker Compose

```bash
# Build and start
docker compose up -d --build

# View logs
docker compose logs -f

# Stop
docker compose down

# Stop and remove the persistent data volume (destructive!)
docker compose down -v
```

The `aprs-data` named volume persists the SQLite database at `/app/data/aprs.db` inside the container. Mount it to a host path if you want direct access:

```yaml
# docker-compose.yml override
volumes:
  - ./data:/app/data
```

### Direwolf as a sibling container

If Direwolf is also containerised on the same host, add both services to a shared network:

```yaml
services:
  direwolf:
    image: your-direwolf-image
    networks: [radio-net]

  aprs-web:
    build: .
    env_file: .env
    environment:
      DIREWOLF_HOST: direwolf   # matches the service name
    networks: [radio-net]

networks:
  radio-net:
```

---

## API Reference

All endpoints are prefixed with `/api`.

### `GET /api/stations`

Returns all known stations sorted by most recently heard.

```json
[
  {
    "callsign": "WA7DEM-1",
    "lat": 47.923,
    "lon": -122.244,
    "symbol_table": "/",
    "symbol_code": ">",
    "comment": "Mobile",
    "last_heard": 1746073800
  }
]
```

### `GET /api/weather/:callsign`

Returns up to 24 hours of weather logs for a station.

```json
[
  {
    "id": 1,
    "callsign": "KD6VPH",
    "temp": 13.3,
    "humidity": 72,
    "wind_dir": 220,
    "wind_speed": 4.47,
    "rain_1h": 0,
    "timestamp": 1746073800
  }
]
```

### `GET /api/messages`

Returns the message history involving `MY_CALLSIGN` (sent and received).

### `GET /api/history/:callsign`

Returns position history for a station within a given time period.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `period` | query (int) | `3600` | Lookback window in seconds |

```json
[
  {
    "lat": 47.228,
    "lon": -122.437,
    "speed": 35.2,
    "course": 180,
    "comment": "Mobile",
    "timestamp": 1746073200
  }
]
```

### `POST /api/transmit/beacon`

Transmit a position beacon via Direwolf.

```json
// Request body
{ "lat": 47.562, "lon": -122.149, "comment": "QRV" }

// Response
{ "ok": true, "info": "!4733.72N/12208.94W>QRV" }
```

### `POST /api/transmit/message`

Send an APRS message to another station.

```json
// Request body
{ "to_call": "W1AW-1", "message": "Hello from the dashboard" }

// Response
{ "ok": true, "msgNum": "001" }
```

### WebSocket Events (Socket.io)

| Event | Direction | Payload |
|---|---|---|
| `station_updated` | Server → Client | `{ callsign, lat, lon, symbol_table, symbol_code, comment, last_heard }` |
| `weather_updated` | Server → Client | `{ callsign, temp, humidity, wind_dir, wind_speed, rain_1h, timestamp }` |
| `message_received` | Server → Client | `{ from_call, to_call, message, is_outgoing, timestamp }` |
| `packet_log` | Server → Client | `{ callsign, type, raw, timestamp }` |

---

## Project Structure

```
aprs-web/
├── server/
│   ├── index.js          # Express + Socket.io entry point
│   ├── database.js       # SQLite init and prepared-statement wrappers
│   ├── direwolf.js       # KISS TCP client, AX.25 encode/decode, auto-reconnect
│   ├── aprsHandler.js    # APRS packet routing, DB writes, Socket.io emits
│   └── routes.js         # REST API endpoints
├── public/
│   ├── index.html        # Single-page application shell
│   ├── css/
│   │   └── style.css     # Dark-mode glassmorphism UI
│   ├── js/
│   │   ├── main.js       # Socket.io client, bootstrap
│   │   ├── map.js        # Leaflet map, APRS symbols, track polylines
│   │   └── ui.js         # Panels, modals, messaging, packet trace
│   └── symbols/          # APRS symbol sprite sheets (aprs.fi set)
│       ├── aprs-symbols-24-0.png
│       ├── aprs-symbols-24-0@2x.png
│       ├── aprs-symbols-24-1.png
│       └── aprs-symbols-24-1@2x.png
├── data/                 # SQLite database (gitignored, created at runtime)
│   └── aprs.db
├── .env                  # Local config (gitignored)
├── .env.example          # Config template
├── Dockerfile            # Multi-stage Docker build
├── docker-compose.yml    # Compose configuration
├── run.sh                # Local development launcher
├── package.json
├── CHANGELOG.md
└── README.md
```

---

## Roadmap

- [ ] APRS message ACK handling
- [ ] MicE packet decoding improvements
- [x] ~~Station history / track replay on map~~
- [ ] APRS-IS (internet gateway) fallback / dual feed
- [ ] Kubernetes `Deployment` + `ConfigMap` / `Secret` manifests
- [ ] Dark/light theme toggle
- [ ] Mobile-responsive layout improvements
- [ ] Position history auto-cleanup (configurable retention period)
