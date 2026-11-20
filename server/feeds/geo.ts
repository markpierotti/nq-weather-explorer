/**
 * Region-of-interest + Ayr <-> Townsville (Bruce Hwy) corridor helpers shared by the feeds.
 */
import type { LatLng } from '../../src/types/weather';

/** North Queensland bbox (matches the existing ArcGIS feed queries). */
export const NQ_BBOX = { minLng: 145.5, maxLng: 148.6, minLat: -21.2, maxLat: -17.8 } as const;

export function inNqBbox(lat: number, lng: number): boolean {
  return lng >= NQ_BBOX.minLng && lng <= NQ_BBOX.maxLng && lat >= NQ_BBOX.minLat && lat <= NQ_BBOX.maxLat;
}

/** Bruce Hwy corridor vertices, Home Hill -> Ayr -> Giru -> Townsville. */
const CORRIDOR_PATH: LatLng[] = [
  { lat: -19.66, lng: 147.415 }, // Home Hill
  { lat: -19.574, lng: 147.406 }, // Ayr
  { lat: -19.555, lng: 147.358 }, // Brandon
  { lat: -19.538, lng: 147.245 }, // Shirbourne
  { lat: -19.514, lng: 147.106 }, // Giru / Haughton River
  { lat: -19.445, lng: 147.008 }, // Woodstock turnoff
  { lat: -19.372, lng: 146.935 }, // Alligator Creek
  { lat: -19.333, lng: 146.885 }, // Nome
  { lat: -19.295, lng: 146.835 }, // Cluden / Stuart
  { lat: -19.259, lng: 146.817 }, // Townsville
];

function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Approx distance (km) from a point to the corridor polyline (equirectangular projection; fine at this scale). */
export function distanceToCorridorKm(p: LatLng): number {
  const kx = 111.32 * Math.cos((p.lat * Math.PI) / 180);
  const ky = 110.57;
  let best = Infinity;
  for (let i = 0; i < CORRIDOR_PATH.length - 1; i++) {
    const a = CORRIDOR_PATH[i];
    const b = CORRIDOR_PATH[i + 1];
    const ax = (a.lng - p.lng) * kx;
    const ay = (a.lat - p.lat) * ky;
    const bx = (b.lng - p.lng) * kx;
    const by = (b.lat - p.lat) * ky;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    best = Math.min(best, Math.sqrt(cx * cx + cy * cy));
  }
  return best;
}

export { haversineKm };

/** Keyword tags for corridor-relevant text (word-boundary matched). */
const TAG_RULES: Array<{ tag: string; re: RegExp }> = [
  { tag: 'Bruce Hwy', re: /\bbruce\s+h(igh)?wa?y\b/i },
  { tag: 'Ayr', re: /\bayr\b/i },
  { tag: 'Home Hill', re: /\bhome\s+hill\b/i },
  { tag: 'Brandon', re: /\bbrandon\b/i },
  { tag: 'Giru', re: /\bgiru\b/i },
  { tag: 'Haughton', re: /\bhaughton\b/i },
  { tag: 'Burdekin', re: /\bburdekin\b/i },
  { tag: 'Alligator Creek', re: /\balligator\s+creek\b/i },
  { tag: 'Ross River', re: /\bross\s+river\b/i },
  { tag: 'Townsville', re: /\btownsville\b/i },
];

export function matchCorridorTags(text: string): string[] {
  const tags: string[] = [];
  for (const { tag, re } of TAG_RULES) if (re.test(text)) tags.push(tag);
  return tags;
}
