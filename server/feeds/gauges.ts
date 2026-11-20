/**
 * River heights for the Burdekin, Haughton, Ross/Bohle and Black River catchments -> EmergencyFeatureItem[].
 *
 * Sources (BOM, public, no key; identifying UA required):
 *  - Summary bulletin "Latest River Heights for the QLD Pioneer; Proserpine; Don; Burdekin; Haughton;
 *    Ross; Bohle Rivers / Black R/Bluewater Ck" (IDQ60290), linked from
 *    https://www.bom.gov.au/qld/flood/rain_river.shtml :
 *      https://reg.bom.gov.au/fwo/IDQ60290.html
 *    Gives latest height, BOM tendency, flood classification, and the per-station table link.
 *  - Per-station table, e.g. https://reg.bom.gov.au/fwo/IDQ65393/IDQ65393.533051.tbl.shtml :
 *    previous 7 days of readings (AEST, dd/mm/yyyy HH:MM) and the station's official
 *    "Flood Classification Levels: Minor / Moderate / Major" — thresholds are parsed live, not hard-coded.
 *  BOM does not publish these as JSON/XML, so both pages are parsed from HTML (fragile if BOM
 *  restyles; failures surface as feed errors).
 *
 * Station coordinates are not on the BOM pages. They are hard-coded from the matching site in BOM
 * Water Data Online (KiWIS getStationList, owner station numbers in comments):
 *   https://www.bom.gov.au/waterdata/services?service=kisters&type=queryServices&request=getStationList&datasource=0&format=json&returnfields=station_name,station_no,station_latitude,station_longitude&bbox=145.5,-20.6,147.7,-19.0
 */
import type { EmergencyFeatureItem, FloodClass, RiverGaugeReading } from '../../src/types/weather';
import { fetchText, mapLimit } from './http';

const SUMMARY_URL = 'https://reg.bom.gov.au/fwo/IDQ60290.html';
const BOM_BASE = 'https://reg.bom.gov.au';
const TREND_THRESHOLD_M = 0.05;
const HISTORY_WINDOW_MS = 24 * 3600 * 1000;
const HISTORY_MAX_POINTS = 48;

interface StationDef {
  bomId: string; // BOM flood-warning station number (as in the IDQ60290 table links)
  river: string;
  lat: number;
  lng: number;
  corridorTags: string[];
}

/** Curated key gauges. Coordinates: Water Data Online site in the trailing comment. */
const STATIONS: StationDef[] = [
  // Burdekin
  { bomId: '033288', river: 'Burdekin River', lat: -19.64206, lng: 147.39694, corridorTags: ['Burdekin', 'Bruce Hwy', 'Ayr', 'Home Hill'] }, // Inkerman Bridge ~ 120001A Burdekin_R Home Hill
  { bomId: '033286', river: 'Burdekin River', lat: -19.75856, lng: 147.24362, corridorTags: ['Burdekin'] }, // Clare ~ 120006B Burdekin_R Clare B
  { bomId: '033287', river: 'Burdekin River', lat: -20.11345, lng: 147.27277, corridorTags: ['Burdekin'] }, // Millaroo ~ 120009A
  { bomId: '033291', river: 'Burdekin River', lat: -20.29739, lng: 147.30185, corridorTags: ['Burdekin'] }, // Dalbeg ~ 120008B
  { bomId: '533075', river: 'Burdekin River', lat: -20.00678, lng: 146.43417, corridorTags: ['Burdekin'] }, // Sellheim ~ 120002A
  // Haughton
  { bomId: '533051', river: 'Haughton River', lat: -19.510482, lng: 147.112145, corridorTags: ['Haughton', 'Giru', 'Bruce Hwy'] }, // Giru ~ 119007A Giru Weir
  { bomId: '533056', river: 'Haughton River', lat: -19.63313611, lng: 147.11027778, corridorTags: ['Haughton'] }, // Powerline ~ 119003A
  { bomId: '533160', river: 'Haughton River', lat: -19.562898, lng: 147.095823, corridorTags: ['Haughton'] }, // Val Bird Weir ~ 119008A
  { bomId: '533072', river: 'Major Creek', lat: -19.66886667, lng: 147.02481667, corridorTags: ['Haughton'] }, // ~ 119006A Major_Rocky W'Hole
  { bomId: '533116', river: 'Barratta Creek', lat: -19.57128, lng: 147.22438, corridorTags: ['Haughton', 'Bruce Hwy'] }, // East Barrattas ~ 119102A
  // Ross / Bohle / Alligator Ck
  { bomId: '532020', river: 'Ross River', lat: -19.41166667, lng: 146.73527778, corridorTags: ['Ross River', 'Townsville'] }, // Ross River Dam ~ 118104A
  { bomId: '532030', river: 'Ross River', lat: -19.31706, lng: 146.73554, corridorTags: ['Ross River', 'Townsville'] }, // Black Weir ~ 118102A Blacks Weir
  { bomId: '532029', river: 'Ross River', lat: -19.30895, lng: 146.7735, corridorTags: ['Ross River', 'Townsville'] }, // Aplin Weir ~ 118103A
  { bomId: '532034', river: 'Alligator Creek', lat: -19.38660556, lng: 146.95793889, corridorTags: ['Alligator Creek', 'Bruce Hwy'] }, // ~ 118106A Alligator Allendale (approx.)
  { bomId: '532053', river: 'Bohle River', lat: -19.26678, lng: 146.70416, corridorTags: ['Townsville'] }, // Mt Bohle ~ 118001B
  // Black River / Bluewater
  { bomId: '532046', river: 'Black River', lat: -19.23771042, lng: 146.63286561, corridorTags: [] }, // ~ 117002A Black_R Bruce Hwy
  { bomId: '532048', river: 'Bluewater Creek', lat: -19.18330833, lng: 146.54693611, corridorTags: [] }, // ~ 117003A Bluewater
];

