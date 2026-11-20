/**
 * QLDTraffic road events (TMR) -> EmergencyFeatureItem[].
 *
 * Endpoint + auth per the official "qldtraffic.qld.gov.au API specification" v1.10 (19-02-2025),
 * linked from https://qldtraffic.qld.gov.au/more/Developers-and-Data/ :
 *   https://qldtraffic.qld.gov.au/media/moreDevelopers-and-Data/qldtraffic-website-api-specification-v1-10.pdf
 *   - GET https://api.qldtraffic.qld.gov.au/v2/events?apikey=KEY  (GeoJSON FeatureCollection)
 *   - Section 2.1.1.1 publishes a shared public key, "globally limited to 100 requests/minute"
 *     across ALL users of that key, so it is frequently over quota (HTTP 429). Register a
 *     personal key (email qldtraffic@tmr.qld.gov.au) and set QLDTRAFFIC_API_KEY.
 *   - Data licence: CC BY 4.0 AU (attribute "State of Queensland (Department of Transport and Main Roads)").
 */
import type { EmergencyFeatureItem, LatLng, TrafficEventDetail } from '../../src/types/weather';
import { fetchJson } from './http';
import { distanceToCorridorKm, inNqBbox, matchCorridorTags } from './geo';

const EVENTS_URL = 'https://api.qldtraffic.qld.gov.au/v2/events';
/** Public key from section 2.1.1.1 of the official spec (see header comment). */
const QLDTRAFFIC_PUBLIC_KEY = '3e83add325cbb69ac4d8e5bf433d770b';

export function qldTrafficApiKey(): string {
  return process.env.QLDTRAFFIC_API_KEY?.trim() || QLDTRAFFIC_PUBLIC_KEY;
}

// --- Raw upstream shapes (only the fields we use) ---------------------------
interface RawGeometry {
  type: string;
  coordinates?: unknown;
  geometries?: RawGeometry[];
}
interface RawImpact {
  direction?: string | null;
  towards?: string | null;
  impact_type?: string | null;
  impact_subtype?: string | null;
  delay?: string | null;
}
interface RawEventProps {
  id: number | string;
  status?: string | null;
  published?: string | null;
  event_type?: string | null;
  event_subtype?: string | null;
  event_due_to?: string | null;
  impact?: RawImpact | null;
  duration?: { start?: string | null; end?: string | null } | null;
  event_priority?: string | null;
  description?: string | null;
  advice?: string | null;
  information?: string | null;
  road_summary?: {
    road_name?: string | null;
    locality?: string | null;
    local_government_area?: string | null;
    district?: string | null;
  } | null;
  last_updated?: string | null;
  web_link?: string | null;
  area_alert?: boolean | null;
  alert_message?: string | null;
}
interface RawFeature {
  type: 'Feature';
  geometry: RawGeometry | null;
  properties: RawEventProps;
}
interface RawCollection {
  type: 'FeatureCollection';
  features?: RawFeature[];
}

// --- Geometry helpers --------------------------------------------------------
function toLatLng(c: unknown): LatLng | null {
  if (Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number') {
    return { lat: c[1], lng: c[0] };
  }
  return null;
}

function lineToPath(coords: unknown): LatLng[] {
  if (!Array.isArray(coords)) return [];
  return coords.map(toLatLng).filter((p): p is LatLng => p !== null);
}

interface ParsedGeometry {
  points: LatLng[];
  lines: LatLng[][];
  /** Every coordinate (incl. area polygons), used for the bbox test. */
  all: LatLng[];
}

function parseGeometry(geom: RawGeometry | null, hasAreaAlert: boolean): ParsedGeometry {
  const out: ParsedGeometry = { points: [], lines: [], all: [] };
  if (!geom) return out;
  const parts = geom.type === 'GeometryCollection' ? geom.geometries || [] : [geom];
  parts.forEach((g, idx) => {
    // Spec v1.10: when area_alert is true, the LAST geometry is the area-alert polygon.
    const isAreaAlert = hasAreaAlert && idx === parts.length - 1;
    switch (g.type) {
      case 'Point': {
        const p = toLatLng(g.coordinates);
        if (p) {
          out.all.push(p);
          if (!isAreaAlert) out.points.push(p);
        }
        break;
      }
      case 'LineString': {
        const l = lineToPath(g.coordinates);
        out.all.push(...l);
        if (!isAreaAlert && l.length) out.lines.push(l);
        break;
      }
      case 'MultiLineString': {
        for (const c of Array.isArray(g.coordinates) ? g.coordinates : []) {
          const l = lineToPath(c);
          out.all.push(...l);
          if (!isAreaAlert && l.length) out.lines.push(l);
        }
        break;
      }
      case 'Polygon':
      case 'MultiPolygon': {
        const flat = JSON.stringify(g.coordinates ?? []).match(/-?\d+(\.\d+)?/g)?.map(Number) || [];
        for (let i = 0; i + 1 < flat.length; i += 2) out.all.push({ lat: flat[i + 1], lng: flat[i] });
        break;
      }
      default:
        break;
    }
  });
  return out;
}

