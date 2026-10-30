import { CheckinStore } from './types';

/**
 * The site an employee signs in to for each marketplace short code.
 *
 * The scrapers already pick the site per queue item from the store's
 * `short_code` (see each scraper's src/marketplaces.ts). The agent used to sign
 * in to one fixed country per agent kind — amazon.in for every Amazon laptop —
 * so a UAE store's scrapers found no amazon.ae session and stopped at Sign-In.
 * The first run now signs in to every site its stores use, read off the
 * check-in reply. Keep this table in step with the scrapers' tables.
 */
const SIGN_IN_SITES: Record<string, string> = {
  AZIN: 'www.amazon.in',
  AZUS: 'www.amazon.com',
  AZUK: 'www.amazon.co.uk',
  AZAU: 'www.amazon.com.au',
  AZCA: 'www.amazon.ca',
  AZDE: 'www.amazon.de',
  AZFR: 'www.amazon.fr',
  AZIT: 'www.amazon.it',
  AZES: 'www.amazon.es',
  AZNL: 'www.amazon.nl',
  AZBE: 'www.amazon.com.be',
  AZMX: 'www.amazon.com.mx',
  AZPO: 'www.amazon.pl',
  AZSW: 'www.amazon.se',
  AZAE: 'www.amazon.ae',
  AZSA: 'www.amazon.sa',
  FKIN: 'www.flipkart.com',
  NNAE: 'www.noon.com/uae-en',
  NNSA: 'www.noon.com/saudi-en',
};

/** The site for one short code, or null when the agent does not know it. */
export function signInSite(shortCode: string): string | null {
  return SIGN_IN_SITES[shortCode.trim().toUpperCase()] ?? null;
}

/**
 * The distinct sites the given stores need a session on, in store order.
 *
 * @returns `sites` to sign in to, and `unknown` short codes this build has no
 *   site for (logged; their scrapers fail the same way until a site is added).
 */
export function signInSites(stores: CheckinStore[]): { sites: string[]; unknown: string[] } {
  const sites: string[] = [];
  const unknown: string[] = [];
  for (const store of stores) {
    const site = signInSite(store.short_code);
    if (site === null) {
      if (!unknown.includes(store.short_code)) unknown.push(store.short_code);
    } else if (!sites.includes(site)) {
      sites.push(site);
    }
  }
  return { sites, unknown };
}
