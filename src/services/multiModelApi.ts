/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BomLocationInfo,
  BomWarningItem,
  DailyComparisonRow,
  DailyForecast,
  DailyModelMetrics,
  ModelMetricsSample,
  MultiModelBundle,
  RainViewerData,
  RainViewerFrame,
  ThreeHourlyModelRow,
  WeatherLocation,
} from '../types/weather';

function finiteNums(vals: Array<number | null | undefined>): number[] {
  return vals.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
}

function round1(val: number): number {
  return Math.round(val * 10) / 10;
}

function safeMean(vals: Array<number | null | undefined>): number | null {
  const clean = finiteNums(vals);
  if (clean.length === 0) return null;
  const sum = clean.reduce((acc, v) => acc + v, 0);
  return round1(sum / clean.length);
}

function safeSpread(vals: Array<number | null | undefined>): number | null {
  const clean = finiteNums(vals);
  if (clean.length < 2) return null;
  return round1(Math.max(...clean) - Math.min(...clean));
}

function formatBrisbaneHourLabel(isoTime: string): string {
  // Open-Meteo returns YYYY-MM-DDTHH:MM in Australia/Brisbane when timezone=Australia%2FBrisbane
  const match = isoTime.match(/T(\d{2}):(\d{2})/);
  if (match) {
    const h = Number.parseInt(match[1], 10);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}${ampm}`;
  }
  return isoTime;
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

/**
 * Resolve BOM geohash for an Australian location.
 */
async function fetchBomData(location: WeatherLocation): Promise<{
  bomLocation: BomLocationInfo | null;
  dailyByDate: Record<string, DailyModelMetrics>;
  warnings: BomWarningItem[];
  error?: string;
}> {
  const candidates = Array.from(
    new Set(
      [
        location.searchQuery,
        location.name.split('/')[0].trim(),
        location.name,
      ].filter((s): s is string => !!s && s.trim().length > 1)
    )
  );

  let matchedLoc: any = null;
  for (const q of candidates) {
    try {
      const res = await fetch(
        `https://api.weather.bom.gov.au/v1/locations?search=${encodeURIComponent(q)}`,
        { signal: AbortSignal.timeout(7000) }
      );
      if (!res.ok) continue;
      const json = await res.json();
      if (Array.isArray(json?.data) && json.data.length > 0) {
        // Prefer QLD match when searching North Queensland
        matchedLoc =
          json.data.find((d: any) => String(d.state || '').toUpperCase() === 'QLD') ||
          json.data[0];
        if (matchedLoc?.geohash) break;
      }
    } catch {
      // Try next candidate
    }
  }

  if (!matchedLoc?.geohash) {
    return {
      bomLocation: null,
      dailyByDate: {},
      warnings: [],
      error: 'BOM geohash unavailable for this location',
    };
  }

  const geohash = String(matchedLoc.geohash);
  const bomLocation: BomLocationInfo = {
    geohash,
    name: matchedLoc.name || location.name,
    state: matchedLoc.state || 'QLD',
  };

  const [dailyRes, warnRes] = await Promise.allSettled([
    fetch(`https://api.weather.bom.gov.au/v1/locations/${encodeURIComponent(geohash)}/forecasts/daily`, {
      signal: AbortSignal.timeout(7000),
    }).then((r) => (r.ok ? r.json() : null)),
    fetch(`https://api.weather.bom.gov.au/v1/locations/${encodeURIComponent(geohash)}/warnings`, {
      signal: AbortSignal.timeout(7000),
    }).then((r) => (r.ok ? r.json() : null)),
  ]);

  const dailyByDate: Record<string, DailyModelMetrics> = {};
  if (dailyRes.status === 'fulfilled' && Array.isArray(dailyRes.value?.data)) {
    for (const entry of dailyRes.value.data) {
      if (!entry?.date) continue;
      // Convert UTC/offset BOM date into Australia/Brisbane YYYY-MM-DD key
      const dt = new Date(entry.date);
      const dateKey = Number.isNaN(dt.getTime())
        ? String(entry.date).slice(0, 10)
        : new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Australia/Brisbane',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(dt);

      const minT =
        typeof entry.temp_min === 'number' && Number.isFinite(entry.temp_min)
          ? entry.temp_min
          : null;
      const maxT =
        typeof entry.temp_max === 'number' && Number.isFinite(entry.temp_max)
          ? entry.temp_max
          : null;

      // CRITICAL null-safety rule: BOM rain.amount.max is often null on dry days
      const rainMaxRaw = entry.rain?.amount?.max;
      const rainMinRaw = entry.rain?.amount?.min;
      const rainChanceRaw = entry.rain?.chance;

      let rainMm: number | null = null;
      if (typeof rainMaxRaw === 'number' && Number.isFinite(rainMaxRaw)) {
        rainMm =
          typeof rainMinRaw === 'number' && Number.isFinite(rainMinRaw)
            ? round1((rainMinRaw + rainMaxRaw) / 2)
            : round1(rainMaxRaw);
      } else if (typeof rainMinRaw === 'number' && Number.isFinite(rainMinRaw)) {
        rainMm = round1(rainMinRaw);
      } else if (rainMaxRaw === null && (rainChanceRaw === 0 || rainChanceRaw === null || typeof rainChanceRaw === 'number')) {
        // Explicit dry/no-upper-bound day: treat null max with min=0 or dry forecast as 0mm rather than NaN
        rainMm = 0;
      }

      dailyByDate[dateKey] = {
        minTemp: minT,
        maxTemp: maxT,
        rainMm,
        rainChance: typeof rainChanceRaw === 'number' && Number.isFinite(rainChanceRaw) ? rainChanceRaw : null,
        shortText: entry.short_text || undefined,
      };
    }
  }

  const warnings: BomWarningItem[] = [];
  if (warnRes.status === 'fulfilled' && Array.isArray(warnRes.value?.data)) {
    for (const w of warnRes.value.data) {
      warnings.push({
        id: String(w.id || w.title || Math.random()),
        title: w.title || 'BOM Weather Warning',
        shortTitle: w.short_title,
        type: w.type,
        state: w.state,
        issueTime: w.issue_time,
        expiryTime: w.expiry_time,
        phase: w.phase,
      });
    }
  }

  return { bomLocation, dailyByDate, warnings };
}