function representativePoint(g: ParsedGeometry): LatLng | null {
  if (g.points.length) return g.points[0];
  if (g.lines.length) {
    const l = g.lines[0];
    return l[Math.floor(l.length / 2)];
  }
  return g.all[0] ?? null;
}

// --- Severity ----------------------------------------------------------------
function isClosure(impact: RawImpact | null | undefined): boolean {
  const t = (impact?.impact_type || '').toLowerCase();
  const st = (impact?.impact_subtype || '').toLowerCase();
  return t === 'closures' || st.startsWith('road closed');
}

function trafficSeverity(p: RawEventProps, closure: boolean): EmergencyFeatureItem['severity'] {
  const type = (p.event_type || '').toLowerCase();
  const priority = (p.event_priority || '').toLowerCase();
  const reopened = (p.status || '').toLowerCase() === 'reopened';
  if (reopened) return 'info';
  if (type === 'flooding') return closure || priority === 'red alert' ? 'critical' : 'high';
  if (priority === 'red alert') return 'critical';
  if (closure) return type === 'roadworks' || type === 'special event' ? 'high' : 'critical';
  if (priority === 'high') return 'high';
  if (type === 'crash') return 'high';
  if (type === 'hazard') return 'moderate';
  if (type === 'roadworks' && priority === 'medium') return 'moderate';
  return 'info';
}

function clean(s: string | null | undefined): string | undefined {
  const t = (s || '').trim();
  return t && t !== 'N/A' ? t : undefined;
}

function mapFeature(f: RawFeature): EmergencyFeatureItem | null {
  const p = f.properties;
  if (!p || p.id === undefined || p.id === null) return null;
  const geom = parseGeometry(f.geometry, Boolean(p.area_alert));
  if (!geom.all.some((c) => inNqBbox(c.lat, c.lng))) return null;

  const pt = representativePoint(geom);
  const closure = isClosure(p.impact);
  const road = clean(p.road_summary?.road_name);
  const locality = clean(p.road_summary?.locality);
  const eventType = clean(p.event_type) || 'Event';
  const subtype = clean(p.event_subtype);
  const impactText = clean(p.impact?.impact_subtype) || clean(p.impact?.impact_type);

  const traffic: TrafficEventDetail = {
    eventId: String(p.id),
    eventType,
    eventSubtype: subtype,
    impact: impactText,
    isClosure: closure,
    roadName: road,
    locality,
  };

  const text = [road, locality, p.road_summary?.local_government_area, p.description, p.information]
    .filter(Boolean)
    .join(' ');
  const tags = matchCorridorTags(text);
  const nearCorridor = [pt, ...geom.lines.flat()].some((c) => c && distanceToCorridorKm(c) <= 3);
  if (nearCorridor && /\bbruce\b/i.test(road || '') && !tags.includes('Bruce Hwy')) tags.unshift('Bruce Hwy');
  if (nearCorridor && !tags.length) tags.push('Corridor');

  const descParts = [clean(p.description), clean(p.advice), clean(p.information), clean(p.alert_message)];
  const geometryType: EmergencyFeatureItem['geometryType'] =
    geom.lines.length > 1 ? 'MultiLineString' : geom.lines.length === 1 ? 'LineString' : geom.points.length ? 'Point' : 'None';

  return {
    id: `qldtraffic-${p.id}`,
    category: 'traffic',
    source: 'qldtraffic',
    sourceLabel: 'QLDTraffic (TMR)',
    title: `${eventType}${subtype ? ` – ${subtype}` : ''}${road ? `: ${road}` : ''}`,
    subtitle: [locality, impactText, clean(p.impact?.direction)].filter(Boolean).join(' · ') || undefined,
    description: descParts.filter(Boolean).join('\n') || undefined,
    status: closure ? 'Closed' : clean(p.status),
    severity: trafficSeverity(p, closure),
    lat: pt?.lat ?? null,
    lng: pt?.lng ?? null,
    geometryType,
    pathCoords: geom.lines.length ? geom.lines : undefined,
    updatedAt: p.last_updated || p.published || undefined,
    isCorridorPriority: nearCorridor || tags.length > 0,
    corridorTags: tags,
    rawProperties: {
      event_priority: p.event_priority ?? null,
      event_due_to: p.event_due_to ?? null,
      delay: p.impact?.delay ?? null,
      start: p.duration?.start ?? null,
      end: p.duration?.end ?? null,
      district: p.road_summary?.district ?? null,
      web_link: p.web_link ?? null,
    },
    traffic,
  };
}

/** Fetch current QLDTraffic events within the NQ bbox. Throws on upstream failure. */
export async function fetchTrafficEvents(): Promise<EmergencyFeatureItem[]> {
  const key = qldTrafficApiKey();
  const url = `${EVENTS_URL}?apikey=${encodeURIComponent(key)}`;
  const data = await fetchJson<RawCollection>(url, {
    label: 'QLDTraffic v2/events',
    secrets: [key],
    timeoutMs: 20_000,
  });
  const features = Array.isArray(data?.features) ? data.features : [];
  return features.map(mapFeature).filter((x): x is EmergencyFeatureItem => x !== null);
}
