/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Multi-model consensus: a best estimate per day (median of the chosen models, each corrected for its measured
 * local bias where the forecast tracker has enough history) and a confidence level from how far apart the
 * corrected forecasts are. Pure functions; see hooks/useConsensus.ts for the wiring.
 */
import type {
  DailyComparisonRow,
  DailyModelMetrics,
  TrackerSiteSummary,
  TrackerSourceId,
  TrackerSummaryResponse,
} from '../types/weather';

export type ConsensusModel = 'bom' | 'wn2' | 'ecmwf' | 'gfs';

export const CONSENSUS_MODELS: Array<{ id: ConsensusModel; short: string; label: string }> = [
  { id: 'bom', short: 'BOM', label: 'BOM official' },
  { id: 'wn2', short: 'WN2', label: 'WeatherNext 2' },
  { id: 'ecmwf', short: 'ECMWF', label: 'ECMWF' },
  { id: 'gfs', short: 'GFS', label: 'GFS' },
];

export function rowModel(row: DailyComparisonRow, id: ConsensusModel): DailyModelMetrics | null {
  if (id === 'bom') return row.bom;
  if (id === 'wn2') return row.weatherNext2;
  return row[id];
}

// --- Rain categories -------------------------------------------------------------------------------------

export type RainCategory = 'dry' | 'showers' | 'wet' | 'heavy';
const RAIN_ORDER: RainCategory[] = ['dry', 'showers', 'wet', 'heavy'];
export const RAIN_LABEL: Record<RainCategory, string> = { dry: 'dry', showers: 'showers', wet: 'wet', heavy: 'heavy rain' };

/** Daily rain → category: dry < 1 mm, showers 1–10, wet 10–25, heavy ≥ 25. */
export function rainCategory(mm: number): RainCategory {
  return mm < 1 ? 'dry' : mm < 10 ? 'showers' : mm < 25 ? 'wet' : 'heavy';
}

// --- Local bias corrections from the forecast tracker ---------------------------------------------------

/** Within this distance of a tracked station, its measured biases are applied. */
const SITE_RADIUS_KM = 20;
/** Days of overlap needed before a bias is trusted. */
export const MIN_BIAS_DAYS = 10;

export function nearestTrackedSite(summary: TrackerSummaryResponse | null, lat: number, lng: number): TrackerSiteSummary | null {
  if (!summary) return null;
  let best: { site: TrackerSiteSummary; km: number } | null = null;
  for (const site of summary.sites) {
    if (!site.station || site.obsDays === 0) continue;
    const { lat: sLat, lon: sLon } = site.station;
    const km = Math.hypot(sLat - lat, (sLon - lng) * Math.cos((lat * Math.PI) / 180)) * 111.2;
    if (km <= SITE_RADIUS_KM && (!best || km < best.km)) best = { site, km };
  }
  return best?.site ?? null;
}

export interface BiasCorrection {
  /** Forecast − observed, °C; corrected = forecast − bias. */
  tmax: number | null;
  tmin: number | null;
  days: number;
  /** Tracker source the bias came from (the model's own record, or its main run while that builds up). */
  from: TrackerSourceId;
}

/** For each model, corrections by lead day (index 1–7; index 0 unused). */
export type Corrections = Record<ConsensusModel, Array<BiasCorrection | null>>;

/**
 * While a model's own record builds up, borrow its main run's bias only where that's been shown to match:
 * ECMWF's averaged and main runs share a grid and run equally cold at Ayr. GFS's averaged forecast (GEFS) runs
 * much colder than its main run there, so it waits for its own record.
 */
const FALLBACK: Partial<Record<ConsensusModel, TrackerSourceId>> = { ecmwf: 'ecmwf_det' };

export function correctionsFor(site: TrackerSiteSummary | null): Corrections | null {
  if (!site) return null;
  const pick = (id: TrackerSourceId, lead: number): BiasCorrection | null => {
    const l = site.sources.find((s) => s.id === id)?.leads.find((x) => x.lead === lead);
    const tmax = l?.tmax && l.tmax.n >= MIN_BIAS_DAYS ? l.tmax : null;
    const tmin = l?.tmin && l.tmin.n >= MIN_BIAS_DAYS ? l.tmin : null;
    if (!tmax && !tmin) return null;
    return { tmax: tmax?.bias ?? null, tmin: tmin?.bias ?? null, days: Math.max(tmax?.n ?? 0, tmin?.n ?? 0), from: id };
  };
  const out = {} as Corrections;
  for (const { id } of CONSENSUS_MODELS) {
    out[id] = [null];
    for (let lead = 1; lead <= 7; lead++) {
      const own = pick(id, lead);
      const fb = FALLBACK[id];
      out[id].push(own ?? (fb ? pick(fb, lead) : null));
    }
  }
  return out;
}

// --- Daily estimate + confidence -------------------------------------------------------------------------

export type Confidence = 'high' | 'moderate' | 'low';
export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: 'High Agreement',
  moderate: 'Moderate Spread',
  low: 'High Divergence',
};

export interface DayEstimate {
  dateKey: string;
  dayLabel: string;
  tmax: number | null;
  tmin: number | null;
  rain: number | null;
  /** Chosen models that had data for this day. */
  contributors: ConsensusModel[];
  /** Models whose temperatures went into the estimate (see estimateDay). */
  tempContributors: ConsensusModel[];
  /** Chosen models left out of the temperature estimate until their local bias is known. */
  calibrating: ConsensusModel[];
  /** True if any contributor's temperatures were bias-corrected. */
  corrected: boolean;
  /** Corrected max-temperature range across contributors. */
  tmaxRange: [number, number] | null;
  rainRange: [number, number] | null;
  rainCategories: RainCategory[];
  confidence: Confidence | null;
  /** Short reason for anything below high agreement, e.g. "rain 3–22 mm". */
  reason: string;
}

