# AGENTS.md — nq-weather-explorer

Guidance for coding agents (Antigravity, Claude Code, Hermes, Codex) working in this repository.

## Project overview
- **App:** North Queensland & global Google Maps weather explorer with emergency feeds (BOM warnings, river gauges, QLDTraffic road events).
- **Stack:** React 19, Vite 6, Tailwind CSS v4, TypeScript 5.8 (`src/`), Express 4 backend (`server.ts`, `server/`), `@vis.gl/react-google-maps`, `@google/genai`, `fast-xml-parser`.
- **Deployment:** Local dev on port `3000`, Docker Compose (`Dockerfile`, `docker-compose.yml`) for VPS deployment behind a TLS reverse proxy.

## Security & dual-key invariant (do not violate)
- `VITE_GOOGLE_MAPS_API_KEY` is the **public browser key** (Maps JavaScript API & Places UI Kit), served to the client via `/api/weather/config`.
- `GOOGLE_WEATHER_API_KEY` is **server-only** (Google Weather, Geocoding, and Places REST APIs). Never expose it to `src/`, Vite client bundles, or `/api/weather/config`.
- `GEMINI_API_KEY` and `QLDTRAFFIC_API_KEY` are **server-only** and optional; never hardcode keys or commit `.env`.

## Key paths
- `server.ts` — Express server, Vite dev middleware, Google Maps Platform proxy endpoints, and emergency API routes.
- `server/feeds/` — Server-side emergency feeds (`bomWarnings.ts`, `gauges.ts`, `qldtraffic.ts`, `geo.ts`, `http.ts`, `index.ts`).
- `server/briefing.ts` — Optional Gemini AI corridor briefing / cyclone synthesis.
- `server/push/index.ts` — Push notification module.
- `src/` — React 19 mobile-first UI (`App.tsx`, `components/`, `hooks/`, `services/`, `state/`, `types/`, `utils/`).

## Verification before finishing any change
Run both checks and confirm exit code 0 before handing off:
```bash
npm run lint   # tsc --noEmit
npm run build  # vite build && esbuild server.ts -> dist/server.cjs
```
- Keep changes tightly scoped; do not modify `.env` or commit secrets.
- Check `git status` and `git diff` before concluding.
