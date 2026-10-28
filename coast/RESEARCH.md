# Coast Land Scout research notes

`coast/notes.json` holds what Claude learns while researching properties. The page at
schaeferwerks.com/coast reads it, so a note shows up once it is committed and pushed
(Cloudflare deploys in about 30 seconds). This file is not published (see `.assetsignore`).

The listings themselves (`coast/data.json`) are rewritten every morning by the daily job on
Justin's Mac (`~/LandScout/run.sh`). Don't edit `data.json` by hand; put findings here instead.

## Format

```json
{
  "listings": {
    "134333814": {
      "rv": "yes",
      "tags": ["Septic approved", "Power at road"],
      "note": "What was learned, in plain words. Blank lines split paragraphs.",
      "sources": [{"title": "Lincoln County RV rules", "url": "https://..."}],
      "updated": "2026-10-24"
    }
  },
  "areas": [
    {"city": "Rockaway Beach", "state": "OR", "rv": "limited", "note": "...", "sources": [], "updated": "2026-10-24"}
  ]
}
```

- **Listing key**: the listing's `id` in `data.json` (the Redfin property id, the number at the end of its Redfin link).
- **`rv`**: `yes` (living in or parking an RV on the lot is allowed), `limited` (allowed with limits, such as a time cap,
  a permit or only while building), or `no`. Leave it out when unknown. A listing's own `rv` wins over an area's.
- **`tags`**: short labels shown on the listing's row, up to four.
- **Areas** match listings by `city` + `state` (as spelled in `data.json`). Use them for rules that apply to a whole town.
- Keep JSON valid: the page shows no research at all if `notes.json` fails to parse. Check with
  `python3 -m json.tool coast/notes.json`.

## What has already been researched (check here before searching again)

Notes for these are in `notes.json`. Reuse them; only re-check rules that may have changed.

| Place | Jurisdiction | Where it lives |
|---|---|---|
| Ocean Shores, WA | City of Ocean Shores (ecode360.com/OC4569) | area note + listing 14765181 |
| Copalis Beach, WA | Grays Harbor County (Municode) | area note + listing 203503596 |
| Ocean Park, WA | Pacific County, Ord. 193 (critical areas) and Ord. 194 (zoning) | area note + listing 196138962 |
| Long Beach, WA (102nd Pl) | Pacific County, R-R | listing 195117826 (no area note: Long Beach rows mix city and county) |
| Newport, OR | City of Newport, NMC Title XIV | area note + listing 200115486 |
| Lincoln City, OR | City of Lincoln City | area note + listing 198986077 |
| Toledo, OR (1916 NE Wagon Rd) | Lincoln County R-1 inside the Toledo UGB | listing 134333814 (no area note: Toledo rows mix city and county) |
| Pacific City, OR (TL 200 Reddekopp Rd) | Tillamook County PCW-R2 (LUO 3.333, Article 5 RV siting) | listing 183463933 (no area note yet: county code pages blocked automated reads) |
| Cannon Beach, OR | City of Cannon Beach | area note only (the lot researched isn't in data.json) |

Researched but not in `notes.json` because the listing isn't in `data.json` (or couldn't be matched):

- **Rockaway Beach, OR, Ocean St:** four lots at $13K each, $52K total. No town-wide rules were recorded.
- **Yachats, OR (NE, near 545 NE Big Cedar):** $50K, flat (5.6% slope), outside tsunami zones, flood Zone X, no mapped landslides. The neighbor has public water plus septic. Septic is the deal-breaker: soils rated very limited, and NWI shows an intermittent streambed over 24% of the lot (NHD puts it 182 ft away). Open question: lot size against R-1 minimums. Possibly `data.json` id 183464589 (300 NE Washington St, $50K), not confirmed.

## How the workup is done

The same steps every time, so results are comparable:

- **Parcel boundary:**
  - Oregon: WRD tax lots `https://gis.wrd.state.or.us/server/rest/services/tax/Tax_Lots_Public_View_WGS84/MapServer/2/query?where=maptaxlot='...'&outSR=4326&f=geojson`
  - Washington: `https://services.arcgis.com/jsIt88o09Q0r1j8h/arcgis/rest/services/Current_Parcels/FeatureServer/0/query` (query by `ORIG_PARCEL_ID`). It also returns county land value.
  - Zillow's map pin is sometimes on the wrong lot, so use the parcel number from the listing facts.
- **Slope:** USGS 3DEP elevation `https://epqs.nationalmap.gov/v1/json?x=LON&y=LAT&units=Feet&wkid=4326&includeDate=true`.
  - Sample a 14-16 point grid over the parcel's bounding box and keep the points inside the polygon.
  - Report the plane-fit slope (with downhill bearing), local-slope percentiles (central differences), min/max elevation, and LiDAR date.
  - In a browser, run the fetches from an epqs.nationalmap.gov page (same origin).
- **Wetlands:** USFWS NWI `https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/0/query` (envelope query). Report the share of the lot inside and the distance to the nearest wetland.
- **Streams:** NHD `https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/6`.
- **Flood:** FEMA NFHL `https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28` (point query).
- **Soils and septic:** USDA SSURGO `https://sdmdataaccess.sc.egov.usda.gov/tabular/post.rest`.
  - Use `SDA_Get_Mukey_from_intersection_with_WktWgs84` on the parcel polygon.
  - Pull the `cointerp` rating 'ENG - Septic Tank Absorption Fields', the drainage class, and the shallowest wet-season water table (`cosoilmoist`).
- **Landslides (OR):** DOGAMI SLIDO `https://gis.dogami.oregon.gov/arcgis/rest/services/Public/SLIDO_Inventory/MapServer/4`.
- **Tsunami (OR):** DOGAMI flow-depth image services (NoData means outside the zone).
  - The WA DNR tsunami service needs a token, so WA tsunami status is usually unconfirmed.
- **Zoning (WA):** if the county map is only a PDF, try the WA Commerce zoning atlas `https://services6.arcgis.com/tboeqGwETr5ppr5Q/arcgis/rest/services/WAZA_Prototype_Layers/FeatureServer/0` (point query). It's a prototype, so say so.
- **Septic feasibility (WA):** WAC 246-272A-0320 sets minimum land area and WAC 246-272A-0210 sets setbacks (drainfield 100 ft from any well, including neighbors').
- **Code text:** read the actual code (ecode360, Municode, county PDFs) and cite section numbers. Questions to answer:
  - RV/tent living on a vacant lot
  - RV living during construction
  - Short-term rentals
  - Tree cutting
  - Clearing and grading
  - Sheds without a house
  - Lot-of-record rules
- **Offer:** compare the asking price to county land value, days on market and price history. State the offer as a judgment, with the contingency that matters (usually a septic designer's soil evaluation).
