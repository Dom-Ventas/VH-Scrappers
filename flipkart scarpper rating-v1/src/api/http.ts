import { config } from '../config';

/**
 * Node's fetch throws a bare "TypeError: fetch failed" with the real reason
 * buried in `cause`, which surfaces as an undici stack trace that says nothing
 * about what to actually do. Everything the scraper sends or fetches goes
 * through here so a connection problem reads as an instruction instead.
 */
function describeCause(
  err: unknown
): { code: string; reason: string } {

  const cause = (err as any)?.cause;

  const codes: string[] = [];

  const collect = (e: any) => {
    if (!e) return;
    if (e.code) codes.push(e.code);
    for (const nested of e.errors ?? []) collect(nested);
  };

  collect(cause);

  const code = codes[0] || (err as any)?.code || 'UNKNOWN';

  switch (code) {
    case 'ECONNREFUSED':
      return { code, reason: 'nothing is listening on that host/port' };
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return { code, reason: 'the hostname could not be resolved' };
    case 'ETIMEDOUT':
    case 'UND_ERR_CONNECT_TIMEOUT':
      return { code, reason: 'the connection timed out' };
    case 'CERT_HAS_EXPIRED':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
      return { code, reason: 'the TLS certificate could not be verified' };
    default:
      return { code, reason: String((cause as any)?.message || err) };
  }
}

function unreachableMessage(
  url: string,
  err: unknown
): string {

  const { code, reason } = describeCause(err);

  const lines = [
    `Cannot reach the backend at ${url}`,
    `  ${code} — ${reason}.`,
    '',
    '  Check that the host is reachable and that QUERIES_API_URL and',
    '  RESULTS_API_URL in .env are correct.',
    '',
    '  Leaving both blank runs the scraper without a server: queries are read',
    '  from queries.json and results are written to results/*.jsonl.'
  ];

  return lines.join('\n');
}

/**
 * Carries an already-actionable message, so callers can print it plainly
 * instead of dumping a stack trace that adds nothing.
 */
export class ApiConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiConnectionError';
  }
}

/**
 * fetch(), but a transport failure raises an actionable error rather than
 * "TypeError: fetch failed". Non-2xx responses are left to the caller, which
 * knows what a meaningful status means for its endpoint.
 */
export async function apiFetch(
  url: string,
  init?: RequestInit
): Promise<Response> {

  try {

    return await fetch(url, init);

  } catch (err) {

    throw new ApiConnectionError(
      unreachableMessage(url, err)
    );
  }
}

export function authHeaders(): Record<string, string> {

  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };

  if (config.apiToken) {
    headers.Authorization = `Bearer ${config.apiToken}`;
  }

  return headers;
}
