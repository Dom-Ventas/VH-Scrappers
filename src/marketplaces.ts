/**
 * Maps Amazon marketplace short codes to their domain URL and a representative
 * zip/pin code used by the scraper to get localised search results.
 */

export interface Marketplace {
  url: string;
  zipcode: string;
}

const MARKETPLACES: Record<string, Marketplace> = {
  AZUS: { url: 'www.amazon.com',    zipcode: '10001' },   // United States
  AZCA: { url: 'www.amazon.ca',     zipcode: 'M5H 2N2' }, // Canada
  AZMX: { url: 'www.amazon.com.mx', zipcode: '06600' },   // Mexico
  AZUK: { url: 'www.amazon.co.uk',  zipcode: 'EC1A 1BB' },// United Kingdom
  AZDE: { url: 'www.amazon.de',     zipcode: '10115' },   // Germany
  AZFR: { url: 'www.amazon.fr',     zipcode: '75001' },   // France
  AZIT: { url: 'www.amazon.it',     zipcode: '00118' },   // Italy
  AZES: { url: 'www.amazon.es',     zipcode: '28001' },   // Spain
  AZNL: { url: 'www.amazon.nl',     zipcode: '1011 AB' }, // Netherlands
  AZSE: { url: 'www.amazon.se',     zipcode: '11120' },   // Sweden
  AZPL: { url: 'www.amazon.pl',     zipcode: '00-001' },  // Poland
  AZIN: { url: 'www.amazon.in',     zipcode: '110001' },  // India
  AZJP: { url: 'www.amazon.co.jp',  zipcode: '100-0001' },// Japan
  AZAU: { url: 'www.amazon.com.au', zipcode: '2000' },    // Australia
  AZAE: { url: 'www.amazon.ae',     zipcode: '00000' },   // UAE
  AZSA: { url: 'www.amazon.sa',     zipcode: '11564' },   // Saudi Arabia
};

/**
 * Resolve a short code to its Marketplace config.
 * Throws if the short code is unknown.
 */
export function resolveMarketplace(shortCode: string): Marketplace {
  const mp = MARKETPLACES[shortCode.toUpperCase()];
  if (!mp) {
    throw new Error(
      `Unknown marketplace short code: "${shortCode}". ` +
      `Valid codes: ${Object.keys(MARKETPLACES).join(', ')}`,
    );
  }
  return mp;
}
