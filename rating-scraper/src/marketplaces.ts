export interface Marketplace {
  url: string;
  zipcode: string;
}

export const MARKETPLACES: Record<
  string,
  Marketplace
> = {
  AZIN: {
    url: 'amazon.in',
    zipcode: '110001'
  },

  AZUS: {
    url: 'amazon.com',
    zipcode: '10001'
  },

  AZUK: {
    url: 'amazon.co.uk',
    zipcode: 'SW1A 1AA'
  },

  AZAU: {
    url: 'www.amazon.com.au',
    zipcode: '2000'
  },

  AZCA: {
    url: 'www.amazon.ca',
    zipcode: 'M5H 2N2'
  },

  AZDE: {
    url: 'amazon.de',
    zipcode: '10115'
  },

  AZFR: {
    url: 'amazon.fr',
    zipcode: '75001'
  },

  AZIT: {
    url: 'amazon.it',
    zipcode: '00100'
  },

  AZES: {
    url: 'amazon.es',
    zipcode: '28001'
  },

  AZNL: {
    url: 'amazon.nl',
    zipcode: '1011'
  },

  AZBE: {
    url: 'amazon.com.be',
    zipcode: '1000'
  },

  AZMX: {
    url: 'www.amazon.com.mx',
    zipcode: '03100'
  },

  AZPO: {
    url: 'amazon.pl',
    zipcode: '00-001'
  },

  AZSW: {
    url: 'amazon.se',
    zipcode: '11120'
  },

  AZAE: {
    url: 'amazon.ae',
    zipcode: '0000'
  },

  AZSA: {
    url: 'amazon.sa',
    zipcode: '11564'
  }
};

export function resolveMarketplace(
  shortCode: string
): Marketplace {
  const cfg =
    MARKETPLACES[
      shortCode.toUpperCase()
    ];

  if (!cfg) {
    throw new Error(
      `Unknown short_code: ${shortCode}`
    );
  }

  return cfg;
}