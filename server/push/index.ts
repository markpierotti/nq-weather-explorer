/**
 * Web Push notifications: subscription management, feed poller and routes (Phase 4).
 *
 * Gracefully degrades when VAPID keys are not configured: config endpoint returns
 * { enabled: false }, subscribe routes return 503, and the poller stays idle.
 */
import type { Express, Request, Response } from 'express';
import type { EmergencyFeatureItem } from '../../src/types/weather';
import { getFeedCached } from '../feeds/index';
import {
  getState,
  upsertSubscription,
  removeSubscription,
  findSubscription,
  pruneGone,
  seedSeen,
  checkAndUpdate,
  persist,
  meetsMinSeverity,
  severityRank,
  type PushSubscriptionRecord,
  type PushCategory,
  type EmergencySeverity,
} from './store';

// ---------------------------------------------------------------------------
// VAPID configuration
// ---------------------------------------------------------------------------

let webPush: typeof import('web-push') | null = null;
let vapidConfigured = false;

function getVapidPublicKey(): string {
  return process.env.VAPID_PUBLIC_KEY || '';
}

function getVapidPrivateKey(): string {
  return process.env.VAPID_PRIVATE_KEY || '';
}

function getVapidSubject(): string {
  return process.env.VAPID_SUBJECT || 'mailto:push@nq-weather.local';
}