// --- Parsing helpers ---------------------------------------------------------
function cellText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

interface SummaryRow {
  name: string;
  heightM: number | null;
  tendency: string;
  classification: string;
  tablePath: string;
}

/** Parse IDQ60290 rows keyed by BOM station number. */
function parseSummary(html: string): Map<string, SummaryRow> {
  const rows = new Map<string, SummaryRow>();
  for (const chunk of html.split(/<tr[\s>]/i).slice(1)) {
    const link = chunk.match(/href="(\/fwo\/IDQ\d+\/IDQ\d+\.(\d+)\.tbl\.shtml)"/i);
    if (!link) continue;
    const cells = [...chunk.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => cellText(m[1]));
    if (cells.length < 8) continue;
    const h = parseFloat(cells[3]);
    rows.set(link[2], {
      name: cells[0],
      heightM: Number.isFinite(h) ? h : null,
      tendency: cells[5].toLowerCase(),
      classification: cells[7],
      tablePath: link[1],
    });
  }
  return rows;
}

interface StationTable {
  thresholds: RiverGaugeReading['thresholds'];
  readings: Array<{ t: number; h: number }>; // oldest -> newest
}

function parseLevel(html: string, label: string): number | null {
  const m = html.match(new RegExp(`${label}:\\s*(?:</b>)?\\s*(-?\\d+(?:\\.\\d+)?)\\s*m`, 'i'));
  return m ? parseFloat(m[1]) : null;
}

/** BOM QLD tables are in AEST (UTC+10, no daylight saving). */
function parseAest(d: string): number | null {
  const m = d.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
  if (!m) return null;
  return Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4] - 10, +m[5]);
}

function parseStationTable(html: string): StationTable {
  const thresholds = {
    minor: parseLevel(html, 'Minor'),
    moderate: parseLevel(html, 'Moderate'),
    major: parseLevel(html, 'Major'),
  };
  const readings: Array<{ t: number; h: number }> = [];
  for (const m of html.matchAll(/<tr><td[^>]*>([^<]+)<\/td><td[^>]*>\s*(-?\d+(?:\.\d+)?)\s*<\/td><\/tr>/gi)) {
    const t = parseAest(m[1]);
    const h = parseFloat(m[2]);
    if (t !== null && Number.isFinite(h)) readings.push({ t, h });
  }
  readings.sort((a, b) => a.t - b.t);
  return { thresholds, readings };
}

// --- Derived values ----------------------------------------------------------
function computeTrend(readings: Array<{ t: number; h: number }>, fallback: string): RiverGaugeReading['trend'] {
  if (readings.length >= 2) {
    const last = readings[readings.length - 1];
    // Compare against the reading closest to 1 h earlier (or the oldest of the last 4 readings).
    const hourAgo = last.t - 3600 * 1000;
    let ref = readings[Math.max(0, readings.length - 4)];
    for (let i = readings.length - 2; i >= 0; i--) {
      if (readings[i].t <= hourAgo) {
        ref = readings[i];
        break;
      }
    }
    const delta = last.h - ref.h;
    if (delta > TREND_THRESHOLD_M) return 'rising';
    if (delta < -TREND_THRESHOLD_M) return 'falling';
    return 'steady';
  }
  if (fallback === 'rising' || fallback === 'falling' || fallback === 'steady') return fallback;
  return 'unknown';
}