function median(vals: number[]): number | null {
  if (!vals.length) return null;
  const s = [...vals].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function estimateDay(
  row: DailyComparisonRow,
  dayIndex: number,
  selected: ConsensusModel[],
  corrections: Corrections | null,
): DayEstimate {
  const lead = Math.min(7, Math.max(1, dayIndex));
  const rains: number[] = [];
  const contributors: ConsensusModel[] = [];
  type Temp = { id: ConsensusModel; tmax: number | null; tmin: number | null; trusted: boolean; corrected: boolean };
  const temps: Temp[] = [];
  for (const id of selected) {
    const m = rowModel(row, id);
    if (!m) continue;
    const c = corrections?.[id]?.[lead] ?? null;
    let used = false;
    if (isNum(m.maxTemp) || isNum(m.minTemp)) {
      const cmax = isNum(c?.tmax) ? c!.tmax! : null;
      const cmin = isNum(c?.tmin) ? c!.tmin! : null;
      temps.push({
        id,
        tmax: isNum(m.maxTemp) ? m.maxTemp - (cmax ?? 0) : null,
        tmin: isNum(m.minTemp) ? m.minTemp - (cmin ?? 0) : null,
        // BOM forecasts for the town itself, so it has no grid-square bias to remove.
        trusted: id === 'bom' || cmax !== null || cmin !== null,
        corrected: cmax !== null || cmin !== null,
      });
      used = true;
    }
    if (isNum(m.rainMm)) {
      rains.push(m.rainMm);
      used = true;
    }
    if (used) contributors.push(id);
  }
  // At a tracked town, uncorrected model temperatures are typically degrees off (town vs grid), which would both
  // drag the estimate and fake a disagreement. Use BOM + corrected models when at least two are available.
  const trusted = temps.filter((t) => t.trusted);
  const useTrusted = !!corrections && trusted.length >= 2;
  const tempSet = useTrusted ? trusted : temps;
  const tmaxs = tempSet.map((t) => t.tmax).filter(isNum);
  const tmins = tempSet.map((t) => t.tmin).filter(isNum);
  const corrected = tempSet.some((t) => t.corrected);

  const tmaxRange: [number, number] | null = tmaxs.length ? [Math.min(...tmaxs), Math.max(...tmaxs)] : null;
  const rainRange: [number, number] | null = rains.length ? [Math.min(...rains), Math.max(...rains)] : null;
  const cats = RAIN_ORDER.filter((c) => rains.some((r) => rainCategory(r) === c));

  let confidence: Confidence | null = null;
  const reasons: string[] = [];
  if (contributors.length >= 2) {
    const tSpread = tmaxRange && tmaxs.length >= 2 ? tmaxRange[1] - tmaxRange[0] : 0;
    const tLevel: Confidence = tSpread <= 1.5 ? 'high' : tSpread <= 3 ? 'moderate' : 'low';
    const span = cats.length ? RAIN_ORDER.indexOf(cats[cats.length - 1]) - RAIN_ORDER.indexOf(cats[0]) : 0;
    const rLevel: Confidence = rains.length < 2 || span === 0 ? 'high' : span === 1 ? 'moderate' : 'low';
    const rank = { high: 0, moderate: 1, low: 2 } as const;
    confidence = rank[tLevel] >= rank[rLevel] ? tLevel : rLevel;
    if (rLevel !== 'high' && rainRange) reasons.push(`rain ${fmt(rainRange[0])}–${fmt(rainRange[1])} mm`);
    if (tLevel !== 'high' && tmaxRange) reasons.push(`max ${Math.round(tmaxRange[0])}–${Math.round(tmaxRange[1])}°`);
  }

  return {
    dateKey: row.dateKey,
    dayLabel: row.dayLabel,
    tmax: median(tmaxs),
    tmin: median(tmins),
    rain: median(rains),
    contributors,
    tempContributors: tempSet.map((t) => t.id),
    calibrating: useTrusted ? temps.filter((t) => !t.trusted).map((t) => t.id) : [],
    corrected,
    tmaxRange,
    rainRange,
    rainCategories: cats,
    confidence,
    reason: reasons.join(', '),
  };
}

function fmt(mm: number): string {
  return mm < 10 ? (Math.round(mm * 10) / 10).toString() : Math.round(mm).toString();
}

/** "Today", "Tomorrow", "Sat 29 Nov" → "today", "tomorrow", "Sat". */
function shortDay(label: string): string {
  if (label === 'Today' || label === 'Tomorrow') return label.toLowerCase();
  return label.split(/[\s,]/)[0];
}

/** One line for the week, e.g. "Confident through Thu · Uncertain Sat (rain 3–22 mm)". */
export function outlookSummary(days: DayEstimate[]): string {
  const rated = days.filter((d) => d.confidence);
  if (!rated.length) return 'Not enough models to compare';
  if (rated.every((d) => d.confidence === 'high')) return 'Models agree all week';
  const parts: string[] = [];
  let run = 0;
  while (run < rated.length && rated[run].confidence !== 'low') run++;
  if (run === rated.length) parts.push('No big disagreements this week');
  else if (run > 0) parts.push(`Confident through ${shortDay(rated[run - 1].dayLabel)}`);
  const low = rated.filter((d) => d.confidence === 'low').slice(0, 2);
  for (const d of low) parts.push(`Uncertain ${shortDay(d.dayLabel)}${d.reason ? ` (${d.reason})` : ''}`);
  return parts.join(' · ');
}