async function ensureWebPush(): Promise<boolean> {
  if (vapidConfigured) return true;
  const pub = getVapidPublicKey();
  const priv = getVapidPrivateKey();
  if (!pub || !priv) return false;

  try {
    // Dynamic import so we don't crash if web-push is not installed
    const wp = await import('web-push');
    wp.setVapidDetails(getVapidSubject(), pub, priv);
    webPush = wp;
    vapidConfigured = true;
    return true;
  } catch (err) {
    console.error('[push] Failed to initialise web-push:', err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const VALID_CATEGORIES: PushCategory[] = ['traffic', 'bom-warnings', 'gauges'];
const VALID_SEVERITIES: EmergencySeverity[] = ['info', 'moderate', 'high', 'critical'];

function validateSubscriptionBody(body: any): {
  ok: boolean;
  record?: PushSubscriptionRecord;
  error?: string;
} {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Request body is required' };
  }

  const { subscription, corridorTags, categories, minSeverity } = body;

  // Validate PushSubscription shape
  if (!subscription || typeof subscription !== 'object') {
    return { ok: false, error: 'subscription object is required' };
  }
  const { endpoint, keys } = subscription;
  if (typeof endpoint !== 'string' || !endpoint.startsWith('https://')) {
    return { ok: false, error: 'subscription.endpoint must be an https:// URL' };
  }
  if (!keys || typeof keys !== 'object' || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') {
    return { ok: false, error: 'subscription.keys.p256dh and .auth are required' };
  }

  // Validate filters
  const tags = Array.isArray(corridorTags)
    ? corridorTags.filter((t: unknown) => typeof t === 'string')
    : [];

  const cats = Array.isArray(categories)
    ? categories.filter((c: unknown) => VALID_CATEGORIES.includes(c as PushCategory))
    : VALID_CATEGORIES;

  const sev: EmergencySeverity = VALID_SEVERITIES.includes(minSeverity) ? minSeverity : 'moderate';

  return {
    ok: true,
    record: {
      endpoint,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
      corridorTags: tags,
      categories: cats as PushCategory[],
      minSeverity: sev,
      createdAt: new Date().toISOString(),
    },
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function registerPushRoutes(app: Express): void {
  // GET /api/push/config — always available (tells client whether push is supported)
  app.get('/api/push/config', async (_req: Request, res: Response) => {
    const ready = await ensureWebPush();
    if (!ready) {
      return res.json({ enabled: false });
    }
    return res.json({ enabled: true, publicKey: getVapidPublicKey() });
  });

  // POST /api/push/subscribe — register or update a subscription
  app.post('/api/push/subscribe', async (req: Request, res: Response) => {
    const ready = await ensureWebPush();
    if (!ready) {
      return res.status(503).json({ error: 'Push notifications are not configured. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.' });
    }
    const result = validateSubscriptionBody(req.body);
    if (!result.ok || !result.record) {
      return res.status(400).json({ error: result.error || 'Invalid request' });
    }
    upsertSubscription(result.record);
    return res.json({ ok: true, endpoint: result.record.endpoint });
  });

  // DELETE /api/push/subscribe — unregister a subscription
  app.delete('/api/push/subscribe', async (req: Request, res: Response) => {
    const ready = await ensureWebPush();
    if (!ready) {
      return res.status(503).json({ error: 'Push notifications are not configured. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.' });
    }
    const endpoint = req.body?.endpoint;
    if (typeof endpoint !== 'string' || !endpoint) {
      return res.status(400).json({ error: 'endpoint is required in the request body' });
    }
    const removed = removeSubscription(endpoint);
    return res.json({ ok: true, removed });
  });

  // POST /api/push/test — send a test notification
  app.post('/api/push/test', async (req: Request, res: Response) => {
    const ready = await ensureWebPush();
    if (!ready) {
      return res.status(503).json({ error: 'Push notifications are not configured. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.' });
    }
    const endpoint = req.body?.endpoint;
    if (typeof endpoint !== 'string' || !endpoint) {
      return res.status(400).json({ error: 'endpoint is required in the request body' });
    }
    const sub = findSubscription(endpoint);
    if (!sub) {
      return res.status(404).json({ error: 'No subscription found for this endpoint. Subscribe first.' });
    }
    try {
      await webPush!.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        JSON.stringify({
          title: '🧪 NQ Weather Test Alert',
          body: 'Push notifications are working! You will receive corridor alerts matching your filters.',
          tag: 'test',
          url: '/',
        }),
      );
      return res.json({ ok: true, message: 'Test notification sent' });
    } catch (err: any) {
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        pruneGone(endpoint);
        return res.status(410).json({ error: 'Subscription expired and has been removed. Please re-subscribe.' });
      }
      console.error('[push/test] Send failed:', err?.message || err);
      return res.status(500).json({ error: 'Failed to send test notification' });
    }
  });
}

// ---------------------------------------------------------------------------
// Feed-category mapping
// ---------------------------------------------------------------------------

const FEED_TO_CATEGORY: Record<string, PushCategory> = {
  traffic: 'traffic',
  'bom-warnings': 'bom-warnings',
  gauges: 'gauges',
};

function itemFeedCategory(item: EmergencyFeatureItem): PushCategory | null {
  if (item.category === 'traffic') return 'traffic';
  if (item.category === 'bom_warning') return 'bom-warnings';
  if (item.category === 'river_gauge') return 'gauges';
  return null;
}

// ---------------------------------------------------------------------------
// Notification dispatch
// ---------------------------------------------------------------------------

function notificationPayload(item: EmergencyFeatureItem, reason: 'new' | 'escalated'): string {
  const prefix = reason === 'escalated' ? '⬆️ Escalated' : '🚨 New';
  const tagStr = item.corridorTags.length ? ` [${item.corridorTags.join(', ')}]` : '';
  return JSON.stringify({
    title: `${prefix}: ${item.title}`,
    body: `${item.subtitle || item.description || item.sourceLabel}${tagStr}`,
    tag: item.id,
    url: '/?tab=emergency',
    severity: item.severity,
  });
}

async function sendToSubscriber(sub: PushSubscriptionRecord, payload: string): Promise<void> {
  if (!webPush) return;
  try {
    await webPush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload);
  } catch (err: any) {
    if (err?.statusCode === 404 || err?.statusCode === 410) {
      pruneGone(sub.endpoint);
    } else {
      console.warn(`[push] Send failed for ${sub.endpoint.slice(0, 60)}…:`, err?.message || err);
    }
  }
}

function subscriberMatches(sub: PushSubscriptionRecord, item: EmergencyFeatureItem): boolean {
  // Category filter
  const feedCat = itemFeedCategory(item);
  if (feedCat && !sub.categories.includes(feedCat)) return false;

  // Severity filter
  if (!meetsMinSeverity(item.severity, sub.minSeverity)) return false;

  // Corridor tag filter: empty corridorTags on sub = all corridor-priority items
  if (sub.corridorTags.length === 0) {
    // Show all corridor-priority items
    return item.isCorridorPriority;
  }
  // Specific tags: at least one must match
  return sub.corridorTags.some((tag) => item.corridorTags.includes(tag));
}

// ---------------------------------------------------------------------------
// Background poller
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes
let pollerTimer: ReturnType<typeof setInterval> | null = null;
let isFirstPoll = true;

async function poll(): Promise<void> {
  try {
    const [trafficResult, bomResult, gaugeResult] = await Promise.all([
      getFeedCached('traffic'),
      getFeedCached('bom-warnings'),
      getFeedCached('gauges'),
    ]);

    const allItems: EmergencyFeatureItem[] = [
      ...trafficResult.value,
      ...bomResult.value,
      ...gaugeResult.value,
    ];

    const st = getState();

    // First boot with empty dedupe map → seed without spamming
    if (isFirstPoll && Object.keys(st.seenSeverityById).length === 0) {
      console.log(`[push] First poll: seeding ${allItems.length} items into dedupe map (no notifications)`);
      seedSeen(allItems);
      isFirstPoll = false;
      return;
    }
    isFirstPoll = false;

    // Check for new / escalated items
    const notifications: Array<{ item: EmergencyFeatureItem; reason: 'new' | 'escalated' }> = [];
    for (const item of allItems) {
      const result = checkAndUpdate(item);
      if (result) {
        notifications.push({ item, reason: result });
      }
    }
    persist(); // batch-persist the dedupe map

    if (notifications.length === 0) return;

    // Dispatch to matching subscribers
    const subs = st.subscriptions;
    if (subs.length === 0) return;

    let sent = 0;
    for (const { item, reason } of notifications) {
      const payload = notificationPayload(item, reason);
      for (const sub of subs) {
        if (subscriberMatches(sub, item)) {
          await sendToSubscriber(sub, payload);
          sent++;
        }
      }
    }
    if (sent > 0) {
      console.log(`[push] Dispatched ${sent} notification(s) for ${notifications.length} alert(s)`);
    }
  } catch (err) {
    console.error('[push] Poll error:', err);
  }
}

export function startPushPoller(): void {
  ensureWebPush().then((ready) => {
    if (!ready) {
      console.log('[push] VAPID keys not configured — push poller is idle. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY to enable.');
      return;
    }
    console.log('[push] Push poller started (interval: 3 min)');
    // Run first poll immediately
    poll();
    pollerTimer = setInterval(poll, POLL_INTERVAL_MS);
  });
}
