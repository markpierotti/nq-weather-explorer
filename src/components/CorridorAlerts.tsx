/**
 * Corridor Alerts — compact push-notification toggle + filter drawer.
 *
 * Shows a toggle to enable/disable push alerts, corridor tag + category +
 * severity selectors, and a Test Alert button. Hides cleanly when the server
 * reports push is unavailable or PushManager is unsupported.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bell,
  BellOff,
  BellRing,
  ChevronDown,
  ChevronUp,
  Send,
  CheckCircle2,
  XCircle,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PushCategory = 'traffic' | 'bom-warnings' | 'gauges';
type EmergencySeverity = 'info' | 'moderate' | 'high' | 'critical';

interface PushConfig {
  enabled: boolean;
  publicKey?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CORRIDOR_TAGS = [
  'Bruce Hwy',
  'Burdekin',
  'Ayr',
  'Home Hill',
  'Giru',
  'Haughton',
  'Townsville',
  'Ross River',
  'Alligator Creek',
  'Brandon',
] as const;

const CATEGORIES: Array<{ id: PushCategory; label: string }> = [
  { id: 'traffic', label: 'QLDTraffic' },
  { id: 'bom-warnings', label: 'BOM Warnings' },
  { id: 'gauges', label: 'River Gauges' },
];

const SEVERITIES: Array<{ id: EmergencySeverity; label: string; color: string }> = [
  { id: 'critical', label: 'Critical only', color: 'text-[#ff3b30]' },
  { id: 'high', label: 'High +', color: 'text-[#ff9500]' },
  { id: 'moderate', label: 'Moderate +', color: 'text-[#ffcc00]' },
  { id: 'info', label: 'All', color: 'text-white/70' },
];

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) output[i] = rawData.charCodeAt(i);
  return output;
}

// ---------------------------------------------------------------------------
// Storage keys (localStorage)
// ---------------------------------------------------------------------------

const LS_TAGS = 'push_corridorTags';
const LS_CATS = 'push_categories';
const LS_SEV = 'push_minSeverity';

function loadTags(): string[] {
  try { return JSON.parse(localStorage.getItem(LS_TAGS) || '[]'); } catch { return []; }
}
function loadCats(): PushCategory[] {
  try {
    const v = JSON.parse(localStorage.getItem(LS_CATS) || 'null');
    return Array.isArray(v) ? v : ['traffic', 'bom-warnings', 'gauges'];
  } catch { return ['traffic', 'bom-warnings', 'gauges']; }
}
function loadSev(): EmergencySeverity {
  const v = localStorage.getItem(LS_SEV);
  return (['info', 'moderate', 'high', 'critical'] as const).includes(v as EmergencySeverity)
    ? (v as EmergencySeverity)
    : 'moderate';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CorridorAlerts() {
  // Server config
  const [config, setConfig] = useState<PushConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);

  // Subscription state
  const [subscribed, setSubscribed] = useState(false);
  const [subscribing, setSubscribing] = useState(false);

  // Filters
  const [corridorTags, setCorridorTags] = useState<string[]>(loadTags);
  const [categories, setCategories] = useState<PushCategory[]>(loadCats);
  const [minSeverity, setMinSeverity] = useState<EmergencySeverity>(loadSev);

  // UI
  const [expanded, setExpanded] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'sending' | 'ok' | 'fail'>('idle');

  // Browser support
  const pushSupported = useMemo(
    () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window,
    [],
  );

  // Fetch push config from server
  useEffect(() => {
    fetch('/api/push/config')
      .then((r) => r.json())
      .then((c: PushConfig) => setConfig(c))
      .catch(() => setConfig({ enabled: false }))
      .finally(() => setConfigLoading(false));
  }, []);

  // Check if already subscribed
  useEffect(() => {
    if (!pushSupported || !config?.enabled) return;
    navigator.serviceWorker.ready.then((reg) =>
      reg.pushManager.getSubscription().then((sub) => {
        setSubscribed(!!sub);
      }),
    );
  }, [pushSupported, config]);

  // Persist filter changes
  useEffect(() => { localStorage.setItem(LS_TAGS, JSON.stringify(corridorTags)); }, [corridorTags]);
  useEffect(() => { localStorage.setItem(LS_CATS, JSON.stringify(categories)); }, [categories]);
  useEffect(() => { localStorage.setItem(LS_SEV, minSeverity); }, [minSeverity]);

  // Subscribe / unsubscribe
  const toggleSubscription = useCallback(async () => {
    if (!config?.enabled || !config.publicKey || subscribing) return;
    setSubscribing(true);

    try {
      // Register service worker
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;

      if (subscribed) {
        // Unsubscribe
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await fetch('/api/push/subscribe', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: sub.endpoint }),
          });
          await sub.unsubscribe();
        }
        setSubscribed(false);
      } else {
        // Subscribe
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(config.publicKey),
        });
        const json = sub.toJSON();
        await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subscription: {
              endpoint: sub.endpoint,
              keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
            },
            corridorTags,
            categories,
            minSeverity,
          }),
        });
        setSubscribed(true);
      }
    } catch (err) {
      console.error('[CorridorAlerts] subscription toggle failed:', err);
    } finally {
      setSubscribing(false);
    }
  }, [config, subscribed, subscribing, corridorTags, categories, minSeverity]);

  // Update server-side filters when changed while subscribed
  useEffect(() => {
    if (!subscribed || !config?.enabled || !config.publicKey) return;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => {
        if (!sub) return;
        const json = sub.toJSON();
        fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subscription: {
              endpoint: sub.endpoint,
              keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
            },
            corridorTags,
            categories,
            minSeverity,
          }),
        });
      });
  }, [subscribed, config, corridorTags, categories, minSeverity]);

  // Send test notification
  const sendTest = useCallback(async () => {
    if (testStatus === 'sending') return;
    setTestStatus('sending');
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) { setTestStatus('fail'); return; }
      const res = await fetch('/api/push/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
      setTestStatus(res.ok ? 'ok' : 'fail');
    } catch {
      setTestStatus('fail');
    }
    setTimeout(() => setTestStatus('idle'), 3000);
  }, [testStatus]);

  // Toggle helpers
  const toggleTag = (tag: string) =>
    setCorridorTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]);

  const toggleCategory = (cat: PushCategory) =>
    setCategories((prev) => prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // Hide completely when unavailable
  if (configLoading) return null;
  if (!config?.enabled || !pushSupported) {
    return null;
  }

  return (
    <div className="ios-bento-card overflow-hidden">
      {/* Header toggle */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full min-h-11 lg:min-h-0 px-3.5 py-2.5 flex items-center gap-2 text-xs cursor-pointer hover:bg-white/5 transition-colors"
      >
        {subscribed ? (
          <BellRing className="w-4 h-4 text-[#34c759] shrink-0" />
        ) : (
          <BellOff className="w-4 h-4 text-white/60 shrink-0" />
        )}
        <span className="flex-1 text-left font-semibold text-white">
          Corridor Alerts
        </span>
        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
          subscribed
            ? 'bg-[#34c759]/20 text-[#34c759]'
            : 'bg-white/10 text-white/60'
        }`}>
          {subscribed ? 'ON' : 'OFF'}
        </span>
        {expanded ? (
          <ChevronUp className="w-3.5 h-3.5 text-white/60" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-white/60" />
        )}
      </button>

      {expanded && (
        <div className="px-3.5 pb-3.5 pt-1 border-t border-white/10 space-y-3">
          {/* Subscribe toggle */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-white/70">
              {subscribed ? 'Push notifications enabled' : 'Enable push notifications'}
            </span>
            <button
              type="button"
              onClick={toggleSubscription}
              disabled={subscribing}
              className={`min-h-9 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer ${
                subscribed
                  ? 'bg-[#ff3b30]/20 border border-[#ff3b30]/40 text-[#ff3b30] hover:bg-[#ff3b30]/30'
                  : 'bg-[#34c759]/20 border border-[#34c759]/40 text-[#34c759] hover:bg-[#34c759]/30'
              } ${subscribing ? 'opacity-50' : ''}`}
            >
              {subscribing ? '…' : subscribed ? 'Turn Off' : 'Turn On'}
            </button>
          </div>

          {subscribed && (
            <>
              {/* Corridor Tags */}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-white/60 font-mono mb-1.5">
                  Corridor Tags {corridorTags.length === 0 && <span className="text-white/60">(all corridor items)</span>}
                </div>
                <div className="flex flex-wrap gap-1">
                  {CORRIDOR_TAGS.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => toggleTag(tag)}
                      className={`min-h-8 lg:min-h-0 px-2 py-1 rounded-md text-[10px] font-medium border transition-colors cursor-pointer ${
                        corridorTags.includes(tag)
                          ? 'bg-[#ff9500]/20 border-[#ff9500]/40 text-[#ff9500]'
                          : 'bg-white/[0.06] border-white/10 text-white/60 hover:text-white/70'
                      }`}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>

              {/* Categories */}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-white/60 font-mono mb-1.5">
                  Categories
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {CATEGORIES.map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => toggleCategory(cat.id)}
                      className={`min-h-8 lg:min-h-0 px-2.5 py-1 rounded-md text-[10px] font-medium border transition-colors cursor-pointer ${
                        categories.includes(cat.id)
                          ? 'bg-[#32ADE6]/20 border-[#32ADE6]/40 text-[#32ADE6]'
                          : 'bg-white/[0.06] border-white/10 text-white/60 hover:text-white/70'
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Min Severity */}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-white/60 font-mono mb-1.5">
                  Minimum Severity
                </div>
                <div className="flex gap-1.5">
                  {SEVERITIES.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setMinSeverity(s.id)}
                      className={`min-h-8 lg:min-h-0 px-2.5 py-1 rounded-md text-[10px] font-medium border transition-colors cursor-pointer ${
                        minSeverity === s.id
                          ? `bg-white/15 border-white/30 ${s.color} font-semibold`
                          : 'bg-white/[0.06] border-white/10 text-white/60 hover:text-white/70'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Test Alert */}
              <button
                type="button"
                onClick={sendTest}
                disabled={testStatus === 'sending'}
                className="w-full min-h-9 px-3 py-1.5 rounded-lg bg-white/10 border border-white/15 text-[11px] font-medium text-white/80 hover:bg-white/15 transition-colors cursor-pointer flex items-center justify-center gap-1.5"
              >
                {testStatus === 'sending' ? (
                  <>Sending…</>
                ) : testStatus === 'ok' ? (
                  <><CheckCircle2 className="w-3.5 h-3.5 text-[#34c759]" /> Sent!</>
                ) : testStatus === 'fail' ? (
                  <><XCircle className="w-3.5 h-3.5 text-[#ff3b30]" /> Failed</>
                ) : (
                  <><Send className="w-3.5 h-3.5" /> Send Test Alert</>
                )}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
