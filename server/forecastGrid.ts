/**
 * Gridded model rain forecast for North Queensland (Open-Meteo, keyless, CC BY 4.0).
 *
 * RainViewer stopped publishing nowcast frames on 1 Jan 2026, so the radar timeline ends at "now".
 * This module samples Open-Meteo's hourly precipitation on a coarse lat/lon grid over NQ so the
 * client can keep the radar loop playing into a *model* forecast.
 *
 * Request budget: Open-Meteo counts every location as one call (free tier: 600/min, 10k/day,
 * non-commercial). GRID_POINTS is kept under 600 so one POST fits the per-minute window, and the
 * 3 h TTL (shared by all users, single-flighted by `cached`) caps usage at ~8 refreshes/day.
 */
import type { Express } from 'express';
import type { ForecastGridResponse } from '../src/types/weather';
import { cached, FEED_USER_AGENT } from './feeds/http';

// North Queensland: Torres Strait to Mackay/Longreach, Gulf to Coral Sea.
const LAT_NORTH = -10;
const LAT_SOUTH = -24.25;
const LON_WEST = 138;
const LON_EAST = 153.75;
const STEP_DEG = 0.75;
const FORECAST_HOURS = 13; // current hour + 12 h ahead
const TTL_MS = 3 * 60 * 60 * 1000;

const ROWS = Math.round((LAT_NORTH - LAT_SOUTH) / STEP_DEG) + 1; // 20
const COLS = Math.round((LON_EAST - LON_WEST) / STEP_DEG) + 1; // 22
export const GRID_POINTS = ROWS * COLS; // 440

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';

/** After a failed refresh (e.g. HTTP 429), don't retry upstream for this long; stale data is served meanwhile. */
const FAILURE_BACKOFF_MS = 15 * 60 * 1000;
let lastFailureAt = 0;

interface OpenMeteoLocation {
  hourly?: { time?: number[]; precipitation?: Array<number | null> };
}

async function fetchForecastGrid(): Promise<Omit<ForecastGridResponse, 'fromCache' | 'error'>> {
  const lats: string[] = [];
  const lons: string[] = [];
  // Row-major, north to south, west to east.
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      lats.push((LAT_NORTH - r * STEP_DEG).toFixed(2));
      lons.push((LON_WEST + c * STEP_DEG).toFixed(2));
    }
  }

  // POST: a GET with this many coordinates exceeds the upstream URL length limit (HTTP 414).
  const body = new URLSearchParams({
    latitude: lats.join(','),
    longitude: lons.join(','),
    hourly: 'precipitation',
    forecast_hours: String(FORECAST_HOURS),
    timeformat: 'unixtime',
    timezone: 'GMT',
  });

  const res = await fetch(OPEN_METEO_URL, {
    method: 'POST',
    headers: { 'User-Agent': FEED_USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Open-Meteo forecast grid: HTTP ${res.status} ${text.slice(0, 200)}`);

  const parsed = JSON.parse(text) as OpenMeteoLocation[] | OpenMeteoLocation;
  const locations = Array.isArray(parsed) ? parsed : [parsed];
  if (locations.length !== GRID_POINTS) {
    throw new Error(`Open-Meteo forecast grid: expected ${GRID_POINTS} locations, got ${locations.length}`);
  }

  const times = (locations[0].hourly?.time ?? []).map(Number).filter(Number.isFinite);
  // precipitation[t][cell] in tenths of a millimetre (the hour ending at times[t]).
  const precip: number[][] = times.map((_, t) =>
    locations.map((loc) => {
      const v = loc.hourly?.precipitation?.[t];
      return typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) : 0;
    }),
  );

  return {
    bbox: { north: LAT_NORTH, south: LAT_SOUTH, west: LON_WEST, east: LON_EAST },
    rows: ROWS,
    cols: COLS,
    times,
    precip,
    fetchedAt: Date.now(),
  };
}

/** fetchForecastGrid, but fails fast (no upstream call) within FAILURE_BACKOFF_MS of the last failure. */
async function fetchForecastGridWithBackoff() {
  if (Date.now() - lastFailureAt < FAILURE_BACKOFF_MS) {
    throw new Error('Open-Meteo forecast grid: backing off after a recent failure');
  }
  try {
    return await fetchForecastGrid();
  } catch (err) {
    lastFailureAt = Date.now();
    throw err;
  }
}

export function registerForecastGridRoute(app: Express) {
  app.get('/api/weather/forecast-grid', async (_req, res) => {
    try {
      const r = await cached('forecast-grid:nq', TTL_MS, fetchForecastGridWithBackoff);
      const payload: ForecastGridResponse = { ...r.value, fromCache: r.fromCache };
      if (r.staleError) payload.error = 'Serving cached forecast; refresh failed';
      res.set('Cache-Control', 'public, max-age=600');
      return res.json(payload);
    } catch (err) {
      console.warn('[forecast-grid]', err instanceof Error ? err.message : err);
      return res.status(502).json({ error: 'Forecast grid unavailable' });
    }
  });
}
