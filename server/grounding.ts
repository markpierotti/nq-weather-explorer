/**
 * Optional Discovery Engine (Agent Search / GenAI App Builder) CheckGrounding verifier.
 *
 * Calls:
 *   POST https://discoveryengine.googleapis.com/v1/projects/{GCP_PROJECT_ID}/locations/global/groundingConfigs/default_grounding_config:check
 *
 * Activated only when ENABLE_CHECK_GROUNDING=true and GCP_PROJECT_ID is configured.
 * Authenticates via either:
 *   1) GCP_ACCESS_TOKEN (useful for quick local smoke tests via `gcloud auth print-access-token`)
 *   2) GOOGLE_APPLICATION_CREDENTIALS pointing to a GCP service account JSON key
 *      (signed with Node's built-in crypto module — zero extra npm dependencies).
 */
import crypto from 'crypto';
import fs from 'fs';
import type { BriefingGroundingReport } from '../src/types/weather';

export interface GroundingFactInput {
  factText: string;
  attributes?: Record<string, string>;
}

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

interface CheckGroundingApiClaim {
  claimText?: string;
  groundingCheckRequired?: boolean;
  score?: number;
  citationIndices?: number[];
}

interface CheckGroundingApiResponse {
  supportScore?: number;
  claims?: CheckGroundingApiClaim[];
}

const DEFAULT_THRESHOLD = 0.75;
const MAX_FACTS = 200;
const MAX_FACT_CHARS = 9500;
const OAUTH_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

let cachedToken: { token: string; expiresAtMs: number } | null = null;

export function isCheckGroundingEnabled(): boolean {
  const flag = (process.env.ENABLE_CHECK_GROUNDING || '').trim().toLowerCase();
  const projectId = (process.env.GCP_PROJECT_ID || '').trim();
  return (flag === 'true' || flag === '1') && projectId.length > 0;
}

function base64Url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/** Access token for the attached service account when running on Google Cloud; null elsewhere. */
async function metadataToken(): Promise<{ token: string; expiresAtMs: number } | null> {
  try {
    const res = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(2000) },
    );
    if (!res.ok) return null;
    const j = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!j.access_token) return null;
    return { token: j.access_token, expiresAtMs: Date.now() + (j.expires_in ?? 300) * 1000 };
  } catch {
    return null;
  }
}

async function getAccessToken(): Promise<string> {
  const staticToken = (process.env.GCP_ACCESS_TOKEN || '').trim();
  if (staticToken) return staticToken;

  if (cachedToken && Date.now() < cachedToken.expiresAtMs - 60_000) {
    return cachedToken.token;
  }

  const credPath = (process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim();
  if (!credPath) {
    // On Google Cloud (e.g. Cloud Run), use the attached service account via the metadata server.
    const meta = await metadataToken();
    if (meta) {
      cachedToken = meta;
      return meta.token;
    }
    throw new Error(
      'Missing GCP_ACCESS_TOKEN or GOOGLE_APPLICATION_CREDENTIALS for Discovery Engine CheckGrounding.',
    );
  }

  const raw = fs.readFileSync(credPath, 'utf8');
  const key = JSON.parse(raw) as ServiceAccountKey;
  if (!key.client_email || !key.private_key) {
    throw new Error('GOOGLE_APPLICATION_CREDENTIALS must be a service account JSON key.');
  }

  const tokenUri = key.token_uri || 'https://oauth2.googleapis.com/token';
  const nowSec = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claimSet = base64Url(
    JSON.stringify({
      iss: key.client_email,
      scope: OAUTH_SCOPE,
      aud: tokenUri,
      iat: nowSec,
      exp: nowSec + 3600,
    }),
  );

  const unsignedJwt = `${header}.${claimSet}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsignedJwt);
  signer.end();
  const signature = base64Url(signer.sign(key.private_key));
  const assertion = `${unsignedJwt}.${signature}`;

  const tokenRes = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });

  if (!tokenRes.ok) {
    const errBody = await tokenRes.text().catch(() => '');
    throw new Error(`OAuth token exchange failed (${tokenRes.status}): ${errBody.slice(0, 200)}`);
  }

  const tokenJson = (await tokenRes.json()) as { access_token?: string; expires_in?: number };
  if (!tokenJson.access_token) {
    throw new Error('OAuth token response missing access_token.');
  }

  const ttlMs = Math.max(60, Number(tokenJson.expires_in || 3600)) * 1000;
  cachedToken = { token: tokenJson.access_token, expiresAtMs: Date.now() + ttlMs };
  return tokenJson.access_token;
}

export async function checkAnswerGrounding(
  answerCandidate: string,
  facts: GroundingFactInput[],
  threshold = DEFAULT_THRESHOLD,
): Promise<BriefingGroundingReport> {
  if (!isCheckGroundingEnabled()) {
    return {
      enabled: false,
      checked: false,
      passed: true,
      supportScore: null,
      threshold,
      ungroundedClaims: [],
    };
  }

  const trimmedCandidate = answerCandidate.trim();
  if (!trimmedCandidate || facts.length === 0) {
    return {
      enabled: true,
      checked: false,
      passed: false,
      supportScore: null,
      threshold,
      ungroundedClaims: [],
      error: 'No answer text or live facts available to verify.',
    };
  }

  const projectId = (process.env.GCP_PROJECT_ID || '').trim();
  const location = (process.env.GCP_GROUNDING_LOCATION || 'global').trim();
  const url = `https://discoveryengine.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(location)}/groundingConfigs/default_grounding_config:check`;

  const sanitizedFacts = facts.slice(0, MAX_FACTS).map((f) => ({
    factText: f.factText.slice(0, MAX_FACT_CHARS),
    ...(f.attributes && Object.keys(f.attributes).length > 0 ? { attributes: f.attributes } : {}),
  }));

  try {
    const token = await getAccessToken();
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Goog-User-Project': projectId,
      },
      body: JSON.stringify({
        answerCandidate: trimmedCandidate.slice(0, 14_000),
        facts: sanitizedFacts,
        groundingSpec: {
          citationThreshold: threshold,
          enableClaimLevelScore: true,
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Discovery Engine CheckGrounding HTTP ${res.status}: ${errText.slice(0, 220)}`);
    }

    const data = (await res.json()) as CheckGroundingApiResponse;
    const supportScore = typeof data.supportScore === 'number' ? data.supportScore : 0;
    const claimMinScore = Math.min(threshold, 0.6);

    const ungroundedClaims = (data.claims || [])
      .filter((c) => {
        if (c.groundingCheckRequired !== true) return false;
        const hasCitations = Array.isArray(c.citationIndices) && c.citationIndices.length > 0;
        const scoreOk = typeof c.score === 'number' ? c.score >= claimMinScore : hasCitations;
        return !hasCitations || !scoreOk;
      })
      .map((c) => (c.claimText || '').trim())
      .filter(Boolean);

    const passed = supportScore >= threshold && ungroundedClaims.length === 0;

    return {
      enabled: true,
      checked: true,
      passed,
      supportScore,
      threshold,
      ungroundedClaims,
    };
  } catch (err: any) {
    const msg = String(err?.message || err || 'Unknown CheckGrounding error');
    console.warn('[grounding] CheckGrounding failed:', msg);
    return {
      enabled: true,
      checked: false,
      passed: false,
      supportScore: null,
      threshold,
      ungroundedClaims: [],
      error: msg,
    };
  }
}
