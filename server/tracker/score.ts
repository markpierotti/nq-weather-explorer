/**
 * Forecast-vs-observation scores per site, source and lead day.
 *
 * Temperature: mean error (bias: + runs hot) and mean absolute error, raw and after removing the bias.
 * Rain: wet/dry calls with a 1 mm threshold. Models call "wet" at ≥ 1 mm forecast; BOM at ≥ 50% chance of rain.
 */
import type { TrackerLeadScore, TrackerTempScore } from '../../src/types/weather';
import type { DailyValues, SiteHistory, SourceId } from './store';
import { addDays, MAX_LEAD } from './sources';

const WET_MM = 1;

function temp(pairs: Array<[number, number]>): TrackerTempScore | null {
  if (pairs.length < 3) return null;
  const err = pairs.map(([f, o]) => f - o);
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const bias = mean(err);
  return {
    n: pairs.length,
    bias: round1(bias),
    mae: round1(mean(err.map(Math.abs))),
    maeCorrected: round1(mean(err.map((e) => Math.abs(e - bias)))),
  };
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function forecastWet(source: SourceId, v: DailyValues): boolean | null {
  if (source === 'bom') return typeof v.pop === 'number' ? v.pop >= 50 : null;
  return typeof v.rain === 'number' ? v.rain >= WET_MM : null;
}

export function scoreSource(history: SiteHistory, source: SourceId, fromDate: string): TrackerLeadScore[] {
  const out: TrackerLeadScore[] = [];
  for (let lead = 1; lead <= MAX_LEAD; lead++) {
    const tmax: Array<[number, number]> = [];
    const tmin: Array<[number, number]> = [];
    let hits = 0;
    let misses = 0;
    let falseAlarms = 0;
    let correctDry = 0;
    for (const [date, ob] of Object.entries(history.obs)) {
      if (date < fromDate) continue;
      const fc = history.forecasts[addDays(date, -lead)]?.[source]?.[date];
      if (!fc) continue;
      if (typeof fc.tmax === 'number' && typeof ob.tmax === 'number') tmax.push([fc.tmax, ob.tmax]);
      if (typeof fc.tmin === 'number' && typeof ob.tmin === 'number') tmin.push([fc.tmin, ob.tmin]);
      const wet = forecastWet(source, fc);
      if (wet !== null && typeof ob.rain === 'number') {
        const obsWet = ob.rain >= WET_MM;
        if (wet && obsWet) hits++;
        else if (obsWet) misses++;
        else if (wet) falseAlarms++;
        else correctDry++;
      }
    }
    const n = hits + misses + falseAlarms + correctDry;
    out.push({
      lead,
      tmax: temp(tmax),
      tmin: temp(tmin),
      rain:
        n >= 3
          ? { n, wetObserved: hits + misses, hits, misses, falseAlarms, correctPct: Math.round((100 * (hits + correctDry)) / n) }
          : null,
    });
  }
  return out;
}
