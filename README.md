# Google Maps Weather Map & Forecast Explorer

An interactive global weather exploration application powered by the **Google Maps Platform Weather API**, **Weather Map Tiles**, and **Maps JavaScript API** (`@vis.gl/react-google-maps`).

---

## Features

- **Interactive Global Weather Map**: Smooth panning, zooming, and location selection powered by Google Maps Platform.
- **Precipitation Radar Nowcast**: Weather tile layers with opacity and visibility controls supporting high-resolution regional feeds:
  - `US_PRECIPITATION_CURRENT`: High-resolution United States precipitation nowcast.
  - `EU_PRECIPITATION_CURRENT`: High-resolution European precipitation nowcast.
- **Current Conditions**: Real-time temperature, feels-like, humidity, wind speed/direction/gusts, air pressure, UV index, and cloud cover.
- **Hourly Forecast**: 24-hour detailed forecast with temperature, rain probability, and weather condition breakdowns.
- **10-Day Extended Forecast**: Daily high/low temperatures, sunrise/sunset times, and precipitation chances.
- **Minute-by-Minute Nowcast & Trend Analysis**: Real-time precipitation progression over the next 60 minutes with historical snapshot tracking and trend direction indicators (increasing, decreasing, steady rain, stable dry).
- **Severe Weather Alerts**: Active meteorological warnings, watches, and advisories issued by national weather services worldwide.
- **24-Hour Observed History**: Actual observed weather history over the past 24 hours.
- **Places & Geocoding**: Search for any city, landmark, or region via Places API (New) with instant geocoding.
- **On-Demand Geolocation**: Device location is strictly requested on-demand when the user clicks the "Find My Location" crosshairs button (no automatic prompts on initial load).

---

## Architecture & Security: Two-Key Model

The application enforces a **strict dual-key separation** to adhere to Google Maps Platform security best practices with **zero hardcoded API keys**:

```
                       ┌─────────────────────────┐
                       │   AI Studio Secrets /   │
                       │   Environment Vars      │
                       └────────────┬────────────┘
                                    │
           ┌────────────────────────┴────────────────────────┐
           │                                                 │
           ▼                                                 ▼
┌─────────────────────────────┐           ┌──────────────────────────────────────┐
│  VITE_GOOGLE_MAPS_API_KEY   │           │        GOOGLE_WEATHER_API_KEY        │
│   (Public Client Key)       │           │         (Secret Backend Key)         │
├─────────────────────────────┤           ├──────────────────────────────────────┤
│ - Maps JavaScript API       │           │ - Google Weather API                 │
│ - Places UI Kit             │           │ - Places API (New) backend proxy     │
│ - Client map canvas         │           │ - Geocoding REST API proxy           │
│ - Restricted by HTTP origin │           │ - Weather Map Tiles proxy            │
│                             │           │ - NEVER revealed to client browsers  │
└─────────────────────────────┘           └──────────────────────────────────────┘
```

### Environment Variables

Configure these variables in your `.env` file or in the AI Studio **Secrets** panel:

| Variable | Scope | Purpose |
| :--- | :--- | :--- |
| `VITE_GOOGLE_MAPS_API_KEY` | Client & Backend | Public key used by the browser to load Google Maps JavaScript API and Places UI Kit. |
| `GOOGLE_WEATHER_API_KEY` | Backend Only | Secret server-side key for Google Maps Platform Weather, Geocoding, and Places REST APIs. |
| `PORT` | Backend | Port for Express & Vite dev server (defaults to `3000`). |

> **Security Note**: `GOOGLE_WEATHER_API_KEY` is kept strictly on the backend inside `server.ts` and is never sent to the browser or bundled into client assets. All source code files contain zero hardcoded API keys.

---

## API Endpoints (Backend Proxy)

The backend Express server (`server.ts`) acts as a secure reverse proxy for Google Maps Platform services:

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/weather/config` | `GET` | Returns client map configuration and public Maps JS API key. |
| `/api/weather/current` | `GET` | Current weather conditions for `lat` and `lng`. |
| `/api/weather/forecast/hourly` | `GET` | 24-hour hourly forecast. |
| `/api/weather/forecast/daily` | `GET` | Up to 10-day daily forecast. |
| `/api/weather/forecast/minutes` | `GET` | 60-minute nowcast segments (US & parts of Europe). |
| `/api/weather/alerts` | `GET` | Active severe weather alerts. |
| `/api/weather/history/hourly` | `GET` | Past 24 hours of observed weather history. |
| `/api/weather/tiles/:mapType/:z/:x/:y` | `GET` | Proxied Google Weather Map radar tiles. |
| `/api/geocode` | `GET` | Address-to-coordinates geocoding. |
| `/api/geocode/reverse` | `GET` | Coordinates-to-place reverse geocoding. |
| `/api/places/nearby` | `GET`/`POST` | Places API (New) nearby search for location resolution. |

---

## Getting Started

### Prerequisites

- Node.js 20+
- A Google Cloud project with the following APIs enabled:
  - **Maps JavaScript API**
  - **Places API (New)**
  - **Geocoding API**
  - **Google Maps Platform Weather API**

### Installation

1. Clone or extract the repository:
   ```bash
   npm install
   ```

2. Copy the environment template:
   ```bash
   cp .env.example .env
   ```

3. Add your keys to `.env`:
   ```bash
   VITE_GOOGLE_MAPS_API_KEY="your-maps-js-api-key"
   GOOGLE_WEATHER_API_KEY="your-weather-services-api-key"
   ```

### Running Locally

Start the full-stack development server on port 3000:
```bash
npm run dev
```

Visit `http://localhost:3000` in your browser.

### Building for Production

Compile the client bundle and backend server:
```bash
npm run build
npm start
```

### Type Checking & Linting

```bash
npm run lint
```

---

## License

This project is licensed under the Apache 2.0 License.
