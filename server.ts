/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import path from 'path';
import http from 'http';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { registerFeedRoutes } from './server/feeds/index';
import { registerPushRoutes, startPushPoller } from './server/push/index';
import { registerBriefingRoutes } from './server/briefing';

function parseCoordPair(latRaw: unknown, lngRaw: unknown): { lat: number; lng: number } | null {
  if (typeof latRaw !== 'string' && typeof latRaw !== 'number') return null;
  if (typeof lngRaw !== 'string' && typeof lngRaw !== 'number') return null;
  const sLat = String(latRaw).trim();
  const sLng = String(lngRaw).trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(sLat) || !/^-?\d+(?:\.\d+)?$/.test(sLng)) return null;
  const lat = Number(sLat);
  const lng = Number(sLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return null;
  }
  return { lat, lng };
}

function parseUnits(uRaw: unknown): 'METRIC' | 'IMPERIAL' {
  return String(uRaw || 'METRIC').toUpperCase() === 'IMPERIAL' ? 'IMPERIAL' : 'METRIC';
}

function parseBoundedInt(raw: unknown, defVal: number, minVal: number, maxVal: number): number {
  const n = Number.parseInt(String(raw ?? defVal), 10);
  if (!Number.isFinite(n)) return defVal;
  return Math.max(minVal, Math.min(maxVal, n));
}


dotenv.config();

const app = express();
// Number of reverse-proxy hops in front of the app (e.g. 1 for nginx/Caddy on a VPS).
app.set('trust proxy', Number.parseInt(process.env.TRUST_PROXY || '1', 10) || false);
const PORT = 3000;
app.use(express.json());

// -------------------------------------------------------------
// Two API Keys Architecture:
// 1. PUBLIC KEY: Google Maps JavaScript API (client-side map rendering)
//    - Loaded by the browser when Google Maps initializes.
// 2. BACKEND KEY: Web Services (Google Weather, Geocoding, Places)
//    - Kept secret in backend environment and NEVER revealed to the browser.
function getBackendWebServiceApiKey(): string {
  return process.env.GOOGLE_WEATHER_API_KEY || '';
}

function getPublicMapsApiKey(): string {
  return process.env.VITE_GOOGLE_MAPS_API_KEY || '';
}

// Aliases for server-side proxy routes
const getMapsApiKey = getBackendWebServiceApiKey;
const getWeatherApiKey = getBackendWebServiceApiKey;

