/**
 * Forecast-tracker storage: one JSON file per site in `${DATA_DIR}/tracker/`, written atomically
 * (temp file + rename) like the push store. Kept behind a tiny interface so a Cloud Storage backend can
 * replace it without touching the tracker logic.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { TrackerSourceId } from '../../src/types/weather';

/** Daily values for one target date. Rain is the 24 h to 9 am on that date (BOM/SILO convention). */
export interface DailyValues {
  tmax?: number;
  tmin?: number;
  rain?: number;
  /** BOM only: forecast rain range and chance of rain (%). */
  rainLo?: number;
  rainHi?: number;
  pop?: number;
}

export type SourceId = TrackerSourceId;

export interface SiteHistory {
  version: 1;
  /** forecasts[issueDate][source][targetDate] — dates are Australia/Brisbane YYYY-MM-DD. */
  forecasts: Record<string, Partial<Record<SourceId, Record<string, DailyValues>>>>;
  /** Measured station values (SILO quality code 0 only), by date. */
  obs: Record<string, DailyValues>;
  meta: { backfilledAt?: string; lastSnapshot?: string; lastObsFetch?: string; lastDetFetch?: string };
}

export interface TrackerStore {
  load(siteId: string): SiteHistory;
  save(siteId: string, data: SiteHistory): void;
}

export function emptyHistory(): SiteHistory {
  return { version: 1, forecasts: {}, obs: {}, meta: {} };
}

export class FileTrackerStore implements TrackerStore {
  constructor(private readonly dir = path.join(process.env.DATA_DIR || './data', 'tracker')) {}

  private file(siteId: string) {
    return path.join(this.dir, `${siteId.replace(/[^a-z0-9-]/gi, '')}.json`);
  }

  load(siteId: string): SiteHistory {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file(siteId), 'utf-8')) as SiteHistory;
      if (parsed?.version === 1 && parsed.forecasts && parsed.obs) return { ...emptyHistory(), ...parsed };
    } catch {
      // Missing or unreadable: start fresh.
    }
    return emptyHistory();
  }

  save(siteId: string, data: SiteHistory): void {
    fs.mkdirSync(this.dir, { recursive: true });
    const fp = this.file(siteId);
    const tmp = `${fp}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, fp);
  }
}
