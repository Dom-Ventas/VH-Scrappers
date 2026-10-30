import { config } from './config';

/**
 * VentaWiz service-account auth (OAuth2 client_credentials against DV-Auth).
 *
 * There is no shared static token any more. Each laptop holds one service
 * account — client id `svc_…` + client secret `vws_…` — for one tenant, and
 * swaps it for a short-lived (≈10 min) bearer token:
 *
 *   POST {VW_AUTH_URL}/v1/token   (no Authorization header)
 *   {"grant_type":"client_credentials","client_id":"svc_…","client_secret":"vws_…"}
 *   → 200 {"access_token":"<JWT>","token_type":"Bearer","expires_in":600}
 *   → 401 invalid_client on any credential failure (never retried unchanged)
 *
 * There is no refresh token: when the token is about to expire we simply
 * exchange again. A scraper run can outlive one token, which is why the agent
 * hands its children the credentials, not a token.
 *
 * This file is copied verbatim into every package (agent + six scrapers);
 * only the `config` import path differs. Keep the copies in step.
 */

/** Credential / permission failures. Retrying them unchanged cannot help. */
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface ServiceAccount {
  clientId: string;
  clientSecret: string;
}

const CLIENT_ID_PREFIX = 'svc_';
const CLIENT_SECRET_PREFIX = 'vws_';
/** Re-exchange this long before the server-side expiry. */
const EXPIRY_MARGIN_MS = 60_000;
const TIMEOUT_MS = 30_000;

let override: ServiceAccount | null = null;
let cached: { token: string; expiresAt: number } | null = null;
let inflight: Promise<string> | null = null;
/** Set once /v1/token answers 401 — the same credentials are never sent again. */
let rejected: AuthError | null = null;

/** Use these credentials instead of the ones in config (the agent's saved setup). */
export function useServiceAccount(account: ServiceAccount): void {
  override = { clientId: account.clientId.trim(), clientSecret: account.clientSecret.trim() };
  cached = null;
  rejected = null;
}

function serviceAccount(): ServiceAccount {
  return override ?? { clientId: config.clientId, clientSecret: config.clientSecret };
}

/** The client id in use (safe to log — the secret never is). */
export function serviceAccountId(): string {
  return serviceAccount().clientId;
}

/**
 * Why the configured credentials cannot work, or null when they look usable.
 * Checks presence and the `svc_` / `vws_` prefixes only — the auth service
 * is the judge of whether they are actually valid.
 */
export function credentialsProblem(): string | null {
  const { clientId, clientSecret } = serviceAccount();
  if (!clientId || !clientSecret) {
    return (
      'VentaWiz service-account credentials are missing — set VW_CLIENT_ID (svc_…) ' +
      'and VW_CLIENT_SECRET (vws_…) in the .env (the VentaWiz agent sets them for you)'
    );
  }
  if (!clientId.startsWith(CLIENT_ID_PREFIX)) {
    return `VW_CLIENT_ID must start with "${CLIENT_ID_PREFIX}" (got "${clientId}")`;
  }
  if (!clientSecret.startsWith(CLIENT_SECRET_PREFIX)) {
    return `VW_CLIENT_SECRET must start with "${CLIENT_SECRET_PREFIX}"`;
  }
  return null;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: init.signal ?? controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function exchange(): Promise<string> {
  const problem = credentialsProblem();
  if (problem) throw new AuthError(problem);
  const { clientId, clientSecret } = serviceAccount();
  const tokenUrl = `${config.authRoot}/v1/token`;

  let res: Response;
  try {
    res = await fetchWithTimeout(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
  } catch (err) {
    throw new Error(
      `could not reach the VentaWiz auth service at ${tokenUrl} ` +
        `(${(err as Error).message}) — check VW_AUTH_URL`,
    );
  }

  if (res.status === 401) {
    rejected = new AuthError(
      `client id/secret rejected — check the service account (client id ${clientId}, ` +
        `401 from ${tokenUrl})`,
    );
    throw rejected;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`token exchange ${res.status} ${res.statusText} ${text}`.trim());
  }

  const body = (await res.json().catch(() => null)) as {
    access_token?: unknown;
    expires_in?: unknown;
  } | null;
  if (!body || typeof body.access_token !== 'string' || !body.access_token) {
    throw new Error(`token exchange: no access_token in the response from ${tokenUrl}`);
  }
  const expiresInSec =
    typeof body.expires_in === 'number' && body.expires_in > 0 ? body.expires_in : 600;
  // Never cache for less than zero: a very short-lived token is used once.
  const lifetimeMs = Math.max(0, expiresInSec * 1000 - EXPIRY_MARGIN_MS);
  cached = { token: body.access_token, expiresAt: Date.now() + lifetimeMs };
  return body.access_token;
}

/**
 * A bearer token for the VentaWiz API. Cached until `expires_in - 60s`, then
 * exchanged again; concurrent callers share one exchange.
 */
export async function getAccessToken(): Promise<string> {
  if (rejected) throw rejected;
  if (cached && Date.now() < cached.expiresAt) return cached.token;
  if (!inflight) {
    inflight = exchange().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

/** Forget the cached token, so the next call exchanges the credentials again. */
export function dropAccessToken(): void {
  cached = null;
}

/**
 * fetch() against the VentaWiz API with `Authorization: Bearer …` added.
 *
 * - 401 (token expired / revoked early): drop the cache, re-exchange once and
 *   retry the request once. A second 401 is an AuthError.
 * - 403: the service account lacks `scrapper:run` — an AuthError.
 * Every other status is returned to the caller unchanged.
 *
 * The body must be re-sendable (a string, as every caller here uses).
 */
export async function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const send = async (): Promise<Response> => {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${await getAccessToken()}`);
    return fetch(url, { ...init, headers });
  };

  let res = await send();
  if (res.status === 401) {
    await res.body?.cancel().catch(() => undefined);
    dropAccessToken();
    res = await send();
    if (res.status === 401) {
      const text = await res.text().catch(() => '');
      throw new AuthError(
        `VentaWiz API rejected a fresh service-account token (401 from ${url}) ${text}`.trim(),
      );
    }
  }
  if (res.status === 403) {
    const text = await res.text().catch(() => '');
    throw new AuthError(
      `service account lacks scrapper:run — ask a VentaWiz admin to grant it to ` +
        `${serviceAccountId()} (403 from ${url}) ${text}`.trim(),
    );
  }
  return res;
}
