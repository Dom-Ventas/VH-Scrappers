# Verified test products

**FSN = Flipkart Serial Number**, Flipkart's product identifier and the exact
value carried in the `pid=` URL parameter. It is what this scraper calls `pid`
and what ASIN is on Amazon — the two names refer to the same thing, so an FSN
can be dropped straight into `queries.json`.

All FSNs below were verified live on Flipkart on **2026-08-18** — each resolves
via `https://www.flipkart.com/product/p/itme?pid=<FSN>` and returns a populated
product page. Ratings are as of that date and will drift.

## FSNs

| # | FSN | Product | Rating | A+ |
|---|---|---|---|---|
| 1 | `TVSHBYPVRKUVGNGM` | SONY BRAVIA 2 II 108 cm (43") 4K LED Google TV | 4.7 | **yes** |
| 2 | `MOBHDVFKAWDVHJTU` | Samsung Galaxy S24 5G (Marble Gray, 256 GB) | 4.6 | **yes** |
| 3 | `COMHJJ2HRFHC6RYT` | ASUS Vivobook 15 (Ryzen 7, 16 GB/512 GB) | 4.5 | **yes** |
| 4 | `MOBGTAGPTB3VS24W` | Apple iPhone 15 (Black, 128 GB) | 4.6 | **yes** |
| 5 | `AFRHY864CKYUN2YH` | PHILIPS NA120/00 Air Fryer, 1500 W | 4.5 | **yes** |
| 6 | `ACCGJP5QSJFP7HAP` | boAt Rockerz 255 Arc, ENx, 30 h playback | 4.0 | **yes** |
| 7 | `PRCFB28XWXRSZJTN` | Prestige Popular Plus Outer Lid Pressure Cooker | 4.1 | **yes** |
| 8 | `MSCHDXPDR7BKCF3Y` | NIVEA Nourishing Body Milk, 72 h, Almond Oil | 4.5 | **yes** |
| 9 | `ACCG6DS7WDJHGWSH` | boAt Airdopes 161/163, 40 h battery | 4.0 | **yes** |
| 10 | `SNDHM9WVQHYYBRUX` | Frido Comfort Dual Strap Footwear | 4.3 | **yes** |
| 11 | `SNDGMRYB5QFJWJHT` | WOODLAND Men Casual footwear | 4.1 | no |
| 12 | `MOBHZVFJR8TPUG2P` | OnePlus N6 5G (128 GB, 4 GB RAM) | 4.2 | no |
| 13 | `WATHAVJ7FGUYPTCT` | Hugo #Grail Sport Multifunction Men's Watch | 4.8 | no |

Ratings drift; re-check before relying on them.

**Correction — rows 6–9 previously read "no" here.** That was wrong. It came
from an earlier detector that trusted the page-data API alone, and the API
omits the `RPD` widget for products that plainly do have rich content. A+ is now
the union of the API widget and rendered `cms-rpd-img` assets, and these four
have real, product-specific rich-content images. Do not use any A+ figure from
before that change.

The set still spans both outcomes — 10 with A+, 3 without, across TV / phone /
laptop / appliance / audio / cookware / personal care / footwear / watches, with
rating counts from 17 to 1.58 M. A run where everything comes back `aplus=yes`
or everything `no` is a broken detector, and this list makes that visible.
`WATHAVJ7FGUYPTCT` also has too few reviews to yield any critical ones, which
exercises the empty-`reviews` path.

## Matching amazon.in listings

Each ASIN below was verified by loading `https://www.amazon.in/dp/<ASIN>` and
confirming the product title renders. Use these to run the **same physical
product** through both scrapers and compare output.

| FSN (Flipkart) | ASIN (amazon.in) | Amazon title | Rating | Match |
|---|---|---|---|---|
| `AFRHY864CKYUN2YH` | `B0D14BB5XY` | PHILIPS Air Fryer NA120/00, 4.2 L | 4.1 (450) | **exact model** |
| `PRCFB28XWXRSZJTN` | `B00MA01ZOI` | Prestige Popular Plus Outer Lid Cooker, 3 L | 4.3 (362) | same model, single size |
| `MSCHDXPDR7BKCF3Y` | `B07VKM2HR5` | NIVEA Nourishing Body Milk 600 ml | 4.4 (33,374) | same product, size differs |
| `MOBHDVFKAWDVHJTU` | `B0CS69DGSW` | Samsung Galaxy S24 5G (Marble Gray, 128 GB) | 4.4 (1,968) | same model, 128 GB vs 256 GB |
| `TVSHBYPVRKUVGNGM` | `B0F7X29WXX` | Sony 43" BRAVIA 2M2 4K Google TV K-43S22BM2 | 4.2 (397) | same series, sub-model differs |
| `ACCGJP5QSJFP7HAP` | `B0D6Y7Y3N3` | boAt Rockerz 255 Z Plus | 3.9 (47,313) | same line, variant differs |

**Read the Match column before comparing numbers.** Only the Philips is an exact
model match; the rest differ by size, storage or sub-model, so their ratings are
*expected* to diverge between the two platforms. Treating a Flipkart-vs-Amazon
rating gap as a scraper bug when the row says "variant differs" would be a false
alarm.

Two things I could not deliver:

- **Apple iPhone 15 has no current amazon.in listing** I could verify — searches
  return only cases and accessories. The FSN is valid on Flipkart, so it stays
  in the table above, but it has no ASIN pair.
- **No FSN is a guaranteed permanent identifier.** Listings get delisted and
  brands add or remove A+ content, so re-verify before relying on these months
  from now. The iPhone 15 in particular showed no RPD in an earlier sweep and 5
  modules on re-check, which is exactly the kind of drift to expect.
