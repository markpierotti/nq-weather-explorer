/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TrackerSummaryResponse } from '../types/weather';

const TTL_MS = 30 * 60_000;
let cache: { at: number; promise: Promise<TrackerSummaryResponse | null> } | null = null;

/** Forecast track record from the server (server/tracker). Null if unavailable; shared across callers. */
export function fetchTrackerSummary(): Promise<TrackerSummaryResponse | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.promise;
  const promise = fetch('/api/tracker/summary?days=60', { signal: AbortSignal.timeout(15000) })
    .then((r) => (r.ok ? (r.json() as Promise<TrackerSummaryResponse>) : null))
    .then((d) => (d && Array.isArray(d.sites) ? d : null))
    .catch(() => null);
  cache = { at: Date.now(), promise };
  promise.then((d) => {
    if (!d) cache = null; // retry next time rather than caching a failure
  });
  return promise;
}