function getArrayVal(arr: unknown, idx: number): number | null {
  if (!Array.isArray(arr)) return null;
  const val = arr[idx];
  return typeof val === 'number' && Number.isFinite(val) ? val : null;
}

export async function fetchMultiModelForecast(
  location: WeatherLocation,
  googleDaily?: DailyForecast[]
): Promise<MultiModelBundle> {
  const { lat, lng } = location;
  const errors: string[] = [];

  const openMeteoUrl =
    `https://ensemble-api.open-meteo.com/v1/ensemble` +
    `?latitude=${encodeURIComponent(lat.toFixed(4))}` +
    `&longitude=${encodeURIComponent(lng.toFixed(4))}` +
    `&hourly=temperature_2m,precipitation,wind_speed_10m` +
    `&forecast_days=7` +
    `&timezone=Australia%2FBrisbane` +
    `&models=google_weathernext2_ensemble_mean,ecmwf_ifs025_ensemble_mean,gfs_seamless`;

  const [omResult, bomResult] = await Promise.allSettled([
    fetch(openMeteoUrl, { signal: AbortSignal.timeout(9000) }).then(async (r) => {
      if (!r.ok) throw new Error(`Open-Meteo HTTP ${r.status}`);
      return r.json();
    }),
    fetchBomData(location),
  ]);

  const omData = omResult.status === 'fulfilled' ? omResult.value : null;
  if (omResult.status === 'rejected') {
    errors.push(`Open-Meteo Ensemble: ${omResult.reason?.message || 'Fetch failed'}`);
  }

  const bom =
    bomResult.status === 'fulfilled'
      ? bomResult.value
      : { bomLocation: null, dailyByDate: {}, warnings: [], error: 'BOM fetch failed' };
  if (bom.error) errors.push(bom.error);

  // Map Google Daily by YYYY-MM-DD if provided
  const googleDailyByDate: Record<string, DailyModelMetrics> = {};
  if (Array.isArray(googleDaily)) {
    for (const gd of googleDaily) {
      let key = '';
      if (gd.displayDate?.year && gd.displayDate?.month && gd.displayDate?.day) {
        key = `${gd.displayDate.year}-${String(gd.displayDate.month).padStart(2, '0')}-${String(gd.displayDate.day).padStart(2, '0')}`;
      } else if (gd.interval?.startTime) {
        key = gd.interval.startTime.slice(0, 10);
      }
      if (key) {
        googleDailyByDate[key] = {
          minTemp: typeof gd.minTemperature?.degrees === 'number' ? round1(gd.minTemperature.degrees) : null,
          maxTemp: typeof gd.maxTemperature?.degrees === 'number' ? round1(gd.maxTemperature.degrees) : null,
          rainMm: typeof gd.precipitation?.qpf?.quantity === 'number' ? round1(gd.precipitation.qpf.quantity) : null,
          rainChance: gd.precipitation?.probability?.percent ?? null,
        };
      }
    }
  }

  const hourly = omData?.hourly || {};
  const times: string[] = Array.isArray(hourly.time) ? hourly.time : [];

  // Exact key mapping per Open-Meteo Ensemble API
  const tWn2 = hourly.temperature_2m_google_weathernext2_ensemble_mean;
  const pWn2 = hourly.precipitation_google_weathernext2_ensemble_mean;
  const wWn2 = hourly.wind_speed_10m_google_weathernext2_ensemble_mean;

  const tEcmwf = hourly.temperature_2m_ecmwf_ifs025_ensemble_mean;
  const pEcmwf = hourly.precipitation_ecmwf_ifs025_ensemble_mean;
  const wEcmwf = hourly.wind_speed_10m_ecmwf_ifs025_ensemble_mean;

  // Note: Open-Meteo returns *_ncep_gefs_seamless when requesting gfs_seamless
  const tGfs = hourly.temperature_2m_ncep_gefs_seamless ?? hourly.temperature_2m_gfs_seamless;
  const pGfs = hourly.precipitation_ncep_gefs_seamless ?? hourly.precipitation_gfs_seamless;
  const wGfs = hourly.wind_speed_10m_ncep_gefs_seamless ?? hourly.wind_speed_10m_gfs_seamless;

  const hasWn2 = Array.isArray(tWn2) && tWn2.some((v: unknown) => typeof v === 'number');
  const hasEcmwf = Array.isArray(tEcmwf) && tEcmwf.some((v: unknown) => typeof v === 'number');
  const hasGfs = Array.isArray(tGfs) && tGfs.some((v: unknown) => typeof v === 'number');

  // Determine current Brisbane hour index so 24h 3-hourly view starts near "now"
  const nowBrisKey = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Australia/Brisbane',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(new Date())
    .replace(' ', 'T')
    .slice(0, 13);

  let startHourIdx = times.findIndex((t) => t.slice(0, 13) >= nowBrisKey);
  if (startHourIdx < 0) startHourIdx = 0;

  // Build next-24h 3-hourly comparison (8 buckets x 3h)
  const hourly3h: ThreeHourlyModelRow[] = [];
  for (let b = 0; b < 8; b++) {
    const idx = startHourIdx + b * 3;
    if (idx >= times.length) break;

    const sum3h = (arr: unknown, baseIdx: number): number | null => {
      const sliceVals = finiteNums([
        getArrayVal(arr, baseIdx),
        getArrayVal(arr, baseIdx + 1),
        getArrayVal(arr, baseIdx + 2),
      ]);
      if (sliceVals.length === 0) return null;
      return round1(sliceVals.reduce((acc, v) => acc + v, 0));
    };

    const wn2Sample: ModelMetricsSample = {
      temp: getArrayVal(tWn2, idx),
      precipMm: sum3h(pWn2, idx),
      windKmh: getArrayVal(wWn2, idx),
    };
    const ecmwfSample: ModelMetricsSample = {
      temp: getArrayVal(tEcmwf, idx),
      precipMm: sum3h(pEcmwf, idx),
      windKmh: getArrayVal(wEcmwf, idx),
    };
    const gfsSample: ModelMetricsSample = {
      temp: getArrayVal(tGfs, idx),
      precipMm: sum3h(pGfs, idx),
      windKmh: getArrayVal(wGfs, idx),
    };

    hourly3h.push({
      timeIso: times[idx],
      label: formatBrisbaneHourLabel(times[idx]),
      weatherNext2: wn2Sample,
      ecmwf: ecmwfSample,
      gfs: gfsSample,
      tempSpreadC: safeSpread([wn2Sample.temp, ecmwfSample.temp, gfsSample.temp]),
      rainSpreadMm: safeSpread([wn2Sample.precipMm, ecmwfSample.precipMm, gfsSample.precipMm]),
    });
  }

  // Group hourly arrays into 7 daily buckets
  interface DayAccumulator {
    wn2Temps: number[];
    wn2Rain: number[];
    wn2Wind: number[];
    ecmwfTemps: number[];
    ecmwfRain: number[];
    ecmwfWind: number[];
    gfsTemps: number[];
    gfsRain: number[];
    gfsWind: number[];
  }

  const dayMap: Record<string, DayAccumulator> = {};
  const orderedDates: string[] = [];

  for (let i = 0; i < times.length; i++) {
    const dateKey = times[i].slice(0, 10);
    if (!dayMap[dateKey]) {
      dayMap[dateKey] = {
        wn2Temps: [],
        wn2Rain: [],
        wn2Wind: [],
        ecmwfTemps: [],
        ecmwfRain: [],
        ecmwfWind: [],
        gfsTemps: [],
        gfsRain: [],
        gfsWind: [],
      };
      orderedDates.push(dateKey);
    }
    const acc = dayMap[dateKey];

    const pushSample = (
      tArr: unknown,
      pArr: unknown,
      wArr: unknown,
      tDest: number[],
      pDest: number[],
      wDest: number[]
    ) => {
      const tv = getArrayVal(tArr, i);
      const pv = getArrayVal(pArr, i);
      const wv = getArrayVal(wArr, i);
      if (tv !== null) tDest.push(tv);
      if (pv !== null) pDest.push(pv);
      if (wv !== null) wDest.push(wv);
    };

    pushSample(tWn2, pWn2, wWn2, acc.wn2Temps, acc.wn2Rain, acc.wn2Wind);
    pushSample(tEcmwf, pEcmwf, wEcmwf, acc.ecmwfTemps, acc.ecmwfRain, acc.ecmwfWind);
    pushSample(tGfs, pGfs, wGfs, acc.gfsTemps, acc.gfsRain, acc.gfsWind);
  }

  // Ensure any BOM dates if Open-Meteo returned nothing are still represented
  const allDateKeys = orderedDates.length > 0 ? orderedDates.slice(0, 7) : Object.keys(bom.dailyByDate).sort().slice(0, 7);

  const summarizeDay = (temps: number[], rain: number[], wind: number[]): DailyModelMetrics => ({
    minTemp: temps.length > 0 ? round1(Math.min(...temps)) : null,
    maxTemp: temps.length > 0 ? round1(Math.max(...temps)) : null,
    rainMm: rain.length > 0 ? round1(rain.reduce((a, b) => a + b, 0)) : null,
    maxWindKmh: wind.length > 0 ? round1(Math.max(...wind)) : null,
  });

  const daily7d: DailyComparisonRow[] = allDateKeys.map((dateKey, idx) => {
    const acc = dayMap[dateKey] || {
      wn2Temps: [],
      wn2Rain: [],
      wn2Wind: [],
      ecmwfTemps: [],
      ecmwfRain: [],
      ecmwfWind: [],
      gfsTemps: [],
      gfsRain: [],
      gfsWind: [],
    };

    const weatherNext2 = summarizeDay(acc.wn2Temps, acc.wn2Rain, acc.wn2Wind);
    const ecmwf = summarizeDay(acc.ecmwfTemps, acc.ecmwfRain, acc.ecmwfWind);
    const gfs = summarizeDay(acc.gfsTemps, acc.gfsRain, acc.gfsWind);
    const bomDay = bom.dailyByDate[dateKey] ?? null;
    const googleDay = googleDailyByDate[dateKey] ?? null;

    const maxTemps = [weatherNext2.maxTemp, ecmwf.maxTemp, gfs.maxTemp, bomDay?.maxTemp];
    const minTemps = [weatherNext2.minTemp, ecmwf.minTemp, gfs.minTemp, bomDay?.minTemp];
    const rainVals = [weatherNext2.rainMm, ecmwf.rainMm, gfs.rainMm, bomDay?.rainMm];

    const deltaMaxTemp = safeSpread(maxTemps);
    const deltaMinTemp = safeSpread(minTemps);
    const deltaRainMm = safeSpread(rainVals);

    let agreementLevel: 'HIGH' | 'MODERATE' | 'LOW' = 'HIGH';
    if ((deltaRainMm !== null && deltaRainMm >= 15) || (deltaMaxTemp !== null && deltaMaxTemp >= 3.5)) {
      agreementLevel = 'LOW';
    } else if ((deltaRainMm !== null && deltaRainMm >= 5) || (deltaMaxTemp !== null && deltaMaxTemp >= 1.8)) {
      agreementLevel = 'MODERATE';
    }

    return {
      dateKey,
      dayLabel: formatDayLabel(dateKey, idx),
      weatherNext2,
      ecmwf,
      gfs,
      bom: bomDay,
      googleWeather: googleDay,
      meanMaxTemp: safeMean(maxTemps),
      meanMinTemp: safeMean(minTemps),
      meanRainMm: safeMean(rainVals),
      deltaMaxTemp,
      deltaMinTemp,
      deltaRainMm,
      agreementLevel,
    };
  });

  const tempSpreads = finiteNums(daily7d.map((d) => d.deltaMaxTemp));
  const rainSpreads = finiteNums(daily7d.map((d) => d.deltaRainMm));
  const avgTempSpreadC = tempSpreads.length > 0 ? round1(tempSpreads.reduce((a, b) => a + b, 0) / tempSpreads.length) : null;
  const maxRainSpreadMm = rainSpreads.length > 0 ? round1(Math.max(...rainSpreads)) : null;

  const peak24hRainConsensusMm = safeMean(
    hourly3h.reduce<[number, number, number]>(
      (acc, row) => [
        acc[0] + (row.weatherNext2.precipMm ?? 0),
        acc[1] + (row.ecmwf.precipMm ?? 0),
        acc[2] + (row.gfs.precipMm ?? 0),
      ],
      [0, 0, 0]
    )
  );

  let agreementLabel: 'High Agreement' | 'Moderate Spread' | 'High Divergence' = 'High Agreement';
  let agreementDetail = 'WeatherNext 2, ECMWF, GFS, and BOM align closely across temperature and rain.';
  if ((maxRainSpreadMm !== null && maxRainSpreadMm >= 15) || (avgTempSpreadC !== null && avgTempSpreadC >= 3)) {
    agreementLabel = 'High Divergence';
    agreementDetail = `Significant model spread detected (up to ${maxRainSpreadMm ?? '--'} mm rain Δ and ${avgTempSpreadC ?? '--'}°C avg temp Δ). Monitor BOM warnings closely.`;
  } else if ((maxRainSpreadMm !== null && maxRainSpreadMm >= 5) || (avgTempSpreadC !== null && avgTempSpreadC >= 1.5)) {
    agreementLabel = 'Moderate Spread';
    agreementDetail = `Moderate ensemble variance (${maxRainSpreadMm ?? '--'} mm max rain Δ across 7 days). Localized coastal showers may shift totals.`;
  }

  return {
    location,
    hourly3h,
    daily7d,
    bomLocation: bom.bomLocation,
    bomWarnings: bom.warnings,
    spreadOverview: {
      avgTempSpreadC,
      maxRainSpreadMm,
      peak24hRainConsensusMm,
      agreementLabel,
      agreementDetail,
    },
    sourcesAvailable: {
      weatherNext2: hasWn2,
      ecmwf: hasEcmwf,
      gfs: hasGfs,
      bom: Object.keys(bom.dailyByDate).length > 0,
      googleWeather: Object.keys(googleDailyByDate).length > 0,
    },
    errors,
    lastUpdated: Date.now(),
  };
}

/**
 * Fetch animated radar frames from RainViewer public weather-maps.json
 */
export async function fetchRainViewerFrames(): Promise<RainViewerData | null> {
  try {
    const res = await fetch('https://api.rainviewer.com/public/weather-maps.json', {
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const host: string = data?.host || 'https://tilecache.rainviewer.com';
    const past: RainViewerFrame[] = Array.isArray(data?.radar?.past)
      ? data.radar.past.map((f: any) => ({
          time: Number(f.time),
          path: String(f.path),
          kind: 'past' as const,
        }))
      : [];
    const nowcast: RainViewerFrame[] = Array.isArray(data?.radar?.nowcast)
      ? data.radar.nowcast.map((f: any) => ({
          time: Number(f.time),
          path: String(f.path),
          kind: 'nowcast' as const,
        }))
      : [];

    const frames = [...past, ...nowcast].filter((f) => Number.isFinite(f.time) && !!f.path);
    return {
      host,
      generated: Number(data?.generated || Date.now() / 1000),
      frames,
    };
  } catch (err) {
    console.warn('RainViewer fetch failed:', err);
    return null;
  }
}
