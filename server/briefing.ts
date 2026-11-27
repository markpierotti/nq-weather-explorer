/**
 * Gemini briefing routes: corridor briefing, cyclone synthesis, follow-up chat.
 *
 * Moved from server.ts inline handlers -> server/briefing.ts as Phase 5, and
 * hardened for life-safety corridor telemetry:
 *  - Pulls authoritative live QLDTraffic, BOM warnings, and river gauges directly
 *    from server/feeds/ instead of relying solely on browser-truncated summaries.
 *  - Filters follow-up chat context by intent and corridor before calling Gemini.
 *  - Enforces strict closed-world / fail-closed rules via the closed-world system
 *    prompt + server-side Fact Ledger + CheckGrounding (never infer "road is open"
 *    from zero alerts, explicitly flag stale/errored feeds). Gemini 4 ignores
 *    sampling params (temperature/top_p/top_k), so none are sent.
 *  - Uses the Interactions API with store: false (stateless; emergency prompts are
 *    not retained server-side, and previous_interaction_id is never used).
 *  - Optionally verifies answers against the live Fact Ledger via Discovery Engine
 *    CheckGrounding (server/grounding.ts) when ENABLE_CHECK_GROUNDING=true.
 *
 * Gracefully degrades when GEMINI_API_KEY is unset (all endpoints return 503).
 */
import type { Express, Request, Response } from 'express';
import { GoogleGenAI, type Interactions } from '@google/genai';
import type {
  BriefingChatRequest,
  BriefingChatEvent,
  BriefingFeedHealth,
  BriefingGroundingReport,
  CorridorBriefingResponse,
  EmergencyFeatureItem,
  EmergencyFeedResponse,
  GroundingCitation,
  StructuredBriefing,
  BriefingRisk,
  BriefingSection,
} from '../src/types/weather';
import { getFeedResponse } from './feeds/index';
import {
  checkAnswerGrounding,
  isCheckGroundingEnabled,
  type GroundingFactInput,
} from './grounding';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function geminiKey(): string {
  return process.env.GEMINI_API_KEY || '';
}

function geminiModel(): string {
  return process.env.GEMINI_MODEL || 'gemini-4-hydrogen';
}

/** Prefer Google's own error message: Interactions APIError keeps the HTTP body on `.body`. */
function apiErrorMessage(val: unknown): string | undefined {
  const err = val as { status?: unknown; body?: unknown } | null;
  if (!err || typeof err.body !== 'string' || !err.body) return undefined;
  try {
    const parsed = JSON.parse(err.body);
    // Google returns either {error:{...}} or [{error:{...}}].
    const msg = (Array.isArray(parsed) ? parsed[0] : parsed)?.error?.message;
    if (typeof msg === 'string' && msg) return err.status ? `${err.status} ${msg}` : msg;
  } catch {
    /* non-JSON body: fall through to .message */
  }
  return undefined;
}

/** What viewers see when Gemini fails; the detailed reason stays in the server log. */
const AI_UNAVAILABLE_MESSAGE = 'AI briefing is temporarily unavailable. Please try again later.';

