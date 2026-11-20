/**
 * Server-side emergency data feeds (QLDTraffic, BOM QLD warnings, river gauges).
 *
 * Fetchers live in sibling modules and return EmergencyFeatureItem[] (see src/types/weather.ts).
 * They are reused by the push poller (server/push), so keep them free of Express concerns.
 */
import type { Express } from 'express';

export function registerFeedRoutes(_app: Express): void {
  // GET /api/emergency/{traffic,bom-warnings,gauges} — implemented in Phase 3.
}
