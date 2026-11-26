# NQ Weather Explorer

An operational weather, radar, and disaster corridor monitoring web app built for **North Queensland** and the **Bruce Highway (A1) corridor** (Ayr ↔ Home Hill ↔ Giru ↔ Townsville).

During North Queensland's wet season, critical situational awareness is scattered across separate agency portals—BOM forecasts and river height bulletins, QLDTraffic road closures, Ergon outage maps, and Burdekin/Townsville disaster dashboards. **NQ Weather Explorer** unifies those live feeds onto a single dark-glass, mobile-first Google Maps interface with multi-model forecast consensus, Web Push corridor alerts, and a fail-closed, grounding-verified AI corridor briefing assistant.

## Key Capabilities

- **4-Model Forecast Consensus & Spread:** Side-by-side comparison of **Google WeatherNext 2**, **BOM**, **ECMWF IFS**, and **NOAA GFS** (plus on-demand **WeatherNext 3** in Cyclone Mode) with temperature/rainfall spread indicators so you can see where models agree or diverge.
- **Animated Radar Timeline:** RainViewer past + nowcast radar tile overlays with play/pause, speed toggle, opacity slider, and interactive scrubbing.
- **Live NQ Emergency & Corridor Layers:**
  - **QLDTraffic road events & closures** (Bruce Highway A1 corridor highlighted)
  - **BOM QLD official warnings** (flood, severe thunderstorm, cyclone)
  - **Live BOM river height gauges** (Burdekin, Haughton/Giru, Ross, Bohle, Alligator Creek, Black River) with 24-hour SVG sparklines, rising/falling trends, and official Minor/Moderate/Major flood thresholds
  - **Burdekin & Townsville council disaster feeds** (power outages, QFD incidents, evacuation centres, sandbags, fuel)
  - **Collapsible Map Legend** synced to active emergency layers
- **Web Push Corridor Alerts:** Opt-in browser push notifications (VAPID / `web-push`) backed by a server-side poller with deduplication for new road closures, BOM warnings, and rising river gauges.
- **Life-Safety-Hardened AI Corridor Briefing & Follow-Up Chat:**
  - Pulls live QLDTraffic, BOM warnings, and river gauge records directly from the server cache into a timestamped **Fact Ledger** (never relying solely on truncated client summaries).
  - Routes follow-up questions by intent (`road_corridor`, `river_flood`, `cyclone_wind`, `rain_forecast`) so a query like *"Is the Bruce Hwy open between Townsville and Ayr?"* zooms strictly into relevant corridor events and gauges.
  - Enforces **fail-closed** rules (`temperature: 0.1`, disables open web search on live road/gauge telemetry when official feeds are healthy, never infers "all clear" from zero alerts, and flags stale/unavailable feeds as blind spots).
  - Optional **Google Cloud Discovery Engine `CheckGrounding`** verification gate (`server/grounding.ts`) scores every claim against the live Fact Ledger and falls back to raw verified feed records if grounding drops below threshold.
- **Mobile-First & Desktop Responsive:** Draggable bottom sheet and tab bar on mobile; collapsible glass sidebar on desktop; on-demand geolocation only.

## Architecture & Dual-Key Security Model

All API keys are read from `.env` at runtime—zero secrets are hardcoded or bundled into client assets:

```text
                         ┌───────────────────────────┐
                         │  .env / runtime env vars  │
                         └─────────────┬─────────────┘
                                       │
          ┌────────────────────────────┴────────────────────────────┐
          ▼                                                         ▼
┌──────────────────────────────┐                  ┌───────────────────────────────────────┐
│   VITE_GOOGLE_MAPS_API_KEY   │                  │           Server-Only Keys            │
│    (Public Browser Key)      │                  │  (Express backend — never in client)  │
├──────────────────────────────┤                  ├───────────────────────────────────────┤
│ • Maps JavaScript API        │                  │ • GOOGLE_WEATHER_API_KEY              │
│ • Places UI Kit              │                  │ • GEMINI_API_KEY                      │
│ • HTTP referrer restricted   │                  │ • QLDTRAFFIC_API_KEY (optional)       │
│ • Served via /api/weather/   │                  │ • VAPID_PRIVATE_KEY (Web Push)        │
│   config at runtime          │                  │ • GOOGLE_APPLICATION_CREDENTIALS      │
└──────────────────────────────┘                  │   (Discovery Engine CheckGrounding)   │
                                                  └───────────────────────────────────────┘
```

## Tech Stack

- **Frontend:** React 19, TypeScript 5.8, Vite 6, Tailwind CSS v4, `@vis.gl/react-google-maps`, `motion`, `lucide-react`
- **Backend:** Express 4 (`server.ts`, `server/feeds/`, `server/push/`, `server/briefing.ts`, `server/grounding.ts`), `@google/genai`, `fast-xml-parser`, `web-push`
- **Deployment:** Docker + Docker Compose behind a TLS reverse proxy (Caddy/nginx)

## API Overview

| Endpoint | Method | Purpose |
| :--- | :--- | :--- |
| `/api/weather/config` | `GET` | Public Maps JS client configuration |
| `/api/weather/*` | `GET` | Server-side Google Weather, Geocoding, and Places proxies |
| `/api/emergency/traffic` | `GET` | Cached QLDTraffic road events & closures (3-min TTL) |
| `/api/emergency/bom-warnings` | `GET` | Cached official BOM QLD warnings (3-min TTL) |
| `/api/emergency/gauges` | `GET` | Cached BOM river height gauges + 24h history & flood thresholds (5-min TTL) |
| `/api/push/*` | `GET`/`POST`/`DELETE` | VAPID public key, push subscription management, and test notification |
| `/api/briefing/corridor` | `POST` | Structured 4-section operational briefing + feed health + optional `CheckGrounding` score |
| `/api/briefing/chat` | `POST` | SSE corridor follow-up chat with intent routing and optional verify-before-send grounding |
| `/api/briefing/cyclone` | `POST` | On-demand Coral Sea / NQ cyclone threat synthesis |

## Getting Started

### Prerequisites

- Node.js 20+
- A Google Cloud project with **Maps JavaScript API**, **Places API (New)**, **Geocoding API**, and **Weather API** enabled (plus **Gemini API** and optionally **Discovery Engine API** for AI briefings and `CheckGrounding`).

### Local Setup

```bash
npm install
cp .env.example .env
# Fill in your keys in .env
npm run dev
```

Open `http://localhost:3000`.

### Build, Type Check & Docker

```bash
npm run lint     # TypeScript check (tsc --noEmit)
npm run build    # Production client (Vite) + server bundle (esbuild -> dist/server.cjs)
npm start        # Run production server
```

For VPS deployment with Docker:

```bash
cp .env.example .env
docker compose up -d --build
```

Place a TLS-terminating reverse proxy (Caddy or nginx) in front of port `3000`—HTTPS is required for browser geolocation and Web Push notifications on mobile devices.

## License

Licensed under the [Apache License 2.0](LICENSE).
