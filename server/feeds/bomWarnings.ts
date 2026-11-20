/**
 * BOM Queensland warnings -> EmergencyFeatureItem[] (North Queensland subset).
 *
 * Sources (all public, no key; BOM returns 403 to generic UAs, so an identifying UA is sent):
 *  1. QLD warnings RSS (list of current warnings): https://www.bom.gov.au/fwo/IDZ00056.warnings_qld.xml
 *     (linked from https://www.bom.gov.au/rss/). Items carry title, link, pubDate only.
 *  2. Each item's warning page (e.g. https://reg.bom.gov.au/qld/warnings/flood/lower-condamine.shtml)
 *     contains the product ID (IDQxxxxx).
 *  3. Product AMOC XML: https://www.bom.gov.au/fwo/<ID>.amoc.xml — structured hazards, areas
 *     (forecast districts / river basins / sites), issue + expiry times. The same files are on the
 *     anonymous FTP (ftp://ftp.bom.gov.au/anon/gen/fwo/) but Node fetch has no FTP support.
 * If step 2/3 fails for an item, it falls back to title-only classification.
 */
import { XMLParser } from 'fast-xml-parser';
import type { BomWarningDetail, EmergencyFeatureItem } from '../../src/types/weather';
import { fetchText, mapLimit } from './http';
import { matchCorridorTags } from './geo';

const RSS_URL = 'https://www.bom.gov.au/fwo/IDZ00056.warnings_qld.xml';
const AMOC_URL = (id: string) => `https://www.bom.gov.au/fwo/${id}.amoc.xml`;
const DETAIL_TTL_MS = 30 * 60 * 1000;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => ['item', 'hazard', 'area'].includes(name),
  parseTagValue: false,
  parseAttributeValue: false,
});

// --- NQ relevance + representative points ------------------------------------
/**
 * Keyword -> approximate representative point (district / catchment centroid, hand-picked; for
 * map placement only). First match wins, so more specific (catchment) entries come first.
 */
const NQ_PLACES: Array<{ re: RegExp; lat: number; lng: number }> = [
  { re: /\bhaughton\b|\bbarratta/i, lat: -19.56, lng: 147.1 },
  { re: /\bross\s+river\b|\bbohle\b|\bstuart\s+creek\b|\balligator\s+creek\b/i, lat: -19.32, lng: 146.76 },
  { re: /\bblack\s+river\b|\bbluewater\b/i, lat: -19.22, lng: 146.6 },
  { re: /\blower\s+burdekin\b|\bayr\b|\bhome\s+hill\b/i, lat: -19.6, lng: 147.35 },
  { re: /\bburdekin\b/i, lat: -20.0, lng: 146.9 },
  { re: /\bherbert\b|\bingham\b|\bcardwell\b/i, lat: -18.6, lng: 146.0 },
  { re: /\btownsville\b|\bmagnetic\s+island\b|\bpalm\s+island\b/i, lat: -19.26, lng: 146.82 },
  { re: /\bdon\s+river\b|\bbowen\b|\bproserpine\b|\bwhitsunday|\bcentral\s+coast\b/i, lat: -20.4, lng: 148.3 },
  { re: /\bnorthern\s+goldfields\b|\bupper\s+flinders\b|\bcharters\s+towers\b/i, lat: -19.9, lng: 145.4 },
  { re: /\bnorth\s+tropical\s+coast\b|\btablelands\b|\bcairns\b|\binnisfail\b|\btully\b/i, lat: -17.3, lng: 145.8 },
  { re: /\bpeninsula\b/i, lat: -14.5, lng: 143.6 },
];

function locate(text: string): { lat: number; lng: number } | null {
  for (const p of NQ_PLACES) if (p.re.test(text)) return { lat: p.lat, lng: p.lng };
  return null;
}

function isTropicalCyclone(text: string): boolean {
  return /tropical\s+cyclone/i.test(text);
}

// --- Severity ----------------------------------------------------------------
function warningSeverity(text: string): EmergencyFeatureItem['severity'] {
  const t = text.toLowerCase();
  if (/\bfinal\b|cancellation|\bcancel/.test(t)) return 'info';
  if (/tropical cyclone/.test(t)) return /watch/.test(t) && !/warning/.test(t) ? 'high' : 'critical';
  if (/major flood/.test(t)) return 'critical';
  if (/moderate flood|severe thunderstorm|severe weather|extreme heatwave|catastrophic|extreme fire/.test(t)) return 'high';
  if (/minor flood|flood watch|flood warning|severe heatwave|\bwatch\b/.test(t)) return 'moderate';
  return 'info';
}

// --- Parsing -----------------------------------------------------------------
interface RssItem {
  title: string;
  link: string;
  pubDate: string | null;
}

interface AmocInfo {
  productId: string;
  issuedAt: string | null;
  expiresAt: string | null;
  areas: string[];
  headlines: string[];
}

type XmlNode = Record<string, unknown>;

function str(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  if (v && typeof v === 'object' && '#text' in (v as XmlNode)) return str((v as XmlNode)['#text']);
  return '';
}

function parseRss(xml: string): RssItem[] {
  const doc = parser.parse(xml) as XmlNode;
  const channel = ((doc.rss as XmlNode | undefined)?.channel || {}) as XmlNode;
  const items = (channel.item as XmlNode[] | undefined) || [];
  return items
    .map((it) => ({ title: str(it.title), link: str(it.link), pubDate: str(it.pubDate) || null }))
    .filter((it) => it.title && it.link);
}

