/**
 * Forecast tracker: logs what each source forecast for a few NQ places, records what the nearest BOM station
 * measured, and scores them against each other (bias, error, wet/dry calls) by lead day.
 *
 * Runs inside the server: a check every hour does whatever is due (a forecast snapshot once a day after 5 am
 * Brisbane time, main-run model history and SILO observations a few times a day). On a host that sleeps between
 * requests (e.g. Cloud Run), set TRACKER_SCHEDULER=off and call POST /api/tracker/run from a scheduler instead
 * (authenticated with SCHEDULER_TOKEN, see server/schedulerAuth.ts).
 *
 * Request budget per run, per site: 1 Open-Meteo ensemble + 1 previous-runs call, 1 BOM précis XML (shared),
 * 1 SILO call. About 4 sites × 4 calls a day.
 *
 * Env: SILO_EMAIL (server-only; SILO's API key is an email address), SCHEDULER_TOKEN, TRACKER_SCHEDULER.
 */
import type { Express } from 'express';
import type { TrackerSiteSummary, TrackerSummaryResponse } from '../../src/types/weather';
import { redactSecrets } from '../feeds/http';
import { inProcessSchedulerEnabled, schedulerTokenOk } from '../schedulerAuth';
import { scoreSource } from './score';
import { TRACKED_SITES } from './sites';
import { addDays, brisbaneDate, fetchBomPrecis, fetchEnsembleForecasts, fetchPreviousRuns, fetchSiloObs } from './sources';
import { FileTrackerStore, type SiteHistory, type SourceId, type TrackerStore } from './store';

const SOURCE_LABELS: Record<SourceId, string> = {
  bom: 'BOM official',
  wn2: 'WeatherNext 2',
  ecmwf: 'ECMWF',
  gfs: 'GFS',
  ecmwf_det: 'ECMWF main run',
  gfs_det: 'GFS main run',
};
const SOURCE_ORDER: SourceId[] = ['bom', 'wn2', 'ecmwf', 'gfs', 'ecmwf_det', 'gfs_det'];

const BACKFILL_DAYS = 60;
const SNAPSHOT_HOUR = 5; // BOM's morning précis is out by ~4:30 am
const DET_REFRESH_MS = 20 * 3600_000;
const OBS_REFRESH_MS = 6 * 3600_000;
const FORECAST_KEEP_DAYS = 400;
const OBS_KEEP_DAYS = 400;

function siloEmail(): string {
  return (process.env.SILO_EMAIL || '').trim();
}

