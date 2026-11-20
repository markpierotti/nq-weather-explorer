/**
 * Shared upstream HTTP + TTL cache helpers for server-side emergency feeds.
 */

/** Honest identifying UA. BOM returns 403 to generic clients (e.g. curl's default UA). */
export const FEED_USER_AGENT = 'NQWeatherExplorer/1.0 (+self-hosted)';

const DEFAULT_TIMEOUT_MS = 15_000;

export class UpstreamError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'UpstreamError';
  }
}

/** Replace any occurrence of the given secrets (and `apikey=` query values) in a message. */
export function redactSecrets(message: string, secrets: Array<string | undefined> = []): string {
  let out = message.replace(/(apikey|api_key|key)=([^&\s"']+)/gi, '$1=[REDACTED]');
  for (const s of secrets) {
    if (s && s.length >= 6) out = out.split(s).join('[REDACTED]');
  }
  return out;
}

export interface FetchTextOptions {
  timeoutMs?: number;
  accept?: string;
  /** Secrets to strip from any error message produced. */
  secrets?: Array<string | undefined>;
  /** Display label used in error messages instead of the URL (avoids leaking query strings). */
  label?: string;
}

/** GET a URL as text with timeout + UA. Throws UpstreamError on non-2xx / network failure. */
export async function fetchText(url: string, opts: FetchTextOptions = {}): Promise<string> {
  const label = opts.label || new URL(url).host;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent': FEED_USER_AGENT,
        Accept: opts.accept || '*/*',
      },
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new UpstreamError(redactSecrets(`${label}: request failed (${msg})`, opts.secrets));
  }
  const body = await res.text();
  if (!res.ok) {
    let detail = '';
    try {
      const j = JSON.parse(body) as { message?: unknown };
      if (typeof j?.message === 'string') detail = `: ${j.message}`;
    } catch {
      /* non-JSON body */
    }
    throw new UpstreamError(
      redactSecrets(`${label}: HTTP ${res.status}${detail}`.slice(0, 400), opts.secrets),
      res.status,
    );
  }
  return body;
}

export async function fetchJson<T = unknown>(url: string, opts: FetchTextOptions = {}): Promise<T> {
  const text = await fetchText(url, { accept: 'application/json', ...opts });
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new UpstreamError(`${opts.label || new URL(url).host}: invalid JSON response`);
  }
}

// ---------------------------------------------------------------------------
// TTL cache with stale-on-error
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  value: T;
  fetchedAt: number;
}

const cacheStore = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<CacheEntry<unknown>>>();

export interface CachedResult<T> {
  value: T;
  fromCache: boolean;
  fetchedAt: number;
  /** Set when the upstream refresh failed and a stale cached value was served instead. */
  staleError?: string;
}

/**
 * Return a cached value if younger than ttlMs, else call fn(). Concurrent callers share one
 * in-flight request. On failure, serve the stale cached value (with staleError) if present,
 * otherwise rethrow.
 */
export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<CachedResult<T>> {
  const hit = cacheStore.get(key) as CacheEntry<T> | undefined;
  if (hit && Date.now() - hit.fetchedAt < ttlMs) {
    return { value: hit.value, fromCache: true, fetchedAt: hit.fetchedAt };
  }

  let pending = inflight.get(key) as Promise<CacheEntry<T>> | undefined;
  if (!pending) {
    pending = (async () => {
      const value = await fn();
      const entry: CacheEntry<T> = { value, fetchedAt: Date.now() };
      cacheStore.set(key, entry);
      return entry;
    })();
    inflight.set(key, pending);
    pending.then(
      () => inflight.delete(key),
      () => inflight.delete(key),
    );
  }

  try {
    const entry = await pending;
    return { value: entry.value, fromCache: false, fetchedAt: entry.fetchedAt };
  } catch (err) {
    const stale = cacheStore.get(key) as CacheEntry<T> | undefined;
    if (stale) {
      return {
        value: stale.value,
        fromCache: true,
        fetchedAt: stale.fetchedAt,
        staleError: err instanceof Error ? err.message : String(err),
      };
    }
    throw err;
  }
}

/** Run async tasks with a small concurrency limit (be polite to upstreams). */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}
