/**
 * Server-side emergency data feeds (QLDTraffic, BOM QLD warnings, river gauges).
 *
 * Fetchers live in sibling modules and return EmergencyFeatureItem[] (see src/types/weather.ts).
 * They are reused by the push poller (server/push), so keep them free of Express concerns.
 *
 * Routes (all GET, response = EmergencyFeedResponse):
 *   /api/emergency/traffic       TTL 3 min
 *   /api/emergency/bom-warnings  TTL 3 min
 *   /api/emergency/gauges        TTL 5 min
 * Upstream failures return HTTP 200 with `items: []` and `error` set (or stale cached items plus
 * `error` if a previous fetch succeeded), so the client can render per-feed status.
 */
import type { Express } from 'express';
import type { EmergencyFeatureItem, EmergencyFeedResponse } from '../../src/types/weather';
import { cached, redactSecrets, type CachedResult } from './http';
import { fetchTrafficEvents, qldTrafficApiKey } from './qldtraffic';
import { fetchBomWarnings } from './bomWarnings';
import { fetchRiverGauges } from './gauges';

export { fetchTrafficEvents } from './qldtraffic';
export { fetchBomWarnings } from './bomWarnings';
export { fetchRiverGauges } from './gauges';
export { cached } from './http';

type FeedName = EmergencyFeedResponse['feed'];

export const FEED_TTL_MS: Record<FeedName, number> = {
  traffic: 3 * 60 * 1000,
  'bom-warnings': 3 * 60 * 1000,
  gauges: 5 * 60 * 1000,
};

const FETCHERS: Record<FeedName, () => Promise<EmergencyFeatureItem[]>> = {
  traffic: fetchTrafficEvents,
  'bom-warnings': fetchBomWarnings,
  gauges: fetchRiverGauges,
};

/** Cached fetch shared by the HTTP routes and the push poller (same cache keys). */
export function getFeedCached(feed: FeedName): Promise<CachedResult<EmergencyFeatureItem[]>> {
  return cached(`feed:${feed}`, FEED_TTL_MS[feed], FETCHERS[feed]);
}

/** Build an EmergencyFeedResponse; never throws. */
export async function getFeedResponse(feed: FeedName): Promise<EmergencyFeedResponse> {
  try {
    const r = await getFeedCached(feed);
    const res: EmergencyFeedResponse = { feed, items: r.value, fetchedAt: r.fetchedAt, fromCache: r.fromCache };
    if (r.staleError) res.error = `Serving cached data; refresh failed: ${redactSecrets(r.staleError, [qldTrafficApiKey()])}`;
    return res;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    let error = redactSecrets(msg, [qldTrafficApiKey()]);
    if (feed === 'traffic' && /HTTP 429/.test(msg) && !process.env.QLDTRAFFIC_API_KEY) {
      error += ' (the shared public QLDTraffic key is over its global quota; set QLDTRAFFIC_API_KEY to a registered key)';
    }
    return { feed, items: [], fetchedAt: Date.now(), fromCache: false, error };
  }
}

export function registerFeedRoutes(app: Express): void {
  const route = (path: string, feed: FeedName) =>
    app.get(path, async (_req, res) => {
      const body = await getFeedResponse(feed);
      if (body.error) console.warn(`[feeds] ${feed}: ${body.error}`);
      res.setHeader('Cache-Control', 'no-store');
      res.json(body);
    });
  route('/api/emergency/traffic', 'traffic');
  route('/api/emergency/bom-warnings', 'bom-warnings');
  route('/api/emergency/gauges', 'gauges');
}
