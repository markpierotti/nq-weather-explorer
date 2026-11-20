/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CycloneThreatDetection,
  EmergencyBundle,
  GeminiCycloneSynthesis,
  MultiModelBundle,
  WeatherAlert,
  WeatherLocation,
  WeatherNext3Bundle,
  WeatherNext3DailyMetrics,
  WeatherNext3HourlySample,
} from '../types/weather';

export const WN3_API_KEY_STORAGE = 'wn3_api_key';
const WN3_CACHE_PREFIX = 'wn3_cache_v2_';
const WN3_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes to protect 100 calls/day quota

const memoryCache = new Map<string, WeatherNext3Bundle>();

export function getStoredWn3ApiKey(): string {
  try {
    return (localStorage.getItem(WN3_API_KEY_STORAGE) || '').trim();
  } catch {
    return '';
  }
}

export function setStoredWn3ApiKey(key: string): void {
  try {
    const trimmed = key.trim();
    if (trimmed) {
      localStorage.setItem(WN3_API_KEY_STORAGE, trimmed);
    } else {
      localStorage.removeItem(WN3_API_KEY_STORAGE);
    }
  } catch {
    // Ignore storage quota errors
  }
}

function getCacheKey(lat: number, lng: number): string {
  return `${WN3_CACHE_PREFIX}${lat.toFixed(2)}_${lng.toFixed(2)}`;
}

function toBrisbaneDateKey(isoOrDate: string): string {
  const dt = new Date(isoOrDate);
  if (Number.isNaN(dt.getTime())) return isoOrDate.slice(0, 10);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Brisbane',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(dt);
}