function redactKey(val: unknown, key: string): string {
  let out = String(apiErrorMessage(val) || (val as any)?.message || val || '');
  out = out.replace(/([?&]key=)[^&\s"']+/gi, '$1[REDACTED]');
  if (key && key.length >= 8) out = out.split(key).join('[REDACTED]');
  return out;
}

function formatAest(input?: string | number | null): string {
  if (input === null || input === undefined || input === '') return 'unknown time';
  const d = typeof input === 'number' ? new Date(input) : new Date(input);
  if (Number.isNaN(d.getTime())) return String(input);
  return `${d.toLocaleString('en-AU', {
    timeZone: 'Australia/Brisbane',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })} AEST`;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const GOOGLE_SEARCH_TOOL: Interactions.Tool = { type: 'google_search' };

/** url_citation annotations -> GroundingCitation (Interactions API returns citations inline on text). */
function annotationsToCitations(
  annotations: Interactions.Annotation[] | undefined,
): GroundingCitation[] {
  const citations: GroundingCitation[] = [];
  for (const anno of annotations || []) {
    if (anno.type === 'url_citation' && anno.url) {
      citations.push({ title: String(anno.title || anno.url), uri: String(anno.url) });
    }
  }
  return citations;
}

/** Collect de-duplicated citations from the text content of model_output steps. */
function extractCitations(steps: Interactions.Step[] | undefined): GroundingCitation[] {
  const citations: GroundingCitation[] = [];
  const seen = new Set<string>();
  for (const step of steps || []) {
    if (step.type !== 'model_output') continue;
    for (const part of step.content || []) {
      if (part.type !== 'text') continue;
      for (const c of annotationsToCitations(part.annotations)) {
        if (!seen.has(c.uri)) {
          seen.add(c.uri);
          citations.push(c);
        }
      }
    }
  }
  return citations;
}

function parseBullets(rawText: string): string[] {
  const lines = rawText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- ') || l.startsWith('* ') || /^\d+\./.test(l));

  if (lines.length > 0) {
    return lines.map((l) => l.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '')).slice(0, 4);
  }
  return rawText
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 4);
}

// ---------------------------------------------------------------------------
// Structured briefing parser
// ---------------------------------------------------------------------------

function parseRisk(text: string): BriefingRisk {
  // Whole-word, most severe first: "flow"/"Highway" can't match, and any ambiguity errs high.
  for (const r of ['EXTREME', 'HIGH', 'MODERATE', 'LOW'] as const) {
    if (new RegExp(`\\b${r}\\b`, 'i').test(text)) return r;
  }
  return 'LOW';
}

function bulletsToStructured(bullets: string[], _rawText: string): StructuredBriefing {
  const sectionTitles = [
    'Model Agreement & Rain/Storm Spread',
    'Bruce Hwy / Road & Flood Status',
    'Warnings & Outages',
    'Next-24h Recommendation',
  ];

  const sections: BriefingSection[] = bullets.map((b, i) => {
    const boldMatch = b.match(/^\*\*([^*]+)\*\*[:\s]*(.*)/s);
    const title = boldMatch ? boldMatch[1] : sectionTitles[i] || `Section ${i + 1}`;
    const body = boldMatch ? boldMatch[2] : b;
    return {
      title,
      risk: parseRisk(body),
      summary: body.slice(0, 300),
      details: [body],
    };
  });

  // Overall risk = highest section risk
  const riskRank: Record<BriefingRisk, number> = { LOW: 0, MODERATE: 1, HIGH: 2, EXTREME: 3 };
  const overallRisk = sections.reduce<BriefingRisk>(
    (best, s) => (riskRank[s.risk] > riskRank[best] ? s.risk : best),
    'LOW',
  );

  // Extract action items from last bullet (the recommendation)
  const lastBullet = bullets[bullets.length - 1] || '';
  const actions = lastBullet
    .split(/[.;]\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15 && s.length < 200)
    .slice(0, 4);

  return {
    overallRisk,
    headline: sections[0]?.summary.slice(0, 120) || 'NQ Corridor Briefing',
    sections,
    actions: actions.length > 0 ? actions : [lastBullet.slice(0, 200)],
  };
}

// ---------------------------------------------------------------------------
// Authoritative Server-Side Live Fact Ledger & Intent Router
// ---------------------------------------------------------------------------

type ChatIntent = 'road_corridor' | 'river_flood' | 'cyclone_wind' | 'rain_forecast' | 'general';

interface LiveFeedSnapshot {
  traffic: EmergencyFeedResponse;
  bomWarnings: EmergencyFeedResponse;
  gauges: EmergencyFeedResponse;
  feedHealth: BriefingFeedHealth[];
}

const CORRIDOR_REGEX =
  /\b(bruce\s*hwy|bruce\s*highway|\ba1\b|ayr|home\s*hill|giru|townsville|burdekin|haughton|ross\s*river|alligator\s*creek|brandon|clare|inkerman|woodstock|nome)\b/i;

function feedHealthStatus(feed: EmergencyFeedResponse): BriefingFeedHealth {
  const status: BriefingFeedHealth['status'] = feed.error
    ? feed.items.length > 0
      ? 'stale'
      : 'error'
    : 'live';
  return {
    feed: feed.feed,
    status,
    count: feed.items.length,
    fetchedAt: new Date(feed.fetchedAt).toISOString(),
    ...(feed.error ? { error: feed.error } : {}),
  };
}

async function fetchLiveFeedSnapshot(): Promise<LiveFeedSnapshot> {
  const [traffic, bomWarnings, gauges] = await Promise.all([
    getFeedResponse('traffic'),
    getFeedResponse('bom-warnings'),
    getFeedResponse('gauges'),
  ]);
  return {
    traffic,
    bomWarnings,
    gauges,
    feedHealth: [feedHealthStatus(traffic), feedHealthStatus(bomWarnings), feedHealthStatus(gauges)],
  };
}

function isCorridorItem(item: EmergencyFeatureItem): boolean {
  if (item.isCorridorPriority) return true;
  const hay = [
    item.title,
    item.subtitle,
    item.description,
    item.traffic?.roadName,
    item.traffic?.locality,
    item.gauge?.river,
    item.gauge?.stationName,
    ...(item.bomWarning?.areas || []),
    ...(item.corridorTags || []),
  ]
    .filter(Boolean)
    .join(' ');
  return CORRIDOR_REGEX.test(hay);
}

function trafficItemToFact(item: EmergencyFeatureItem): GroundingFactInput {
  const t = item.traffic;
  const closureTag = t?.isClosure ? 'ROAD CLOSED' : t?.impact || item.status || 'Active traffic event';
  const road = t?.roadName ? `Road: ${t.roadName}. ` : '';
  const loc = t?.locality ? `Locality: ${t.locality}. ` : '';
  const type = t?.eventType ? `Type: ${t.eventType}${t.eventSubtype ? ` (${t.eventSubtype})` : ''}. ` : '';
  const desc = item.description ? `Details: ${item.description.slice(0, 260)}. ` : '';
  const updated = formatAest(item.updatedAt);

  return {
    factText: `QLDTraffic event (${closureTag}): ${item.title}. ${road}${loc}${type}${desc}Severity: ${item.severity}. Updated: ${updated}.`,
    attributes: {
      source: 'QLDTraffic',
      category: 'traffic',
      corridor: isCorridorItem(item) ? 'true' : 'false',
      closure: t?.isClosure ? 'true' : 'false',
      observedAt: updated,
    },
  };
}

function gaugeItemToFact(item: EmergencyFeatureItem): GroundingFactInput {
  const g = item.gauge;
  const height = g && g.heightM !== null ? `${g.heightM.toFixed(2)} m` : 'height unavailable';
  const trend = g?.trend || 'unknown';
  const cls = g?.floodClass || 'unknown';
  const thresholds = g
    ? `Thresholds (m) — minor: ${g.thresholds.minor ?? 'n/a'}, moderate: ${g.thresholds.moderate ?? 'n/a'}, major: ${g.thresholds.major ?? 'n/a'}.`
    : '';
  const observed = formatAest(g?.observedAt || item.updatedAt);

  return {
    factText: `River gauge ${g?.stationName || item.title} (${g?.river || 'NQ catchment'}): ${height}, trend ${trend}, flood class ${cls}. ${thresholds} Observed: ${observed}.`,
    attributes: {
      source: 'QLD Water / BOM River Gauges',
      category: 'river_gauge',
      corridor: isCorridorItem(item) ? 'true' : 'false',
      observedAt: observed,
    },
  };
}

function bomWarningItemToFact(item: EmergencyFeatureItem): GroundingFactInput {
  const w = item.bomWarning;
  const areas = w?.areas?.length ? `Areas: ${w.areas.join(', ')}. ` : '';
  const issued = formatAest(w?.issuedAt || item.updatedAt);
  const expires = w?.expiresAt ? `Expires: ${formatAest(w.expiresAt)}. ` : '';
  const desc = item.description ? `${item.description.slice(0, 280)}. ` : '';

  return {
    factText: `BOM QLD Warning (${w?.warningType || 'Official Warning'}, ${w?.productId || item.id}): ${item.title}. ${areas}${desc}Issued: ${issued}. ${expires}`,
    attributes: {
      source: 'Bureau of Meteorology (BOM QLD)',
      category: 'bom_warning',
      corridor: isCorridorItem(item) ? 'true' : 'false',
      observedAt: issued,
      ...(w?.url ? { url: w.url } : {}),
    },
  };
}

function buildFeedHealthFacts(snapshot: LiveFeedSnapshot): GroundingFactInput[] {
  const facts: GroundingFactInput[] = [];

  const corridorTraffic = snapshot.traffic.items.filter(isCorridorItem);
  const corridorClosures = corridorTraffic.filter((i) => i.traffic?.isClosure);
  const trafficTime = formatAest(snapshot.traffic.fetchedAt);
  if (snapshot.traffic.error && snapshot.traffic.items.length === 0) {
    facts.push({
      factText: `FEED BLIND SPOT — QLDTraffic feed is UNAVAILABLE as of ${trafficTime}: ${snapshot.traffic.error}. Live road closures cannot be verified from this feed right now.`,
      attributes: { source: 'Feed Health', category: 'feed_health', feed: 'traffic' },
    });
  } else {
    const staleNote = snapshot.traffic.error ? ` WARNING: serving stale cached data (${snapshot.traffic.error}).` : '';
    facts.push({
      factText: `QLDTraffic feed status as of ${trafficTime}: ${snapshot.traffic.error ? 'STALE' : 'LIVE'}. Total active events: ${snapshot.traffic.items.length}; Ayr–Giru–Townsville / Bruce Hwy corridor events: ${corridorTraffic.length} (${corridorClosures.length} active road closures).${staleNote} Note: zero listed closures does NOT guarantee local council roads or unmonitored floodways are open.`,
      attributes: { source: 'QLDTraffic', category: 'feed_health', observedAt: trafficTime },
    });
  }

  const corridorWarnings = snapshot.bomWarnings.items.filter(isCorridorItem);
  const bomTime = formatAest(snapshot.bomWarnings.fetchedAt);
  if (snapshot.bomWarnings.error && snapshot.bomWarnings.items.length === 0) {
    facts.push({
      factText: `FEED BLIND SPOT — BOM QLD warnings feed is UNAVAILABLE as of ${bomTime}: ${snapshot.bomWarnings.error}.`,
      attributes: { source: 'Feed Health', category: 'feed_health', feed: 'bom-warnings' },
    });
  } else {
    const staleNote = snapshot.bomWarnings.error ? ` WARNING: serving stale cached data (${snapshot.bomWarnings.error}).` : '';
    facts.push({
      factText: `BOM QLD warnings feed status as of ${bomTime}: ${snapshot.bomWarnings.error ? 'STALE' : 'LIVE'}. Active QLD warnings: ${snapshot.bomWarnings.items.length}; corridor-relevant warnings: ${corridorWarnings.length}.${staleNote}`,
      attributes: { source: 'Bureau of Meteorology (BOM QLD)', category: 'feed_health', observedAt: bomTime },
    });
  }

  const gaugeTime = formatAest(snapshot.gauges.fetchedAt);
  const risingOrFloodGauges = snapshot.gauges.items.filter(
    (i) => i.gauge && (i.gauge.trend === 'rising' || ['minor', 'moderate', 'major'].includes(i.gauge.floodClass)),
  );
  if (snapshot.gauges.error && snapshot.gauges.items.length === 0) {
    facts.push({
      factText: `FEED BLIND SPOT — River gauges feed is UNAVAILABLE as of ${gaugeTime}: ${snapshot.gauges.error}.`,
      attributes: { source: 'Feed Health', category: 'feed_health', feed: 'gauges' },
    });
  } else {
    const staleNote = snapshot.gauges.error ? ` WARNING: serving stale cached data (${snapshot.gauges.error}).` : '';
    facts.push({
      factText: `River gauges feed status as of ${gaugeTime}: ${snapshot.gauges.error ? 'STALE' : 'LIVE'}. Monitored gauges: ${snapshot.gauges.items.length}; rising or at/above minor flood level: ${risingOrFloodGauges.length}.${staleNote}`,
      attributes: { source: 'QLD Water / BOM River Gauges', category: 'feed_health', observedAt: gaugeTime },
    });
  }

  return facts;
}

function classifyChatIntent(question: string): ChatIntent {
  const q = question.toLowerCase();
  if (/\b(road|roads|highway|hwy|bruce|open|closed|closure|drive|driving|route|bridge|crossing|cut\s*off|traffic|detour|passable)\b/.test(q)) {
    return 'road_corridor';
  }
  if (/\b(river|gauge|gauges|creek|flood|flooding|burdekin|haughton|ross|height|level|minor|moderate|major|rising)\b/.test(q)) {
    return 'river_flood';
  }
  if (/\b(cyclone|tropical|low|gust|gusts|wind|storm\s*tide|surge|jtwc|coral\s*sea)\b/.test(q)) {
    return 'cyclone_wind';
  }
  if (/\b(rain|rainfall|mm|shower|storm|thunderstorm|forecast|model|ecmwf|gfs|weathernext|temp|temperature|when)\b/.test(q)) {
    return 'rain_forecast';
  }
  return 'general';
}

/** JSON-stringify untrusted client data for a prompt, capped in size. */
function clientJson(value: unknown, maxChars = 6000): string {
  let s: string;
  try {
    s = JSON.stringify(value ?? null);
  } catch {
    s = 'null';
  }
  return s.length > maxChars ? `${s.slice(0, maxChars)}…[truncated]` : s;
}

function multiModelSummaryToFacts(multiModelSummary: unknown): GroundingFactInput[] {
  if (!multiModelSummary || typeof multiModelSummary !== 'object') return [];
  const mm = multiModelSummary as Record<string, any>;
  const facts: GroundingFactInput[] = [];

  if (mm.spreadOverview) {
    facts.push({
      factText: `Multi-model forecast spread for ${mm.location || 'selected location'}: ${clientJson(mm.spreadOverview, 1500)}.`,
      attributes: { source: 'Client-supplied (unverified) — Multi-Model Ensemble (WeatherNext 2 / BOM / ECMWF / GFS)', category: 'forecast' },
    });
  }
  if (Array.isArray(mm.next3Days)) {
    for (const day of mm.next3Days.slice(0, 3)) {
      facts.push({
        factText: `Forecast day ${day.day || 'upcoming'}: ${clientJson(day, 1500)}.`,
        attributes: { source: 'Client-supplied (unverified) — Multi-Model Ensemble', category: 'forecast' },
      });
    }
  }
  if (Array.isArray(mm.bomWarnings) && mm.bomWarnings.length > 0) {
    for (const w of mm.bomWarnings.slice(0, 5)) {
      facts.push({
        factText: `BOM location warning: ${w.title || w.shortTitle || clientJson(w, 1500)} (issued ${formatAest(w.issueTime)}).`,
        attributes: { source: 'Client-supplied (unverified) — Bureau of Meteorology (BOM QLD)', category: 'bom_warning' },
      });
    }
  }
  return facts;
}

function buildSelectedFacts(
  snapshot: LiveFeedSnapshot,
  intent: ChatIntent,
  multiModelSummary?: unknown,
  browserEmergencySummary?: unknown,
): GroundingFactInput[] {
  const facts: GroundingFactInput[] = [...buildFeedHealthFacts(snapshot)];

  const corridorTraffic = snapshot.traffic.items.filter(isCorridorItem);
  const otherTraffic = snapshot.traffic.items.filter((i) => !isCorridorItem(i));
  const corridorGauges = snapshot.gauges.items.filter(isCorridorItem);
  const otherGauges = snapshot.gauges.items.filter((i) => !isCorridorItem(i));
  const corridorWarnings = snapshot.bomWarnings.items.filter(isCorridorItem);
  const otherWarnings = snapshot.bomWarnings.items.filter((i) => !isCorridorItem(i));

  if (intent === 'road_corridor') {
    for (const item of corridorTraffic.slice(0, 35)) facts.push(trafficItemToFact(item));
    for (const item of corridorGauges.slice(0, 20)) facts.push(gaugeItemToFact(item));
    for (const item of corridorWarnings.slice(0, 15)) facts.push(bomWarningItemToFact(item));
    // Include any non-corridor active closures just in case user asks about adjacent approaches
    for (const item of otherTraffic.filter((i) => i.traffic?.isClosure).slice(0, 10)) {
      facts.push(trafficItemToFact(item));
    }
  } else if (intent === 'river_flood') {
    for (const item of [...corridorGauges, ...otherGauges].slice(0, 40)) facts.push(gaugeItemToFact(item));
    for (const item of [...corridorWarnings, ...otherWarnings].slice(0, 15)) facts.push(bomWarningItemToFact(item));
    for (const item of corridorTraffic.filter((i) => i.traffic?.isClosure || /flood/i.test(i.title)).slice(0, 15)) {
      facts.push(trafficItemToFact(item));
    }
  } else if (intent === 'rain_forecast' || intent === 'cyclone_wind') {
    facts.push(...multiModelSummaryToFacts(multiModelSummary));
    for (const item of [...corridorWarnings, ...otherWarnings].slice(0, 15)) facts.push(bomWarningItemToFact(item));
    for (const item of corridorGauges.slice(0, 10)) facts.push(gaugeItemToFact(item));
    for (const item of corridorTraffic.filter((i) => i.traffic?.isClosure).slice(0, 10)) {
      facts.push(trafficItemToFact(item));
    }
  } else {
    // General corridor briefing or general chat question
    facts.push(...multiModelSummaryToFacts(multiModelSummary));
    for (const item of corridorTraffic.slice(0, 25)) facts.push(trafficItemToFact(item));
    for (const item of corridorGauges.slice(0, 15)) facts.push(gaugeItemToFact(item));
    for (const item of [...corridorWarnings, ...otherWarnings].slice(0, 15)) facts.push(bomWarningItemToFact(item));
  }

  // Include any browser-supplied blocked feed labels (e.g. Guardian IMS / Ergon) if present
  const blockedFeeds = (Array.isArray((browserEmergencySummary as any)?.blockedFeeds)
    ? (browserEmergencySummary as any).blockedFeeds
    : [])
    .filter((f: unknown): f is string => typeof f === 'string')
    .map((f: string) => f.slice(0, 80))
    .slice(0, 10);
  if (blockedFeeds.length > 0) {
    facts.push({
      factText: `Client-reported (unverified) unreachable/blocked council or utility feeds: ${blockedFeeds.join(', ')}.`,
      attributes: { source: 'Client Feed Health', category: 'feed_health' },
    });
  }

  return facts.slice(0, 180);
}

function formatFactsBlock(facts: GroundingFactInput[]): string {
  return facts.map((f, i) => `[F${i + 1}] (${f.attributes?.source || 'Live Feed'}) ${f.factText}`).join('\n');
}

function buildFailClosedFallback(snapshot: LiveFeedSnapshot, intent: ChatIntent): string {
  const lines: string[] = [
    'Automated grounding verification flagged potential unsupported claims in the draft answer, so here is the verified live feed snapshot directly:',
  ];

  for (const fh of snapshot.feedHealth) {
    lines.push(
      `- **${fh.feed}** (${fh.status.toUpperCase()} as of ${formatAest(fh.fetchedAt)}): ${fh.count} items${fh.error ? ` — ${fh.error}` : ''}.`,
    );
  }

  const corridorClosures = snapshot.traffic.items.filter((i) => isCorridorItem(i) && i.traffic?.isClosure);
  if (intent === 'road_corridor' || corridorClosures.length > 0) {
    if (corridorClosures.length === 0) {
      lines.push(
        `- **Bruce Hwy / Ayr–Townsville closures:** QLDTraffic currently lists 0 active closures as of ${formatAest(snapshot.traffic.fetchedAt)} (this does not guarantee local council roads or unmonitored floodways are open).`,
      );
    } else {
      for (const c of corridorClosures.slice(0, 5)) {
        lines.push(`- **CLOSED:** ${c.title} (${c.traffic?.roadName || 'Corridor road'}, updated ${formatAest(c.updatedAt)}).`);
      }
    }
  }

  const activeFloodGauges = snapshot.gauges.items.filter(
    (i) => i.gauge && ['minor', 'moderate', 'major'].includes(i.gauge.floodClass),
  );
  if (activeFloodGauges.length > 0) {
    for (const g of activeFloodGauges.slice(0, 5)) {
      lines.push(
        `- **River gauge (${g.gauge!.floodClass.toUpperCase()}):** ${g.gauge!.stationName} at ${g.gauge!.heightM?.toFixed(2) ?? '?'} m (${g.gauge!.trend}, observed ${formatAest(g.gauge!.observedAt)}).`,
      );
    }
  }

  lines.push('Verify live road and flood status directly on QLDTraffic and BOM before travelling — never drive through floodwater.');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// POST /api/briefing/corridor
// ---------------------------------------------------------------------------

async function handleCorridorBriefing(req: Request, res: Response): Promise<void> {
  const key = geminiKey();
  if (!key) {
    res.status(503).json({
      error: 'GEMINI_API_KEY is not configured. Set GEMINI_API_KEY in .env to enable AI Corridor Briefings.',
    });
    return;
  }

  const { locationName, multiModelSummary, emergencySummary, blockedFeedsCount } = req.body || {};
  const promptLocation = String(locationName || '').slice(0, 80);

  try {
    const snapshot = await fetchLiveFeedSnapshot();
    const facts = buildSelectedFacts(snapshot, 'general', multiModelSummary, emergencySummary);
    const hasDegradedFeeds =
      snapshot.feedHealth.some((f) => f.status !== 'live') || Number(blockedFeedsCount || 0) > 0;

    const ai = new GoogleGenAI({ apiKey: key });
    const model = geminiModel();

    const systemInstruction = [
      `You are a life-safety-focused North Queensland meteorological and Bruce Highway (A1) corridor duty officer for ${promptLocation || 'Ayr / Burdekin & Townsville'} (Ayr <-> Home Hill <-> Giru <-> Townsville).`,
      `STRICT ACCURACY & FAIL-CLOSED RULES:`,
      `1. Base every road, river gauge, and warning statement strictly on VERIFIED_LIVE_FACTS below. Never speculate, invent figures, or assume conditions not stated in the facts.`,
      `2. NEVER declare a road "open", "clear", or "safe to drive" simply because 0 closures are listed. Instead state the exact QLDTraffic count and AEST timestamp (e.g. "QLDTraffic lists 0 active closures as of HH:MM AEST") and note that local council roads or rapidly rising water may not be listed.`,
      `3. Explicitly call out any feed marked STALE, ERROR, or UNAVAILABLE as a blind spot.`,
      `4. Cite AEST timestamps from the facts whenever reporting road or gauge status.`,
    ].join('\n');

    const prompt = [
      `=== VERIFIED_LIVE_FACTS (Authoritative Server Cache) ===`,
      formatFactsBlock(facts),
      ``,
      `Respond with EXACTLY 4 concise, high-signal operational bullet points (no preamble, no extra headings, start each bullet with "- "):`,
      `- **Model agreement & rain/storm spread:** Summarize agreement vs spread across available forecast models (or state if forecast data is still loading).`,
      `- **Bruce Hwy / Ayr–Townsville road & flood status:** Summarize active QLDTraffic closures/events and Burdekin/Haughton/Ross river gauge levels strictly from VERIFIED_LIVE_FACTS with AEST timestamps.`,
      `- **Warnings & feed blind spots:** Summarize active BOM warnings and explicitly note any unavailable/stale/blocked feeds.`,
      `- **Next-24h operational recommendation:** Clear, conservative travel and monitoring guidance (remind travellers to verify QLDTraffic/BOM before departing and never enter floodwater).`,
    ].join('\n');

    const interaction = await ai.interactions.create({
      model,
      input: prompt,
      system_instruction: systemInstruction,
      store: false,
      ...(hasDegradedFeeds ? { tools: [GOOGLE_SEARCH_TOOL] } : {}),
    });

    const rawText = (interaction.output_text || '').trim();
    const citations = extractCitations(interaction.steps);
    const grounding = await checkAnswerGrounding(rawText, facts);

    const finalRawText =
      grounding.enabled && !grounding.passed
        ? buildFailClosedFallback(snapshot, 'general')
        : rawText;

    const bullets = parseBullets(finalRawText);
    const structured = bulletsToStructured(bullets, finalRawText);

    const body: CorridorBriefingResponse = {
      locationName: locationName || 'Ayr / Townsville Corridor',
      structured,
      bullets,
      rawText: finalRawText,
      citations,
      usedSearchGrounding: citations.length > 0,
      generatedAt: new Date().toISOString(),
      model,
      feedHealth: snapshot.feedHealth,
      grounding,
    };
    res.json(body);
  } catch (err: any) {
    const safeErr = redactKey(err, key);
    console.error('Gemini Corridor Briefing error:', safeErr);
    res.status(503).json({ error: AI_UNAVAILABLE_MESSAGE });
  }
}

// ---------------------------------------------------------------------------
// POST /api/briefing/cyclone
// ---------------------------------------------------------------------------

async function handleCycloneSynthesis(req: Request, res: Response): Promise<void> {
  const key = geminiKey();
  if (!key) {
    res.status(503).json({
      error: 'GEMINI_API_KEY is not configured. Set GEMINI_API_KEY in .env or enter a WeatherNext 3 Maps Weather key.',
    });
    return;
  }

  const { locationName, lat, lng, multiModelSummary, cycloneAndRoadItems } = req.body || {};
  const promptLocation = String(locationName || '').slice(0, 80);
  const promptLat = Number.isFinite(Number(lat)) ? Number(lat) : -19.57;
  const promptLng = Number.isFinite(Number(lng)) ? Number(lng) : 147.41;

  try {
    const ai = new GoogleGenAI({ apiKey: key });
    const model = geminiModel();

    const prompt = [
      `You are a North Queensland tropical cyclone & severe weather specialist briefing operations for Ayr / Burdekin (-19.57, 147.41), Townsville (-19.26, 146.82), and the active target ${promptLocation || 'Ayr / Townsville'} (${promptLat}, ${promptLng}).`,
      `Use Google Search grounding right now to retrieve the latest:`,
      `1) Google Weather (WeatherNext 3) forecast & wind/rain outlook for Ayr and Townsville QLD`,
      `2) Australian Bureau of Meteorology (BOM) Queensland Tropical Cyclone Track Map / 7-day Cyclone Outlook / Coral Sea warnings`,
      `3) Joint Typhoon Warning Center (JTWC) Coral Sea / South Pacific tropical disturbance or cyclone guidance`,
      ``,
      `Also incorporate our live local telemetry below:`,
      `=== LIVE ENSEMBLE & BOM DATA ===`,
      clientJson(multiModelSummary || {}, 8000),
      ``,
      `=== ACTIVE CYCLONE TRACK / CORRIDOR FEED ITEMS ===`,
      clientJson(Array.isArray(cycloneAndRoadItems) ? cycloneAndRoadItems.slice(0, 40) : [], 8000),
      ``,
      `Output a single valid JSON object (no markdown fences needed, or \`\`\`json fenced) with EXACTLY these keys:`,
      `{`,
      `  "headline": "Short 1-line cyclone threat status headline for Coral Sea / Ayr / Townsville",`,
      `  "peakGusts": "Projected peak wind gusts for Ayr & Townsville (e.g. '75–95 km/h gusts possible Thu night; 45–55 km/h baseline')",`,
      `  "corridorWindow": "Expected landfall / closest corridor approach window or 'No direct cyclone track within 7 days'",`,
      `  "rainfallRange": "Projected multi-model rainfall range across WeatherNext/BOM/ECMWF/GFS for Ayr–Townsville",`,
      `  "bruceHwyCutoffRisk": "LOW | MODERATE | HIGH | EXTREME",`,
      `  "bruceHwyDetail": "Specific risk note for Burdekin River, Haughton River (Giru), and Ross/Alligator Creek crossings",`,
      `  "bullets": [`,
      `    "Google Weather (WeatherNext 3) vs BOM/ECMWF/GFS agreement summary",`,
      `    "BOM QLD & JTWC Coral Sea system track / development probability",`,
      `    "Ayr, Home Hill, Giru & Townsville wind, storm tide, and Bruce Highway cut-off outlook"`,
      `  ]`,
      `}`,
    ].join('\n');

    const interaction = await ai.interactions.create({
      model,
      input: prompt,
      store: false,
      tools: [GOOGLE_SEARCH_TOOL],
    });

    const rawText = (interaction.output_text || '').trim();
    let parsed: any = null;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch {
      parsed = null;
    }

    const rawRisk = String(parsed?.bruceHwyCutoffRisk || 'UNKNOWN').toUpperCase();
    const normalizedRisk = (['LOW', 'MODERATE', 'HIGH', 'EXTREME'].includes(rawRisk)
      ? rawRisk
      : 'UNKNOWN') as 'LOW' | 'MODERATE' | 'HIGH' | 'EXTREME' | 'UNKNOWN';

    const bullets = Array.isArray(parsed?.bullets)
      ? parsed.bullets.map((b: unknown) => String(b)).filter(Boolean).slice(0, 4)
      : rawText
          .split('\n')
          .map((l) => l.trim().replace(/^[-*]\s+/, ''))
          .filter(Boolean)
          .slice(0, 3);

    const citations = extractCitations(interaction.steps);

    res.json({
      locationName: locationName || 'Ayr & Townsville Corridor',
      headline: String(parsed?.headline || 'Coral Sea & North Queensland Cyclone Threat Synthesis'),
      peakGusts: String(parsed?.peakGusts || 'Refer to live ensemble and BOM wind outlook below.'),
      corridorWindow: String(parsed?.corridorWindow || 'No confirmed landfall window in live search results.'),
      rainfallRange: String(parsed?.rainfallRange || 'See 4-model ensemble rainfall spread in table.'),
      bruceHwyCutoffRisk: normalizedRisk,
      bruceHwyDetail: String(parsed?.bruceHwyDetail || 'Monitor Burdekin & Haughton river gauges and QLDTraffic.'),
      bullets,
      citations,
      generatedAt: new Date().toISOString(),
      model,
    });
  } catch (err: any) {
    const safeErr = redactKey(err, key);
    console.error('Gemini Cyclone Synthesis error:', safeErr);
    res.status(503).json({ error: AI_UNAVAILABLE_MESSAGE });
  }
}

// ---------------------------------------------------------------------------
// POST /api/briefing/chat  (Server-Sent Events)
// ---------------------------------------------------------------------------

async function handleBriefingChat(req: Request, res: Response): Promise<void> {
  const key = geminiKey();
  if (!key) {
    res.status(503).json({
      error: 'GEMINI_API_KEY is not configured. Set GEMINI_API_KEY in .env to enable briefing chat.',
    });
    return;
  }

  const body = req.body as BriefingChatRequest | undefined;
  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
    res.status(400).json({ error: 'messages array is required' });
    return;
  }
  const MAX_CHAT_MESSAGES = 20;
  const MAX_MESSAGE_CHARS = 2000;
  if (
    body.messages.length > MAX_CHAT_MESSAGES ||
    !body.messages.every(
      (m) =>
        m &&
        (m.role === 'user' || m.role === 'model') &&
        typeof m.text === 'string' &&
        m.text.length <= MAX_MESSAGE_CHARS,
    )
  ) {
    res.status(400).json({
      error: `messages must be at most ${MAX_CHAT_MESSAGES} items, each with role and text (max ${MAX_MESSAGE_CHARS} chars)`,
    });
    return;
  }

  const ctx = body.context || ({} as BriefingChatRequest['context']);
  const locationName = String(ctx.locationName || '').slice(0, 80) || 'Ayr / Townsville';
  const latestUserQuestion =
    [...body.messages].reverse().find((m) => m.role === 'user')?.text || '';
  const intent = classifyChatIntent(latestUserQuestion);

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // nginx
  });

  // Listen on the response, not the request: on Node >= 16 `req` emits 'close' as soon as the
  // request body is consumed, which would mark every client as disconnected before we reply.
  let clientDisconnected = false;
  res.on('close', () => {
    if (!res.writableFinished) clientDisconnected = true;
  });

  const sendEvent = (event: BriefingChatEvent) => {
    if (!clientDisconnected && !res.writableEnded) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  };

  try {
    const snapshot = await fetchLiveFeedSnapshot();
    const facts = buildSelectedFacts(
      snapshot,
      intent,
      ctx.multiModelSummary,
      ctx.emergencySummary,
    );

    // Disable open web search for live road/gauge telemetry unless official feeds are down,
    // so yesterday's news articles cannot override live QLDTraffic or river gauge telemetry.
    const telemetryFeedsHealthy =
      snapshot.feedHealth.find((f) => f.feed === 'traffic')?.status === 'live' &&
      snapshot.feedHealth.find((f) => f.feed === 'gauges')?.status === 'live';
    const allowWebSearch =
      intent === 'cyclone_wind' ||
      intent === 'general' ||
      !telemetryFeedsHealthy;

    const systemInstruction = [
      `You are a life-safety-focused North Queensland weather and road corridor duty officer for ${locationName} (${Number.isFinite(Number(ctx.lat)) ? Number(ctx.lat) : -19.57}, ${Number.isFinite(Number(ctx.lng)) ? Number(ctx.lng) : 147.41}), specializing in the Bruce Highway (A1) corridor (Ayr <-> Home Hill <-> Giru <-> Townsville).`,
      `Detected query focus: ${intent}.`,
      ``,
      `NON-NEGOTIABLE LIFE-SAFETY & GROUNDING RULES:`,
      `1. Answer ONLY from VERIFIED_LIVE_FACTS below. Never speculate, extrapolate, or fill gaps from memory.`,
      `2. If asked whether a road is open/passable: NEVER say "Yes, the road is open" or "all clear" just because 0 closures are listed. Report the exact QLDTraffic event/closure count and AEST timestamp (e.g. "QLDTraffic lists 0 active closures on the Bruce Hwy between Townsville and Ayr as of HH:MM AEST") and note that local council roads or sudden floodwater may not appear immediately.`,
      `3. Explicitly call out any feed marked STALE or UNAVAILABLE in VERIFIED_LIVE_FACTS as a blind spot.`,
      `4. If the question asks about a specific road, creek, or metric not present in VERIFIED_LIVE_FACTS, explicitly state that no live feed record covers it and advise checking QLDTraffic, BOM, or the local council disaster dashboard.`,
      `5. Keep answers concise, direct, and easy to scan under stress (short bullets with AEST timestamps).`,
      ``,
      `=== VERIFIED_LIVE_FACTS ===`,
      formatFactsBlock(facts),
    ].join('\n');

    // Stateless multi-turn (store: false): replay the visible chat as user_input / model_output
    // steps. The browser only keeps text, so prior turns carry no thought/tool signatures (same
    // information the old generateContent history had).
    const input: Interactions.Step[] = body.messages.map((msg) =>
      msg.role === 'user'
        ? { type: 'user_input', content: [{ type: 'text', text: msg.text }] }
        : { type: 'model_output', content: [{ type: 'text', text: msg.text }] },
    );

    const ai = new GoogleGenAI({ apiKey: key });
    const model = geminiModel();

    if (isCheckGroundingEnabled()) {
      // Buffered verify-before-send mode: evaluate complete answer with CheckGrounding before emitting
      const interaction = await ai.interactions.create({
        model,
        input,
        system_instruction: systemInstruction,
        store: false,
        ...(allowWebSearch ? { tools: [GOOGLE_SEARCH_TOOL] } : {}),
      });

      if (clientDisconnected) return;

      const candidateText = (interaction.output_text || '').trim();
      const citations = extractCitations(interaction.steps);
      const grounding = await checkAnswerGrounding(candidateText, facts);

      const outputText =
        grounding.enabled && !grounding.passed
          ? buildFailClosedFallback(snapshot, intent)
          : candidateText;

      if (outputText) {
        sendEvent({ type: 'chunk', text: outputText });
      }
      if (citations.length > 0) {
        sendEvent({ type: 'citations', citations });
      }
      sendEvent({
        type: 'grounding',
        grounding,
        feedHealth: snapshot.feedHealth,
        intent,
      });
      sendEvent({ type: 'done' });
    } else {
      // Live streaming mode (still uses hardened server-side Fact Ledger + closed-world prompt;
      // no CheckGrounding pass because text is emitted as it arrives).
      const stream = await ai.interactions.create({
        model,
        input,
        system_instruction: systemInstruction,
        store: false,
        stream: true,
        ...(allowWebSearch ? { tools: [GOOGLE_SEARCH_TOOL] } : {}),
      });

      const citationMap = new Map<string, GroundingCitation>();
      const addCitations = (found: GroundingCitation[]) => {
        for (const c of found) {
          if (!citationMap.has(c.uri)) citationMap.set(c.uri, c);
        }
      };

      for await (const event of stream) {
        if (clientDisconnected) break;
        if (event.event_type === 'step.delta') {
          if (event.delta.type === 'text' && event.delta.text) {
            sendEvent({ type: 'chunk', text: event.delta.text });
          } else if (event.delta.type === 'text_annotation_delta') {
            addCitations(annotationsToCitations(event.delta.annotations));
          }
        } else if (event.event_type === 'interaction.completed') {
          addCitations(extractCitations(event.interaction.steps));
        }
      }

      if (!clientDisconnected) {
        const citations = Array.from(citationMap.values());
        if (citations.length > 0) {
          sendEvent({ type: 'citations', citations });
        }
        const disabledReport: BriefingGroundingReport = {
          enabled: false,
          checked: false,
          passed: true,
          supportScore: null,
          threshold: 0.75,
          ungroundedClaims: [],
        };
        sendEvent({
          type: 'grounding',
          grounding: disabledReport,
          feedHealth: snapshot.feedHealth,
          intent,
        });
        sendEvent({ type: 'done' });
      }
    }
  } catch (err: any) {
    const safeErr = redactKey(err, key);
    console.error('Briefing chat error:', safeErr);
    sendEvent({ type: 'error', error: AI_UNAVAILABLE_MESSAGE });
  } finally {
    if (!res.writableEnded) {
      res.end();
    }
  }
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerBriefingRoutes(app: Express): void {
  app.post('/api/briefing/corridor', handleCorridorBriefing);
  app.post('/api/briefing/cyclone', handleCycloneSynthesis);
  app.post('/api/briefing/chat', handleBriefingChat);
}