function brisbaneHour(d = new Date()): number {
  return Number(new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Brisbane', hour: '2-digit', hour12: false }).format(d)) % 24;
}

function olderThan(iso: string | undefined, ms: number): boolean {
  return !iso || Date.now() - Date.parse(iso) > ms;
}

export interface TrackerRunReport {
  at: string;
  sites: Record<string, Record<string, string>>;
}

let running: Promise<TrackerRunReport> | null = null;
let summaryCache: { key: string; at: number; data: TrackerSummaryResponse } | null = null;

/** Do whatever is due for every site. Concurrent calls share one run. */
export function runTracker(store: TrackerStore, force = false): Promise<TrackerRunReport> {
  if (!running) {
    running = doRun(store, force).finally(() => {
      running = null;
      summaryCache = null;
    });
  }
  return running;
}

async function doRun(store: TrackerStore, force: boolean): Promise<TrackerRunReport> {
  const today = brisbaneDate();
  const email = siloEmail();
  const report: TrackerRunReport = { at: new Date().toISOString(), sites: {} };
  const bomCache = new Map<string, ReturnType<typeof fetchBomPrecis>>();
  const bomFor = (town: string) => {
    if (!bomCache.has(town)) bomCache.set(town, fetchBomPrecis(town, today));
    return bomCache.get(town)!;
  };

  for (const site of TRACKED_SITES) {
    const h = store.load(site.id);
    const steps: Record<string, string> = {};
    const step = async (name: string, due: boolean, fn: () => Promise<void>) => {
      if (!due) {
        steps[name] = 'not due';
        return;
      }
      try {
        await fn();
        steps[name] = 'ok';
      } catch (err) {
        steps[name] = redactSecrets(err instanceof Error ? err.message : String(err), [email]).slice(0, 200);
      }
    };

    await step('snapshot', force || (h.meta.lastSnapshot !== today && brisbaneHour() >= SNAPSHOT_HOUR), async () => {
      const entry = (h.forecasts[today] ??= {});
      const ens = await fetchEnsembleForecasts(site.lat, site.lon, today);
      Object.assign(entry, ens);
      if (site.bomTown) {
        try {
          entry.bom = await bomFor(site.bomTown);
        } catch (err) {
          steps.bom = err instanceof Error ? err.message : String(err);
        }
      }
      h.meta.lastSnapshot = today;
    });

    await step('mainRuns', force || olderThan(h.meta.lastDetFetch, DET_REFRESH_MS), async () => {
      const pastDays = h.meta.backfilledAt ? 10 : BACKFILL_DAYS;
      const entries = await fetchPreviousRuns(site.lat, site.lon, pastDays);
      for (const [issued, bySource] of Object.entries(entries)) Object.assign((h.forecasts[issued] ??= {}), bySource);
      h.meta.lastDetFetch = new Date().toISOString();
      h.meta.backfilledAt ??= h.meta.lastDetFetch;
    });

    await step('observations', !!site.station && !!email && (force || olderThan(h.meta.lastObsFetch, OBS_REFRESH_MS)), async () => {
      const hasHistory = Object.keys(h.obs).length > 0;
      const start = addDays(today, hasHistory ? -14 : -(BACKFILL_DAYS + 8));
      const obs = await fetchSiloObs(site.station!.id, start, addDays(today, -1), email);
      Object.assign(h.obs, obs);
      h.meta.lastObsFetch = new Date().toISOString();
    });
    if (site.station && !email) steps.observations = 'SILO_EMAIL not set';

    prune(h, today);
    store.save(site.id, h);
    report.sites[site.id] = steps;
  }
  return report;
}

function prune(h: SiteHistory, today: string) {
  const fcCut = addDays(today, -FORECAST_KEEP_DAYS);
  const obCut = addDays(today, -OBS_KEEP_DAYS);
  for (const d of Object.keys(h.forecasts)) if (d < fcCut) delete h.forecasts[d];
  for (const d of Object.keys(h.obs)) if (d < obCut) delete h.obs[d];
}

export function buildSummary(store: TrackerStore, windowDays: number): TrackerSummaryResponse {
  const key = String(windowDays);
  if (summaryCache && summaryCache.key === key && Date.now() - summaryCache.at < 10 * 60_000) return summaryCache.data;
  const today = brisbaneDate();
  const from = addDays(today, -windowDays);
  const sites: TrackerSiteSummary[] = TRACKED_SITES.map((site) => {
    const h = store.load(site.id);
    const obsDates = Object.keys(h.obs).filter((d) => d >= from).sort();
    const logged = Object.keys(h.forecasts).filter((d) => h.forecasts[d].wn2 || h.forecasts[d].bom).sort();
    const sources = SOURCE_ORDER.filter((s) => s !== 'bom' || site.bomTown).map((id) => ({
      id,
      label: id === 'bom' && site.bomTown && site.bomTown !== site.label ? `BOM official (${site.bomTown} forecast)` : SOURCE_LABELS[id],
      leads: site.station ? scoreSource(h, id, from) : [],
    }));
    return {
      id: site.id,
      label: site.label,
      station: site.station ? { id: site.station.id, name: site.station.name, lat: site.station.lat, lon: site.station.lon } : null,
      bomTown: site.bomTown,
      obsDays: obsDates.length,
      firstObs: obsDates[0] ?? null,
      lastObs: obsDates[obsDates.length - 1] ?? null,
      loggingSince: logged[0] ?? null,
      sources,
    };
  });
  const data: TrackerSummaryResponse = {
    generatedAt: new Date().toISOString(),
    windowDays,
    observationsEnabled: !!siloEmail(),
    sites,
  };
  summaryCache = { key, at: Date.now(), data };
  return data;
}

export function registerTrackerRoutes(app: Express, store: TrackerStore = new FileTrackerStore()) {
  app.get('/api/tracker/summary', (req, res) => {
    const days = Math.min(365, Math.max(14, Number.parseInt(String(req.query.days ?? '60'), 10) || 60));
    try {
      res.set('Cache-Control', 'public, max-age=600');
      res.json(buildSummary(store, days));
    } catch (err) {
      res.status(500).json({ error: 'Tracker summary failed' });
      console.warn('Tracker summary failed:', err instanceof Error ? err.message : err);
    }
  });

  // For an external scheduler (e.g. Cloud Scheduler). Disabled unless SCHEDULER_TOKEN (16+ chars) is set.
  app.post('/api/tracker/run', async (req, res) => {
    if (!schedulerTokenOk(req)) return res.status(404).json({ error: 'Not found' });
    const report = await runTracker(store, req.query.force === '1');
    res.json(report);
  });
}

/** Hourly in-process scheduler (default). TRACKER_SCHEDULER=off disables it. */
export function startTrackerScheduler(store: TrackerStore = new FileTrackerStore()) {
  if (!inProcessSchedulerEnabled('TRACKER_SCHEDULER')) return;
  const tick = () =>
    runTracker(store)
      .then((r) => {
        const did = Object.entries(r.sites)
          .map(([id, s]) => `${id}: ${Object.entries(s).filter(([, v]) => v !== 'not due').map(([k, v]) => `${k} ${v}`).join(', ') || 'nothing due'}`)
          .join(' | ');
        console.log(`[tracker] ${did}`);
      })
      .catch((err) => console.warn('[tracker] run failed:', err instanceof Error ? err.message : err));
  setTimeout(tick, 20_000).unref?.();
  setInterval(tick, 3600_000).unref?.();
}