function formatDayLabel(dateKey: string, idx: number): string {
  if (idx === 0) return 'Today';
  if (idx === 1) return 'Tomorrow';
  const [y, m, d] = dateKey.split('-').map((n) => Number.parseInt(n, 10));
  if (y && m && d) {
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.toLocaleDateString('en-AU', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
  }
  return dateKey;
}

function numOrNull(val: unknown): number | null {
  return typeof val === 'number' && Number.isFinite(val) ? val : null;
}

function round1(val: number): number {
  return Math.round(val * 10) / 10;
}

/**
 * Automatically detect active Tropical Low, Cyclone, or Flood warning from:
 * 1) ArcGIS Cyclone Track (Cyclone_Q1/FeatureServer/187)
 * 2) BOM official warnings or QLD Severe Weather/Flood/Cyclone warnings
 */
export function detectCycloneThreat(
  emergencyBundle: EmergencyBundle | null,
  multiModelBundle: MultiModelBundle | null
): CycloneThreatDetection {
  const reasons: string[] = [];
  const items = emergencyBundle?.items || [];

  const cycloneTrackItems = items.filter(
    (i) => i.category === 'cyclone' || i.id.startsWith('qld-cyclone')
  );
  if (cycloneTrackItems.length > 0) {
    reasons.push(
      `ArcGIS Cyclone Track active (${cycloneTrackItems.length} feature${cycloneTrackItems.length > 1 ? 's' : ''})`
    );
  }

  const threatKeywordRegex =
    /\b(tropical\s+cyclone|tropical\s+low|cyclone\s+watch|cyclone\s+warning|severe\s+tropical|coral\s+sea\s+low|flood\s+warning|flood\s+watch|major\s+flood|moderate\s+flood|minor\s+flood|storm\s+tide|severe\s+thunderstorm|flash\s+flood)\b/i;

  const bomThreatWarnings = (multiModelBundle?.bomWarnings || []).filter((w) =>
    threatKeywordRegex.test(`${w.title || ''} ${w.shortTitle || ''} ${w.type || ''}`)
  );

  const qldThreatWarnings = items.filter(
    (i) =>
      (i.category === 'warning' || i.category === 'bulletin') &&
      threatKeywordRegex.test(`${i.title || ''} ${i.subtitle || ''} ${i.description || ''}`)
  );

  const totalWarnCount = bomThreatWarnings.length + qldThreatWarnings.length;
  if (bomThreatWarnings.length > 0) {
    reasons.push(`BOM warning: ${bomThreatWarnings[0].shortTitle || bomThreatWarnings[0].title}`);
  } else if (qldThreatWarnings.length > 0) {
    reasons.push(`QLD Alert: ${qldThreatWarnings[0].title}`);
  }

  return {
    isThreatDetected: cycloneTrackItems.length > 0 || totalWarnCount > 0,
    reasons,
    cycloneTrackCount: cycloneTrackItems.length,
    cycloneWarningCount: totalWarnCount,
  };
}

function parseWeatherNext3Payload(
  lat: number,
  lng: number,
  daysJson: any,
  hoursJson: any,
  alertsJson: any,
  fetchedAt: number,
  fromCache: boolean,
  source: 'server-proxy' | 'local-key'
): WeatherNext3Bundle {
  const rawHours: any[] = Array.isArray(hoursJson?.forecastHours) ? hoursJson.forecastHours : [];
  const hourly120h: WeatherNext3HourlySample[] = rawHours.map((h) => {
    const timeIso = h?.interval?.startTime || '';
    const tempC = numOrNull(h?.temperature?.degrees);
    const precipMm = numOrNull(h?.precipitation?.qpf?.quantity);
    const windSpeedKmh = numOrNull(h?.wind?.speed?.value ?? h?.windSpeed?.value);
    const windGustKmh = numOrNull(h?.wind?.gust?.value ?? h?.windGust?.value);
    const pressureMb = numOrNull(h?.airPressure?.meanSeaLevelMillibars);
    const thunderstormPct = numOrNull(h?.thunderstormProbability);

    return {
      timeIso,
      tempC,
      precipMm,
      windSpeedKmh,
      windGustKmh,
      pressureMb,
      thunderstormPct,
    };
  });

  // Aggregate hourly metrics per Brisbane YYYY-MM-DD date
  const hourlyByDate: Record<
    string,
    {
      gusts: number[];
      pressures: number[];
      storms: number[];
      qpfSum: number;
      hasQpf: boolean;
    }
  > = {};

  hourly120h.forEach((h) => {
    if (!h.timeIso) return;
    const dk = toBrisbaneDateKey(h.timeIso);
    if (!hourlyByDate[dk]) {
      hourlyByDate[dk] = { gusts: [], pressures: [], storms: [], qpfSum: 0, hasQpf: false };
    }
    const bucket = hourlyByDate[dk];
    if (h.windGustKmh !== null) bucket.gusts.push(h.windGustKmh);
    if (h.pressureMb !== null) bucket.pressures.push(h.pressureMb);
    if (h.thunderstormPct !== null) bucket.storms.push(h.thunderstormPct);
    if (h.precipMm !== null) {
      bucket.qpfSum += h.precipMm;
      bucket.hasQpf = true;
    }
  });

  const rawDays: any[] = Array.isArray(daysJson?.forecastDays) ? daysJson.forecastDays : [];
  const daily10d: WeatherNext3DailyMetrics[] = rawDays.map((d, idx) => {
    let dateKey = '';
    if (d?.displayDate?.year && d?.displayDate?.month && d?.displayDate?.day) {
      dateKey = `${d.displayDate.year}-${String(d.displayDate.month).padStart(2, '0')}-${String(
        d.displayDate.day
      ).padStart(2, '0')}`;
    } else if (d?.interval?.startTime) {
      dateKey = toBrisbaneDateKey(d.interval.startTime);
    }

    const dayRain = numOrNull(d?.daytimeForecast?.precipitation?.qpf?.quantity);
    const nightRain = numOrNull(d?.nighttimeForecast?.precipitation?.qpf?.quantity);
    const totalDayQpf = numOrNull(d?.precipitation?.qpf?.quantity);
    const hourlyAgg = hourlyByDate[dateKey];

    let rainMm: number | null = totalDayQpf;
    if (rainMm === null && (dayRain !== null || nightRain !== null)) {
      rainMm = round1((dayRain ?? 0) + (nightRain ?? 0));
    } else if (rainMm === null && hourlyAgg?.hasQpf) {
      rainMm = round1(hourlyAgg.qpfSum);
    } else if (rainMm !== null) {
      rainMm = round1(rainMm);
    }

    const dayGust = numOrNull(d?.daytimeForecast?.wind?.gust?.value ?? d?.daytimeForecast?.windGust?.value);
    const nightGust = numOrNull(d?.nighttimeForecast?.wind?.gust?.value ?? d?.nighttimeForecast?.windGust?.value);
    const gustCandidates = [
      ...(dayGust !== null ? [dayGust] : []),
      ...(nightGust !== null ? [nightGust] : []),
      ...(hourlyAgg?.gusts || []),
    ];
    const peakGustKmh = gustCandidates.length > 0 ? round1(Math.max(...gustCandidates)) : null;

    const minPressureMb =
      hourlyAgg && hourlyAgg.pressures.length > 0 ? round1(Math.min(...hourlyAgg.pressures)) : null;

    const dayStorm = numOrNull(d?.daytimeForecast?.thunderstormProbability);
    const nightStorm = numOrNull(d?.nighttimeForecast?.thunderstormProbability);
    const stormCandidates = [
      ...(dayStorm !== null ? [dayStorm] : []),
      ...(nightStorm !== null ? [nightStorm] : []),
      ...(hourlyAgg?.storms || []),
    ];
    const peakThunderstormPct =
      stormCandidates.length > 0 ? Math.round(Math.max(...stormCandidates)) : null;

    return {
      dateKey,
      dayLabel: formatDayLabel(dateKey, idx),
      minTemp: numOrNull(d?.minTemperature?.degrees),
      maxTemp: numOrNull(d?.maxTemperature?.degrees),
      rainMm,
      rainChance:
        numOrNull(d?.daytimeForecast?.precipitation?.probability?.percent) ??
        numOrNull(d?.precipitation?.probability?.percent),
      peakGustKmh,
      minPressureMb,
      peakThunderstormPct,
      shortText: d?.daytimeForecast?.weatherCondition?.description?.text,
    };
  });

  const allGusts = hourly120h.map((h) => h.windGustKmh).filter((v): v is number => v !== null);
  const allPressures = hourly120h.map((h) => h.pressureMb).filter((v): v is number => v !== null);
  const allStorms = hourly120h.map((h) => h.thunderstormPct).filter((v): v is number => v !== null);
  const allQpfs = hourly120h.map((h) => h.precipMm).filter((v): v is number => v !== null);

  const peak120hGustKmh = allGusts.length > 0 ? round1(Math.max(...allGusts)) : null;
  const min120hPressureMb = allPressures.length > 0 ? round1(Math.min(...allPressures)) : null;
  const max120hPressureDropMb =
    allPressures.length >= 2 ? round1(Math.max(...allPressures) - Math.min(...allPressures)) : null;
  const peak120hThunderstormPct = allStorms.length > 0 ? Math.round(Math.max(...allStorms)) : null;
  const peak1hQpfMm = allQpfs.length > 0 ? round1(Math.max(...allQpfs)) : null;
  const total120hQpfMm = allQpfs.length > 0 ? round1(allQpfs.reduce((a, b) => a + b, 0)) : null;
  const alerts: WeatherAlert[] = Array.isArray(alertsJson?.weatherAlerts) ? alertsJson.weatherAlerts : [];

  return {
    lat,
    lng,
    daily10d,
    hourly120h,
    alerts,
    peak120hGustKmh,
    min120hPressureMb,
    max120hPressureDropMb,
    peak120hThunderstormPct,
    peak1hQpfMm,
    total120hQpfMm,
    fetchedAt,
    fromCache,
    source,
  };
}

/**
 * Fetch WeatherNext 3 (10-day, 120-hour, and publicAlerts) via backend GOOGLE_WEATHER_API_KEY proxy
 * (or optional local wn3_api_key fallback), cached for 30 minutes per coordinate.
 */
export async function fetchWeatherNext3(
  lat: number,
  lng: number,
  localApiKey: string,
  forceRefresh = false
): Promise<WeatherNext3Bundle> {
  const cacheKey = getCacheKey(lat, lng);
  const now = Date.now();

  if (!forceRefresh) {
    const memHit = memoryCache.get(cacheKey);
    if (memHit && now - memHit.fetchedAt < WN3_CACHE_TTL_MS) {
      return { ...memHit, fromCache: true };
    }
    try {
      const rawStored = localStorage.getItem(cacheKey);
      if (rawStored) {
        const parsed = JSON.parse(rawStored) as WeatherNext3Bundle;
        if (parsed && typeof parsed.fetchedAt === 'number' && now - parsed.fetchedAt < WN3_CACHE_TTL_MS) {
          memoryCache.set(cacheKey, parsed);
          return { ...parsed, fromCache: true };
        }
      }
    } catch {
      // Ignore corrupt cache
    }
  }

  // 1. Try backend GOOGLE_WEATHER_API_KEY proxy first (unless user specifically entered a local override and server has none)
  const serverRes = await fetch(
    `/api/weather/weathernext3?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}${forceRefresh ? '&force=1' : ''}`,
    { signal: AbortSignal.timeout(12000) }
  );

  if (serverRes.ok) {
    const payload = await serverRes.json();
    const bundle = parseWeatherNext3Payload(
      lat,
      lng,
      payload.daysJson,
      payload.hoursJson,
      payload.alertsJson,
      payload.fetchedAt || now,
      !!payload.serverCached,
      'server-proxy'
    );
    memoryCache.set(cacheKey, bundle);
    try {
      localStorage.setItem(cacheKey, JSON.stringify(bundle));
    } catch {
      // Ignore storage quota errors
    }
    return bundle;
  }

  let serverErrBody: any = {};
  try {
    serverErrBody = await serverRes.json();
  } catch {
    serverErrBody = {};
  }

  if (serverRes.status === 429 || serverErrBody?.apiError?.status === 'RESOURCE_EXHAUSTED') {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
    }
  }

  // 2. If server doesn't have GOOGLE_WEATHER_API_KEY configured, try local wn3_api_key if present
  const key = localApiKey.trim();
  if (key && serverErrBody?.code === 'NO_WEATHER_KEY') {
    const base = 'https://weather.googleapis.com/v1';
    const daysUrl = `${base}/forecast/days:lookup?key=${encodeURIComponent(key)}&location.latitude=${lat}&location.longitude=${lng}&days=10&unitsSystem=METRIC`;
    const hoursUrl = `${base}/forecast/hours:lookup?key=${encodeURIComponent(key)}&location.latitude=${lat}&location.longitude=${lng}&hours=120&unitsSystem=METRIC`;
    const alertsUrl = `${base}/publicAlerts:lookup?key=${encodeURIComponent(key)}&location.latitude=${lat}&location.longitude=${lng}`;

    const [daysRes, hoursRes, alertsRes] = await Promise.all([
      fetch(daysUrl, { signal: AbortSignal.timeout(10000) }),
      fetch(hoursUrl, { signal: AbortSignal.timeout(10000) }),
      fetch(alertsUrl, { signal: AbortSignal.timeout(10000) }),
    ]);

    if (!daysRes.ok && !hoursRes.ok) {
      let errMsg = `Google Weather API error (${daysRes.status})`;
      let errStatus = '';
      try {
        const errJson = await daysRes.json();
        errMsg = errJson?.error?.message || errMsg;
        errStatus = errJson?.error?.status || '';
      } catch {
        // Keep status message
      }
      if (daysRes.status === 429 || hoursRes.status === 429 || errStatus === 'RESOURCE_EXHAUSTED') {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
      }
      throw new Error(errMsg);
    }

    const [daysJson, hoursJson, alertsJson] = await Promise.all([
      daysRes.ok ? daysRes.json() : Promise.resolve({ forecastDays: [] }),
      hoursRes.ok ? hoursRes.json() : Promise.resolve({ forecastHours: [] }),
      alertsRes.ok ? alertsRes.json() : Promise.resolve({ weatherAlerts: [] }),
    ]);

    const bundle = parseWeatherNext3Payload(lat, lng, daysJson, hoursJson, alertsJson, now, false, 'local-key');
    memoryCache.set(cacheKey, bundle);
    try {
      localStorage.setItem(cacheKey, JSON.stringify(bundle));
    } catch {
      // Ignore storage quota errors
    }
    return bundle;
  }

  const err: any = new Error(serverErrBody?.error || `WeatherNext 3 error (${serverRes.status})`);
  err.code = serverErrBody?.code;
  throw err;
}