function redactApiKey(val: unknown, ...keys: string[]): string {
  let out = String((val as any)?.message || val || '');
  out = out.replace(/([?&]key=)[^&\s"']+/gi, '$1[REDACTED]');
  for (const k of keys) {
    if (k && k.length >= 8) {
      out = out.split(k).join('[REDACTED]');
    }
  }
  return out;
}

// Structured logger for Google Weather API calls
function logWeatherApiRequest(
  endpointName: string,
  targetUrl: string,
  status: number,
  statusText: string,
  dataOrError?: any,
  locationInfo?: Record<string, any>
) {
  const timestamp = new Date().toISOString();
  const maskedUrl = redactApiKey(targetUrl, getBackendWebServiceApiKey());
  const isOk = status >= 200 && status < 300;
  const isExpectedOutOfCoverage =
    (status === 400 || status === 404) &&
    (JSON.stringify(dataOrError || '').toLowerCase().includes('coverage') ||
      JSON.stringify(dataOrError || '').toLowerCase().includes('not supported') ||
      JSON.stringify(dataOrError || '').includes('NOT_FOUND'));

  const statusColor = isOk ? '\x1b[32m' : isExpectedOutOfCoverage ? '\x1b[33m' : '\x1b[31m';
  const resetColor = '\x1b[0m';
  const statusBadge = `${statusColor}[${status} ${statusText}]${resetColor}`;

  console.log(`\n================== 🌐 [GOOGLE WEATHER API REQUEST] ==================`);
  console.log(`⏱️ Timestamp : ${timestamp}`);
  console.log(`📌 Endpoint  : ${endpointName}`);
  if (locationInfo?.lat && locationInfo?.lng) {
    console.log(`📍 Location  : lat=${locationInfo.lat}, lng=${locationInfo.lng}`);
  }
  console.log(`🔗 Target URL: ${maskedUrl}`);
  console.log(`📊 Status    : ${statusBadge}`);

  if (isExpectedOutOfCoverage) {
    console.log(`ℹ️ Coverage Note: Location is outside supported coverage for ${endpointName}.`);
  } else if (!isOk) {
    console.log(`⚠️ API Response Notice (${status}): ${redactApiKey(dataOrError?.error?.message || statusText, getBackendWebServiceApiKey())}`);
  } else {
    const keys = Object.keys(dataOrError || {});
    console.log(`✅ Response Success: Returned keys [${keys.join(', ')}]`);
  }
  console.log(`======================================================================\n`);
}

// 1. Client Map Config
// Returns ONLY the public Maps JavaScript API key for the browser to render the map,
// plus a boolean indicating whether GOOGLE_WEATHER_API_KEY is available on the server.
app.get('/api/weather/config', (req, res) => {
  const publicMapsKey = getPublicMapsApiKey();
  res.json({
    hasKey: !!publicMapsKey,
    apiKey: publicMapsKey,
    hasBackendWeatherKey: !!getWeatherApiKey(),
  });
});

// 2. Current Conditions Lookup (Global coverage)
app.get('/api/weather/current', async (req, res) => {
  const { lat, lng, units = 'METRIC' } = req.query;
  const weatherKey = getWeatherApiKey();

  const coords = parseCoordPair(lat, lng);
  if (!coords) {
    return res.status(400).json({ error: 'Valid numeric lat (-90..90) and lng (-180..180) query parameters are required' });
  }
  const urlObj = new URL('https://weather.googleapis.com/v1/currentConditions:lookup');
  urlObj.searchParams.set('location.latitude', String(coords.lat));
  urlObj.searchParams.set('location.longitude', String(coords.lng));
  urlObj.searchParams.set('unitsSystem', parseUnits(units));
  const url = urlObj.toString();

  try {
    const response = await fetch(url, {
      headers: { 'X-Goog-Api-Key': weatherKey },
      redirect: 'error',
    });
    const text = await response.text();
    let data: any = {};
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    logWeatherApiRequest('currentConditions:lookup', url, response.status, response.statusText, data, { lat, lng });

    if (!response.ok) {
      return res.json({
        isUnsupportedLocation: true,
        status: response.status,
        statusText: response.statusText,
        apiStatus: response.status,
        apiError: data.error || data,
        error: data.error || data,
        endpoint: 'currentConditions:lookup',
      });
    }

    return res.json(data);
  } catch (err: any) {
    const safeErr = redactApiKey(err, weatherKey);
    console.error('Error fetching current weather conditions:', safeErr);
    logWeatherApiRequest('currentConditions:lookup', url, 500, 'Fetch Exception', safeErr, { lat, lng });
    return res.status(500).json({ isUnsupportedLocation: true, status: 500, error: { message: 'Weather service request failed' } });
  }
});

// 3. Hourly Forecast Lookup (Global coverage)
app.get('/api/weather/forecast/hourly', async (req, res) => {
  const { lat, lng, hours = '24', units = 'METRIC' } = req.query;
  const weatherKey = getWeatherApiKey();

  const coords = parseCoordPair(lat, lng);
  if (!coords) {
    return res.status(400).json({ error: 'Valid numeric lat and lng query parameters are required' });
  }
  const urlObj = new URL('https://weather.googleapis.com/v1/forecast/hours:lookup');
  urlObj.searchParams.set('location.latitude', String(coords.lat));
  urlObj.searchParams.set('location.longitude', String(coords.lng));
  urlObj.searchParams.set('hours', String(parseBoundedInt(hours, 24, 1, 240)));
  urlObj.searchParams.set('unitsSystem', parseUnits(units));
  const url = urlObj.toString();

  try {
    const response = await fetch(url, {
      headers: { 'X-Goog-Api-Key': weatherKey },
      redirect: 'error',
    });
    const text = await response.text();
    let data: any = {};
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    logWeatherApiRequest('forecast/hours:lookup', url, response.status, response.statusText, data, { lat, lng });

    if (!response.ok) {
      return res.json({
        forecastHours: [],
        status: response.status,
        statusText: response.statusText,
        apiStatus: response.status,
        apiError: data.error || data,
        error: data.error || data,
        endpoint: 'forecast/hours:lookup',
      });
    }

    return res.json(data);
  } catch (err: any) {
    const safeErr = redactApiKey(err, weatherKey);
    console.error('Error fetching hourly weather forecast:', safeErr);
    logWeatherApiRequest('forecast/hours:lookup', url, 500, 'Fetch Exception', safeErr, { lat, lng });
    return res.status(500).json({ forecastHours: [], status: 500, error: { message: 'Hourly forecast request failed' } });
  }
});

// 4. Daily Forecast Lookup (Global coverage)
app.get('/api/weather/forecast/daily', async (req, res) => {
  const { lat, lng, days = '10', units = 'METRIC' } = req.query;
  const weatherKey = getWeatherApiKey();

  const coords = parseCoordPair(lat, lng);
  if (!coords) {
    return res.status(400).json({ error: 'Valid numeric lat and lng query parameters are required' });
  }
  const urlObj = new URL('https://weather.googleapis.com/v1/forecast/days:lookup');
  urlObj.searchParams.set('location.latitude', String(coords.lat));
  urlObj.searchParams.set('location.longitude', String(coords.lng));
  urlObj.searchParams.set('days', String(parseBoundedInt(days, 10, 1, 16)));
  urlObj.searchParams.set('unitsSystem', parseUnits(units));
  const url = urlObj.toString();

  try {
    const response = await fetch(url, {
      headers: { 'X-Goog-Api-Key': weatherKey },
      redirect: 'error',
    });
    const text = await response.text();
    let data: any = {};
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    logWeatherApiRequest('forecast/days:lookup', url, response.status, response.statusText, data, { lat, lng });

    if (!response.ok) {
      return res.json({
        forecastDays: [],
        status: response.status,
        statusText: response.statusText,
        apiStatus: response.status,
        apiError: data.error || data,
        error: data.error || data,
        endpoint: 'forecast/days:lookup',
      });
    }

    return res.json(data);
  } catch (err: any) {
    const safeErr = redactApiKey(err, weatherKey);
    console.error('Error fetching daily weather forecast:', safeErr);
    logWeatherApiRequest('forecast/days:lookup', url, 500, 'Fetch Exception', safeErr, { lat, lng });
    return res.status(500).json({ forecastDays: [], status: 500, error: { message: 'Daily forecast request failed' } });
  }
});


// 6. Real-Time Weather Alerts Lookup (Global coverage)
app.get('/api/weather/alerts', async (req, res) => {
  const { lat, lng } = req.query;
  const weatherKey = getWeatherApiKey();

  const coords = parseCoordPair(lat, lng);
  if (!coords) {
    return res.status(400).json({ error: 'Valid numeric lat and lng query parameters are required' });
  }
  const urlObj = new URL('https://weather.googleapis.com/v1/publicAlerts:lookup');
  urlObj.searchParams.set('location.latitude', String(coords.lat));
  urlObj.searchParams.set('location.longitude', String(coords.lng));
  const url = urlObj.toString();

  try {
    const response = await fetch(url, {
      headers: { 'X-Goog-Api-Key': weatherKey },
      redirect: 'error',
    });
    const text = await response.text();
    let data: any = {};
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    logWeatherApiRequest('publicAlerts:lookup', url, response.status, response.statusText, data, { lat, lng });

    if (!response.ok) {
      return res.json({ weatherAlerts: [], apiStatus: response.status, apiError: data.error || data });
    }

    return res.json(data);
  } catch (err: any) {
    const safeErr = redactApiKey(err, weatherKey);
    console.error('Error fetching weather alerts:', safeErr);
    logWeatherApiRequest('publicAlerts:lookup', url, 500, 'Fetch Exception', safeErr, { lat, lng });
    return res.json({ weatherAlerts: [] });
  }
});

// 7. Hourly History Weather Lookup (Past 24 hours of actual observed weather)
app.get('/api/weather/history/hourly', async (req, res) => {
  const { lat, lng, hours = '24', units = 'METRIC' } = req.query;
  const weatherKey = getWeatherApiKey();

  const coords = parseCoordPair(lat, lng);
  if (!coords) {
    return res.status(400).json({ error: 'Valid numeric lat and lng query parameters are required' });
  }
  const urlObj = new URL('https://weather.googleapis.com/v1/history/hours:lookup');
  urlObj.searchParams.set('location.latitude', String(coords.lat));
  urlObj.searchParams.set('location.longitude', String(coords.lng));
  urlObj.searchParams.set('hours', String(parseBoundedInt(hours, 24, 1, 240)));
  urlObj.searchParams.set('unitsSystem', parseUnits(units));
  const url = urlObj.toString();

  try {
    const response = await fetch(url, {
      headers: { 'X-Goog-Api-Key': weatherKey },
      redirect: 'error',
    });
    const text = await response.text();
    let data: any = {};
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    logWeatherApiRequest('history/hours:lookup', url, response.status, response.statusText, data, { lat, lng, hours, units });

    if (!response.ok) {
      return res.json({
        historyHours: [],
        endpoint: 'history/hours:lookup',
        status: response.status,
        statusText: response.statusText,
        error: data.error || data,
      });
    }

    return res.json(data);
  } catch (err: any) {
    const safeErr = redactApiKey(err, weatherKey);
    console.error('Error fetching hourly weather history:', safeErr);
    logWeatherApiRequest('history/hours:lookup', url, 500, 'Fetch Exception', safeErr, { lat, lng, hours, units });
    return res.json({ historyHours: [], error: { message: 'History weather request failed' } });
  }
});


// 8. Geocoding Proxy (legacy maps.googleapis.com/maps/api/* requires ?key= with log redaction)
app.get('/api/geocode', async (req, res) => {
  const { address } = req.query;
  const mapsKey = getMapsApiKey();

  if (!address) {
    return res.status(400).json({ error: 'address query parameter is required' });
  }

  try {
    const urlObj = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    urlObj.searchParams.set('address', String(address).slice(0, 300));
    urlObj.searchParams.set('key', mapsKey);
    const response = await fetch(urlObj.toString(), { redirect: 'error' });
    const data = await response.json();
    return res.json(data);
  } catch (err: any) {
    console.error('Error in /api/geocode:', redactApiKey(err, mapsKey));
    return res.status(500).json({ error: 'Geocoding request failed' });
  }
});

// 9. Reverse Geocoding Proxy (legacy maps.googleapis.com/maps/api/* requires ?key= with log redaction)
app.get('/api/geocode/reverse', async (req, res) => {
  const { lat, lng } = req.query;
  const mapsKey = getMapsApiKey();

  const coords = parseCoordPair(lat, lng);
  if (!coords) {
    return res.status(400).json({ error: 'Valid numeric lat and lng query parameters are required' });
  }

  try {
    const urlObj = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    urlObj.searchParams.set('latlng', `${coords.lat},${coords.lng}`);
    urlObj.searchParams.set('key', mapsKey);
    const response = await fetch(urlObj.toString(), { redirect: 'error' });
    const data = await response.json();
    return res.json(data);
  } catch (err: any) {
    console.error('Error in /api/geocode/reverse:', redactApiKey(err, mapsKey));
    return res.status(500).json({ error: 'Reverse geocoding request failed' });
  }
});

// 10. Places API (New) - Nearby Search by Lat/Lng
app.all(['/api/places/nearby', '/api/places/searchNearby'], async (req, res) => {
  const lat = req.query.lat || req.body?.lat;
  const lng = req.query.lng || req.body?.lng;
  const radius = req.query.radius || req.body?.radius || 15000;
  const mapsKey = getMapsApiKey();

  if (!lat || !lng) {
    return res.status(400).json({ error: 'lat and lng parameters are required' });
  }

  try {
    const url = 'https://places.googleapis.com/v1/places:searchNearby';
    const payload = {
      maxResultCount: 8,
      locationRestriction: {
        circle: {
          center: {
            latitude: parseFloat(String(lat)),
            longitude: parseFloat(String(lng)),
          },
          radius: parseFloat(String(radius)),
        },
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': mapsKey,
        'X-Goog-FieldMask':
          'places.id,places.displayName,places.formattedAddress,places.shortFormattedAddress,places.location,places.addressComponents,places.primaryTypeDisplayName,places.types',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    return res.json(data);
  } catch (err: any) {
    console.error('Error in /api/places/nearby:', redactApiKey(err, mapsKey));
    return res.status(500).json({ error: 'Places search request failed' });
  }
});

// 10b. WeatherNext 3 Bundle Proxy (30-min server cache to protect 100 calls/day quota)
const WN3_SERVER_CACHE_TTL_MS = 30 * 60 * 1000;
const wn3ServerCache = new Map<string, { fetchedAt: number; payload: any }>();

app.get('/api/weather/weathernext3', async (req, res) => {
  const weatherKey = getWeatherApiKey();
  if (!weatherKey) {
    return res.status(503).json({
      code: 'NO_WEATHER_KEY',
      error: 'GOOGLE_WEATHER_API_KEY is not configured on the server.',
    });
  }

  const coords = parseCoordPair(req.query.lat, req.query.lng);
  if (!coords) {
    return res.status(400).json({ error: 'Valid numeric lat and lng query parameters are required' });
  }

  const forceRefresh = req.query.force === '1' || req.query.force === 'true';
  const cacheKey = `${coords.lat.toFixed(2)}_${coords.lng.toFixed(2)}`;
  const now = Date.now();

  if (!forceRefresh) {
    const cached = wn3ServerCache.get(cacheKey);
    if (cached && now - cached.fetchedAt < WN3_SERVER_CACHE_TTL_MS) {
      return res.json({ ...cached.payload, serverCached: true, fetchedAt: cached.fetchedAt });
    }
  }

  const daysUrl = new URL('https://weather.googleapis.com/v1/forecast/days:lookup');
  daysUrl.searchParams.set('location.latitude', String(coords.lat));
  daysUrl.searchParams.set('location.longitude', String(coords.lng));
  daysUrl.searchParams.set('days', '10');
  daysUrl.searchParams.set('unitsSystem', 'METRIC');

  const hoursUrl = new URL('https://weather.googleapis.com/v1/forecast/hours:lookup');
  hoursUrl.searchParams.set('location.latitude', String(coords.lat));
  hoursUrl.searchParams.set('location.longitude', String(coords.lng));
  hoursUrl.searchParams.set('hours', '120');
  hoursUrl.searchParams.set('unitsSystem', 'METRIC');

  const alertsUrl = new URL('https://weather.googleapis.com/v1/publicAlerts:lookup');
  alertsUrl.searchParams.set('location.latitude', String(coords.lat));
  alertsUrl.searchParams.set('location.longitude', String(coords.lng));

  try {
    const [daysRes, hoursRes, alertsRes] = await Promise.all([
      fetch(daysUrl.toString(), { headers: { 'X-Goog-Api-Key': weatherKey }, redirect: 'error' }),
      fetch(hoursUrl.toString(), { headers: { 'X-Goog-Api-Key': weatherKey }, redirect: 'error' }),
      fetch(alertsUrl.toString(), { headers: { 'X-Goog-Api-Key': weatherKey }, redirect: 'error' }),
    ]);

    const parseJsonSafe = async (r: Response) => {
      const txt = await r.text();
      try {
        return JSON.parse(txt);
      } catch {
        return { raw: txt };
      }
    };

    const [daysJson, hoursJson, alertsJson] = await Promise.all([
      parseJsonSafe(daysRes),
      parseJsonSafe(hoursRes),
      parseJsonSafe(alertsRes),
    ]);

    logWeatherApiRequest('weathernext3:days+hours+alerts', daysUrl.toString(), daysRes.status, daysRes.statusText, daysJson, coords);

    if (!daysRes.ok && !hoursRes.ok) {
      return res.status(daysRes.status || 502).json({
        error: daysJson?.error?.message || hoursJson?.error?.message || `Google Weather API error (${daysRes.status})`,
        apiError: daysJson?.error || hoursJson?.error,
      });
    }

    const payload = {
      daysJson: daysRes.ok ? daysJson : { forecastDays: [] },
      hoursJson: hoursRes.ok ? hoursJson : { forecastHours: [] },
      alertsJson: alertsRes.ok ? alertsJson : { weatherAlerts: [] },
      fetchedAt: now,
      serverCached: false,
    };

    wn3ServerCache.set(cacheKey, { fetchedAt: now, payload });
    return res.json(payload);
  } catch (err: any) {
    const safeErr = redactApiKey(err, weatherKey);
    console.error('Error in /api/weather/weathernext3:', safeErr);
    return res.status(500).json({ error: 'WeatherNext 3 server proxy request failed' });
  }
});

// 11. Allowlisted Emergency Guardian IMS Proxy (Burdekin & Townsville /dashboard/* only)
const ALLOWED_EMERGENCY_HOSTS = new Set([
  'disaster.burdekin.qld.gov.au',
  'disaster.townsville.qld.gov.au',
]);
const emergencyProxyCache = new Map<string, { fetchedAt: number; status: number; contentType: string; body: string }>();
const EMERGENCY_CACHE_TTL_MS = 2 * 60 * 1000;

app.get('/api/emergency/proxy', async (req, res) => {
  const targetRaw = String(req.query.url || '').trim();
  if (!targetRaw) {
    return res.status(400).json({ error: 'url query parameter is required' });
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(targetRaw);
  } catch {
    return res.status(400).json({ error: 'Invalid target URL' });
  }
  if (
    parsedUrl.protocol !== 'https:' ||
    !ALLOWED_EMERGENCY_HOSTS.has(parsedUrl.hostname) ||
    !parsedUrl.pathname.startsWith('/dashboard/')
  ) {
    return res.status(403).json({ error: 'Host or path not permitted for emergency proxy' });
  }

  const cacheKey = parsedUrl.toString();
  const cached = emergencyProxyCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < EMERGENCY_CACHE_TTL_MS) {
    res.status(cached.status);
    res.setHeader('Content-Type', cached.contentType);
    return res.send(cached.body);
  }

  try {
    const upstream = await fetch(cacheKey, {
      headers: {
        Accept: 'application/json, text/plain, */*',
        'User-Agent': 'NorthQldWeatherExplorer/1.0',
      },
      signal: AbortSignal.timeout(10000),
    });
    const text = await upstream.text();
    const contentType = upstream.headers.get('content-type') || 'application/json; charset=utf-8';
    if (upstream.ok) {
      emergencyProxyCache.set(cacheKey, {
        fetchedAt: Date.now(),
        status: upstream.status,
        contentType,
        body: text,
      });
    }
    res.status(upstream.status);
    res.setHeader('Content-Type', contentType);
    return res.send(text);
  } catch (err: any) {
    return res.status(502).json({ error: err?.message || 'Upstream Guardian IMS fetch failed' });
  }
});

// Modular routes (server/*)
registerFeedRoutes(app);
registerPushRoutes(app);
registerBriefingRoutes(app);

// Vite & Static Asset Handling
async function startServer() {
  const server = http.createServer(app);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: { server },
      },
      appType: 'spa',
    });

    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(["/server.cjs", "/server.cjs.map"], (_req: any, res: any) => res.status(404).end());
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`Port is already in use, retrying connection...`);
    } else {
      console.error('Server error:', err);
    }
  });

  const port = Number(process.env.PORT) || PORT;
  server.listen(port, '0.0.0.0', () => {
    console.log(`Weather Map Server running on http://0.0.0.0:${port}`);
    startPushPoller();
  });
}

startServer();
