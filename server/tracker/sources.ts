/**
 * Fetchers for the forecast tracker. Every function returns plain daily values keyed by Australia/Brisbane date:
 * temperatures over the calendar day, rain over the 24 h to 9 am on that date (BOM/SILO convention).
 */
import { XMLParser } from 'fast-xml-parser';
import { fetchJson, fetchText } from '../feeds/http';
import type { DailyValues } from './store';

const TZ = 'Australia%2FBrisbane';
/** Leads scored: 1–7 days ahead. Day 0 is partly in the past when the snapshot is taken, so it isn't scored. */
export const MAX_LEAD = 7;

export function brisbaneDate(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Brisbane', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export function addDays(date: string, n: number): string {
  const t = new Date(date + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/**
 * Hourly series (local time, "YYYY-MM-DDTHH:00") → daily values. Rain for date D sums the hours ending
 * 10:00 on D−1 through 09:00 on D; each day needs all 24 hours or it's skipped.
 */
export function hourlyToDaily(times: string[], temp: Array<number | null> | undefined, rain: Array<number | null> | undefined): Record<string, DailyValues> {
  const tBy: Record<string, number[]> = {};
  const rBy: Record<string, number[]> = {};
  for (let i = 0; i < times.length; i++) {
    const day = times[i].slice(0, 10);
    const hour = Number(times[i].slice(11, 13));
    const t = temp?.[i];
    if (typeof t === 'number') (tBy[day] ??= []).push(t);
    const r = rain?.[i];
    if (typeof r === 'number') {
      const rainDay = hour >= 10 ? addDays(day, 1) : day;
      (rBy[rainDay] ??= []).push(r);
    }
  }
  const out: Record<string, DailyValues> = {};
  for (const [day, vals] of Object.entries(tBy)) {
    if (vals.length < 24) continue;
    out[day] = { tmax: round1(Math.max(...vals)), tmin: round1(Math.min(...vals)) };
  }
  for (const [day, vals] of Object.entries(rBy)) {
    if (vals.length < 24) continue;
    (out[day] ??= {}).rain = round1(vals.reduce((a, b) => a + b, 0));
  }
  return out;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

const ENSEMBLE_MODELS = {
  wn2: ['google_weathernext2_ensemble_mean'],
  ecmwf: ['ecmwf_ifs025_ensemble_mean'],
  // Requesting gfs_seamless from the ensemble API returns ncep_gefs_seamless keys.
  gfs: ['ncep_gefs_seamless', 'gfs_seamless'],
} as const;

/** The same ensemble-mean forecasts the app shows (WeatherNext 2, ECMWF, GFS), days 1–7 after today. */
export async function fetchEnsembleForecasts(lat: number, lon: number, today: string) {
  const url =
    'https://ensemble-api.open-meteo.com/v1/ensemble' +
    `?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,precipitation&forecast_days=9&timezone=${TZ}` +
    '&models=google_weathernext2_ensemble_mean,ecmwf_ifs025_ensemble_mean,gfs_seamless';
  const data = await fetchJson<{ hourly?: Record<string, Array<number | null>> & { time?: string[] } }>(url, { label: 'Open-Meteo ensemble', timeoutMs: 20000 });
  const h = data.hourly ?? {};
  const times = (h.time as unknown as string[]) ?? [];
  const out: Partial<Record<keyof typeof ENSEMBLE_MODELS, Record<string, DailyValues>>> = {};
  for (const [src, keys] of Object.entries(ENSEMBLE_MODELS) as Array<[keyof typeof ENSEMBLE_MODELS, readonly string[]]>) {
    const key = keys.find((k) => Array.isArray(h[`temperature_2m_${k}`]));
    if (!key) continue;
    const daily = hourlyToDaily(times, h[`temperature_2m_${key}`], h[`precipitation_${key}`]);
    out[src] = keepLeads(daily, today);
  }
  return out;
}

function keepLeads(daily: Record<string, DailyValues>, today: string): Record<string, DailyValues> {
  const out: Record<string, DailyValues> = {};
  for (let lead = 1; lead <= MAX_LEAD; lead++) {
    const d = addDays(today, lead);
    if (daily[d]) out[d] = daily[d];
  }
  return out;
}

/**
 * Main-run ECMWF and GFS forecasts as they were issued 1–7 days earlier (Open-Meteo "previous runs").
 * Returns entries[issueDate][source][targetDate]; used for the initial backfill and kept up daily.
 */
export async function fetchPreviousRuns(lat: number, lon: number, pastDays: number) {
  const vars = Array.from({ length: MAX_LEAD }, (_, i) => `temperature_2m_previous_day${i + 1},precipitation_previous_day${i + 1}`).join(',');
  const url =
    'https://previous-runs-api.open-meteo.com/v1/forecast' +
    `?latitude=${lat}&longitude=${lon}&hourly=${vars}&models=ecmwf_ifs025,gfs_seamless&past_days=${pastDays}&forecast_days=1&timezone=${TZ}`;
  const data = await fetchJson<{ hourly?: Record<string, Array<number | null>> & { time?: string[] } }>(url, { label: 'Open-Meteo previous runs', timeoutMs: 30000 });
  const h = data.hourly ?? {};
  const times = (h.time as unknown as string[]) ?? [];
  const entries: Record<string, Partial<Record<'ecmwf_det' | 'gfs_det', Record<string, DailyValues>>>> = {};
  for (const [src, model] of [['ecmwf_det', 'ecmwf_ifs025'], ['gfs_det', 'gfs_seamless']] as const) {
    for (let lead = 1; lead <= MAX_LEAD; lead++) {
      const daily = hourlyToDaily(times, h[`temperature_2m_previous_day${lead}_${model}`], h[`precipitation_previous_day${lead}_${model}`]);
      for (const [target, vals] of Object.entries(daily)) {
        const issued = addDays(target, -lead);
        ((entries[issued] ??= {})[src] ??= {})[target] = vals;
      }
    }
  }
  return entries;
}

/** BOM's public Queensland précis forecast (anonymous FTP product IDQ11295), for one town. */
export async function fetchBomPrecis(town: string, today: string): Promise<Record<string, DailyValues>> {
  const xml = await fetchText('https://reg.bom.gov.au/fwo/IDQ11295.xml', { label: 'BOM précis', timeoutMs: 20000 }).catch(() =>
    fetchText('https://www.bom.gov.au/fwo/IDQ11295.xml', { label: 'BOM précis', timeoutMs: 20000 }),
  );
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', textNodeName: '#text' });
  const doc = parser.parse(xml);
  const areas = toArray(doc?.product?.forecast?.area);
  const area = areas.find((a: any) => a?.description === town && a?.type === 'location');
  if (!area) throw new Error(`BOM précis: no forecast for ${town}`);
  const out: Record<string, DailyValues> = {};
  for (const p of toArray(area['forecast-period'])) {
    const date = String(p?.['start-time-local'] ?? '').slice(0, 10);
    if (!date || date <= today || date > addDays(today, MAX_LEAD)) continue;
    const v: DailyValues = {};
    for (const el of toArray(p.element)) {
      const val = typeof el === 'object' ? el['#text'] : el;
      if (el?.type === 'air_temperature_maximum') v.tmax = Number(val);
      if (el?.type === 'air_temperature_minimum') v.tmin = Number(val);
      if (el?.type === 'precipitation_range') {
        const m = String(val).match(/([\d.]+)\s*to\s*([\d.]+)/);
        if (m) {
          v.rainLo = Number(m[1]);
          v.rainHi = Number(m[2]);
        }
      }
    }
    for (const t of toArray(p.text)) {
      if (t?.type === 'probability_of_precipitation') v.pop = Number(String(t['#text']).replace('%', ''));
    }
    if (v.rainLo === undefined && v.pop !== undefined && v.pop <= 5) {
      v.rainLo = 0;
      v.rainHi = 0;
    }
    if (Object.keys(v).length) out[date] = v;
  }
  return out;
}

function toArray<T>(x: T | T[] | undefined): T[] {
  return x === undefined || x === null ? [] : Array.isArray(x) ? x : [x];
}

/**
 * Measured daily values from SILO (Queensland Government) for one BOM station. Only values with SILO
 * quality code 0 (an actual observation) are kept; SILO's interpolated fill-ins are dropped.
 */
export async function fetchSiloObs(stationId: string, start: string, end: string, email: string): Promise<Record<string, DailyValues>> {
  const url =
    'https://www.longpaddock.qld.gov.au/cgi-bin/silo/PatchedPointDataset.php' +
    `?format=csv&station=${stationId}&start=${start.replace(/-/g, '')}&finish=${end.replace(/-/g, '')}` +
    `&username=${encodeURIComponent(email)}&password=apirequest&comment=RXN`;
  const csv = await fetchText(url, { label: 'SILO', secrets: [email, encodeURIComponent(email)], timeoutMs: 30000 });
  const out: Record<string, DailyValues> = {};
  const lines = csv.trim().split('\n');
  if (!/^station,/.test(lines[0] ?? '')) throw new Error('SILO: unexpected response');
  for (const line of lines.slice(1)) {
    const c = line.split(',');
    if (c.length < 8 || !/^\d{4}-\d{2}-\d{2}$/.test(c[1])) continue;
    const v: DailyValues = {};
    if (Number(c[3]) === 0 && c[2].trim() !== '') v.rain = Number(c[2]);
    if (Number(c[5]) === 0 && c[4].trim() !== '') v.tmax = Number(c[4]);
    if (Number(c[7]) === 0 && c[6].trim() !== '') v.tmin = Number(c[6]);
    if (Object.keys(v).length) out[c[1]] = v;
  }
  return out;
}