/**
 * Fallback on-demand Gemini Cyclone Synthesis when no GOOGLE_WEATHER_API_KEY / wn3_api_key is configured.
 */
export async function fetchGeminiCycloneSynthesis(
  location: WeatherLocation,
  multiModelBundle: MultiModelBundle | null,
  emergencyBundle: EmergencyBundle | null
): Promise<GeminiCycloneSynthesis> {
  const multiModelSummary = multiModelBundle
    ? {
        location: location.name,
        spreadOverview: multiModelBundle.spreadOverview,
        bomWarnings: multiModelBundle.bomWarnings.slice(0, 6),
        next5Days: multiModelBundle.daily7d.slice(0, 5).map((d) => ({
          day: d.dayLabel,
          weatherNext2: d.weatherNext2,
          bom: d.bom,
          ecmwf: d.ecmwf,
          gfs: d.gfs,
          deltaRainMm: d.deltaRainMm,
        })),
      }
    : { location: location.name };

  const cycloneAndRoadItems = (emergencyBundle?.items || [])
    .filter((i) => i.category === 'cyclone' || i.category === 'warning' || i.isCorridorPriority)
    .slice(0, 14)
    .map((i) => ({
      category: i.category,
      title: i.title,
      status: i.status,
      subtitle: i.subtitle,
    }));

  const res = await fetch('/api/briefing/cyclone', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      locationName: location.name,
      lat: location.lat,
      lng: location.lng,
      multiModelSummary,
      cycloneAndRoadItems,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || `Cyclone Synthesis failed (${res.status})`);
  }
  return data as GeminiCycloneSynthesis;
}
