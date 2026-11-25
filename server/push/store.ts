/**
 * Persistent push-notification state: subscriptions + alert-dedupe map.
 *
 * Data is stored as a JSON file in `${DATA_DIR}/push-state.json` and written
 * atomically (write-to-temp then rename) so a crash mid-write never corrupts it.
 */
import fs from 'fs';
import path from 'path';
import type { EmergencyFeatureItem } from '../../src/types/weather';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EmergencySeverity = EmergencyFeatureItem['severity'];  // 'info' | 'moderate' | 'high' | 'critical'
export type PushCategory = 'traffic' | 'bom-warnings' | 'gauges';

export interface PushSubscriptionRecord {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  corridorTags: string[];
  categories: PushCategory[];
  minSeverity: EmergencySeverity;
  createdAt: string; // ISO
}

export interface PushState {
  subscriptions: PushSubscriptionRecord[];
  /** Last-seen severity per emergency item id — used for new-item and escalation detection. */
  seenSeverityById: Record<string, EmergencySeverity>;
}

// ---------------------------------------------------------------------------
// File path
// ---------------------------------------------------------------------------

function stateFilePath(): string {
  const dir = process.env.DATA_DIR || './data';
  return path.resolve(dir, 'push-state.json');
}

// ---------------------------------------------------------------------------
// In-memory singleton
// ---------------------------------------------------------------------------

let state: PushState = { subscriptions: [], seenSeverityById: {} };
let loaded = false;

export function getState(): PushState {
  if (!loaded) loadSync();
  return state;
}

// ---------------------------------------------------------------------------
// Load / save
// ---------------------------------------------------------------------------

function loadSync(): void {
  const fp = stateFilePath();
  try {
    if (fs.existsSync(fp)) {
      const raw = fs.readFileSync(fp, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<PushState>;
      state = {
        subscriptions: Array.isArray(parsed.subscriptions) ? parsed.subscriptions : [],
        seenSeverityById: parsed.seenSeverityById && typeof parsed.seenSeverityById === 'object'
          ? parsed.seenSeverityById
          : {},
      };
    }
  } catch {
    // Corrupted file → start fresh
    state = { subscriptions: [], seenSeverityById: {} };
  }
  loaded = true;
}

export function persist(): void {
  const fp = stateFilePath();
  const dir = path.dirname(fp);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${fp}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, fp);
  } catch (err) {
    console.error('[push/store] Failed to persist state:', err);
  }
}

// ---------------------------------------------------------------------------
// Subscription CRUD
// ---------------------------------------------------------------------------

export function upsertSubscription(rec: PushSubscriptionRecord): void {
  const idx = state.subscriptions.findIndex((s) => s.endpoint === rec.endpoint);
  if (idx >= 0) {
    state.subscriptions[idx] = rec;
  } else {
    state.subscriptions.push(rec);
  }
  persist();
}

export function removeSubscription(endpoint: string): boolean {
  const before = state.subscriptions.length;
  state.subscriptions = state.subscriptions.filter((s) => s.endpoint !== endpoint);
  if (state.subscriptions.length !== before) {
    persist();
    return true;
  }
  return false;
}

export function findSubscription(endpoint: string): PushSubscriptionRecord | undefined {
  return state.subscriptions.find((s) => s.endpoint === endpoint);
}

/** Remove a subscription after receiving a 404/410 from the push service. */
export function pruneGone(endpoint: string): void {
  removeSubscription(endpoint);
}

// ---------------------------------------------------------------------------
// Seen-severity helpers
// ---------------------------------------------------------------------------

/** Severity rank: higher number = more severe. */
const SEVERITY_RANK: Record<EmergencySeverity, number> = {
  info: 0,
  moderate: 1,
  high: 2,
  critical: 3,
};

export function severityRank(s: EmergencySeverity): number {
  return SEVERITY_RANK[s] ?? 0;
}

export function meetsMinSeverity(itemSeverity: EmergencySeverity, minSeverity: EmergencySeverity): boolean {
  return severityRank(itemSeverity) >= severityRank(minSeverity);
}

/** Seed the dedupe map from a fresh set of items (first boot). */
export function seedSeen(items: EmergencyFeatureItem[]): void {
  for (const item of items) {
    state.seenSeverityById[item.id] = item.severity;
  }
  persist();
}

/**
 * Check whether an item is "new" or "escalated" compared to the previous poll.
 * Returns the action to take (or null if no notification is warranted).
 * Also updates the seen map (but does NOT persist — caller batches that).
 */
export function checkAndUpdate(item: EmergencyFeatureItem): 'new' | 'escalated' | null {
  const prev = state.seenSeverityById[item.id];
  if (prev === undefined) {
    state.seenSeverityById[item.id] = item.severity;
    return 'new';
  }
  if (severityRank(item.severity) > severityRank(prev)) {
    state.seenSeverityById[item.id] = item.severity;
    return 'escalated';
  }
  // Same or lower severity — update stored severity but don't notify
  state.seenSeverityById[item.id] = item.severity;
  return null;
}