function classify(height: number | null, th: RiverGaugeReading['thresholds'], bomText: string): FloodClass {
  if (height !== null && (th.minor !== null || th.moderate !== null || th.major !== null)) {
    if (th.major !== null && height >= th.major) return 'major';
    if (th.moderate !== null && height >= th.moderate) return 'moderate';
    if (th.minor !== null && height >= th.minor) return 'minor';
    return 'below_minor';
  }
  const t = bomText.toLowerCase();
  if (t.includes('major')) return 'major';
  if (t.includes('moderate')) return 'moderate';
  if (t.includes('minor')) return 'minor';
  if (t.includes('below')) return 'below_minor';
  return 'unknown';
}

const SEVERITY: Record<FloodClass, EmergencyFeatureItem['severity']> = {
  major: 'critical',
  moderate: 'high',
  minor: 'moderate',
  below_minor: 'info',
  unknown: 'info',
};

function downsample<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const out: T[] = [];
  const step = (arr.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(arr[Math.round(i * step)]);
  return out;
}

const CLASS_LABEL: Record<FloodClass, string> = {
  major: 'Major flood',
  moderate: 'Moderate flood',
  minor: 'Minor flood',
  below_minor: 'Below minor',
  unknown: 'No classification',
};

/** Fetch latest river heights for the curated NQ gauges. Throws if the summary bulletin fails. */
export async function fetchRiverGauges(): Promise<EmergencyFeatureItem[]> {
  const summaryHtml = await fetchText(SUMMARY_URL, { label: 'BOM IDQ60290 river heights', accept: 'text/html' });
  const summary = parseSummary(summaryHtml);

  const results = await mapLimit(STATIONS, 4, async (st): Promise<EmergencyFeatureItem | null> => {
    const row = summary.get(st.bomId);
    if (!row) return null; // station dropped from the bulletin
    let table: StationTable = { thresholds: { minor: null, moderate: null, major: null }, readings: [] };
    try {
      table = parseStationTable(
        await fetchText(BOM_BASE + row.tablePath, { label: `BOM station ${st.bomId} table`, accept: 'text/html' }),
      );
    } catch {
      /* keep summary-only values */
    }

    const last = table.readings[table.readings.length - 1];
    const heightM = last ? last.h : row.heightM;
    const observedAt = last ? new Date(last.t).toISOString() : null;
    const cutoff = (last?.t ?? Date.now()) - HISTORY_WINDOW_MS;
    const history = downsample(
      table.readings.filter((r) => r.t >= cutoff),
      HISTORY_MAX_POINTS,
    ).map((r) => ({ time: new Date(r.t).toISOString(), heightM: r.h }));
    const trend = computeTrend(table.readings, row.tendency);
    const floodClass = classify(heightM, table.thresholds, row.classification);

    const gauge: RiverGaugeReading = {
      stationId: st.bomId,
      stationName: row.name,
      river: st.river,
      heightM,
      trend,
      floodClass,
      thresholds: table.thresholds,
      observedAt,
      history,
    };

    const heightText = heightM !== null ? `${heightM.toFixed(2)} m` : 'no reading';
    return {
      id: `gauge-${st.bomId}`,
      category: 'river_gauge',
      source: 'bom',
      sourceLabel: 'BOM river heights',
      title: row.name,
      subtitle: `${heightText} · ${trend} · ${CLASS_LABEL[floodClass]}`,
      status: CLASS_LABEL[floodClass],
      severity: SEVERITY[floodClass],
      lat: st.lat,
      lng: st.lng,
      geometryType: 'Point',
      updatedAt: observedAt || undefined,
      isCorridorPriority: st.corridorTags.length > 0,
      corridorTags: st.corridorTags,
      rawProperties: { bomTendency: row.tendency, bomClassification: row.classification, tableUrl: BOM_BASE + row.tablePath },
      gauge,
    };
  });

  return results.filter((x): x is EmergencyFeatureItem => x !== null);
}