function parseAmoc(xml: string, productId: string): AmocInfo {
  const doc = parser.parse(xml) as XmlNode;
  const amoc = (doc.amoc || {}) as XmlNode;
  const hazards = (amoc.hazard as XmlNode[] | undefined) || [];
  const areas = new Set<string>();
  const headlines: string[] = [];
  for (const h of hazards) {
    const h1 = str(h.headline);
    if (h1) headlines.push(h1);
    const list = ((h['area-list'] as XmlNode | undefined)?.area as XmlNode[] | undefined) || [];
    for (const a of list) {
      const d = str(a['@_description']);
      if (d) areas.add(d);
    }
  }
  return {
    productId: str(amoc.identifier) || productId,
    issuedAt: str(amoc['issue-time-utc']) || null,
    expiresAt: str(amoc['expiry-time']) || null,
    areas: [...areas],
    headlines,
  };
}

function toIso(d: string | null): string | null {
  if (!d) return null;
  const t = Date.parse(d);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** "20/13:15 EST Minor Flood Warning for X" -> "Minor Flood Warning for X". */
function stripTimestamp(title: string): string {
  return title.replace(/^\d{1,2}\/\d{1,2}:\d{2}\s+[A-Z]{2,5}\s+/, '').trim();
}

/** "Minor Flood Warning for the Lower Condamine River" -> "Minor Flood Warning". */
function warningTypeOf(title: string): string {
  const m = title.match(/^(.*?(?:Warning|Watch|Advice|Alert))\b/i);
  return (m ? m[1] : title).replace(/\s*\(QLD\)\s*$/i, '').trim();
}

// --- Detail cache (product id + AMOC per warning link/pubDate) ---------------
const detailCache = new Map<string, { at: number; info: AmocInfo | null }>();

async function loadDetail(item: RssItem): Promise<AmocInfo | null> {
  const key = `${item.link}|${item.pubDate}`;
  const hit = detailCache.get(key);
  if (hit && Date.now() - hit.at < DETAIL_TTL_MS) return hit.info;
  let info: AmocInfo | null = null;
  try {
    const pageUrl = item.link.replace(/^http:\/\//i, 'https://');
    const html = await fetchText(pageUrl, { label: 'BOM warning page', accept: 'text/html' });
    const ids = html.match(/\bIDQ[12]\d{4}\b/g) || html.match(/\bID[A-Y]\d{5}\b/g) || [];
    const productId = ids[0];
    if (productId) {
      const xml = await fetchText(AMOC_URL(productId), { label: `BOM ${productId}.amoc.xml`, accept: 'text/xml' });
      info = parseAmoc(xml, productId);
    }
  } catch {
    info = null; // fall back to title-only
  }
  detailCache.set(key, { at: Date.now(), info });
  for (const [k, v] of detailCache) if (Date.now() - v.at > DETAIL_TTL_MS * 4) detailCache.delete(k);
  return info;
}

function guidSlug(link: string): string {
  return link.replace(/^https?:\/\/[^/]+\//, '').replace(/\.shtml$/, '').replace(/[^a-z0-9]+/gi, '-');
}

/** Fetch current BOM QLD warnings relevant to North Queensland. Throws if the RSS list fails. */
export async function fetchBomWarnings(): Promise<EmergencyFeatureItem[]> {
  const rss = await fetchText(RSS_URL, { label: 'BOM QLD warnings RSS', accept: 'application/rss+xml, text/xml' });
  const items = parseRss(rss);
  const details = await mapLimit(items, 3, loadDetail);

  const out: EmergencyFeatureItem[] = [];
  items.forEach((item, i) => {
    const info = details[i];
    const title = stripTimestamp(item.title);
    const areas = info?.areas ?? [];
    const relevanceText = [title, ...areas, ...(info?.headlines ?? [])].join(' | ');
    const point = locate(relevanceText);
    if (!point && !isTropicalCyclone(relevanceText)) return; // not North Queensland

    const isFinal = /\bfinal\b|cancellation/i.test(title);
    const expired = info?.expiresAt ? Date.parse(info.expiresAt) < Date.now() : false;
    const tags = matchCorridorTags(relevanceText);
    const detail: BomWarningDetail = {
      productId: info?.productId || guidSlug(item.link),
      warningType: warningTypeOf(title),
      areas,
      issuedAt: toIso(info?.issuedAt ?? null) || toIso(item.pubDate),
      expiresAt: toIso(info?.expiresAt ?? null),
      url: item.link.replace(/^http:\/\//i, 'https://'),
    };

    out.push({
      id: `bom-${detail.productId}`,
      category: 'bom_warning',
      source: 'bom',
      sourceLabel: 'Bureau of Meteorology',
      title,
      subtitle: areas.length ? areas.slice(0, 4).join(', ') + (areas.length > 4 ? ` +${areas.length - 4}` : '') : undefined,
      description: info?.headlines.length ? info.headlines.join('\n') : undefined,
      status: isFinal ? 'Final' : expired ? 'Expired' : 'Current',
      severity: expired ? 'info' : warningSeverity(relevanceText),
      lat: point?.lat ?? null,
      lng: point?.lng ?? null,
      geometryType: point ? 'Point' : 'None',
      updatedAt: detail.issuedAt || undefined,
      isCorridorPriority: tags.length > 0,
      corridorTags: tags,
      bomWarning: detail,
    });
  });
  return out;
}
