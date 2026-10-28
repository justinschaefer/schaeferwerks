---
name: "coast-lot-workup"
description: "Full due-diligence workup on a coast land listing (Zillow/Redfin link): slope from LiDAR, hazards, zoning, RV/tent/STR/tree rules, septic, fair offer, then a Coast Land Scout notes.json entry."
---

# Coast lot workup

Use when Justin ("Squirrel"; he calls Claude "Ed") sends a land listing link or address and wants the info on it. The answer must stand on sources found online. Never suggest calling or emailing city or county staff. Never state anything you couldn't verify; say plainly what you couldn't confirm.

## 0. Check what's already known

On the MacBook Pro the schaeferwerks repo is `~/LandScout/site` (run `git pull --rebase` first; push when done, since the daily 6:07 job also pushes there). If the repo is available, read `coast/notes.json` (listings by Redfin id, areas by city+state) and the "What has already been researched" and "How the workup is done" sections of `coast/RESEARCH.md`. Reuse town and county rules that are already there; only re-check rules likely to have changed. Find the listing's Redfin `id` in `coast/data.json` by address.

## 1. Work style

- Send a one-line start message, then staged updates (SendUserMessage, or plain short messages where that tool doesn't exist) as findings land (listing, slope, hazards, rules). He doesn't want to be asked things every minute.
- Run lookups in parallel: several browser tabs, background async fetches, and web searches in the same turn.
- Slope from LiDAR is mandatory. Never just repeat the listing's "level" claim.

## 2. Listing and parcel

- From the listing page, get:
  - Price, price history and days on market
  - Parcel number, lot size and dimensions
  - Zoning and jurisdiction
  - Utilities (water, sewer, power)
  - Taxes, HOA and the agent
- Zillow blocks plain fetches, so use the browser. The `__NEXT_DATA__` gdpClientCache holds the price and coordinates; the page text holds the facts.
- Zillow's map pin can sit on the wrong lot. Always use the parcel number.
- Parcel polygon and assessed value:
  - WA: `https://services.arcgis.com/jsIt88o09Q0r1j8h/arcgis/rest/services/Current_Parcels/FeatureServer/0/query?where=ORIG_PARCEL_ID='...'&outFields=*&returnGeometry=true&outSR=4326&f=json` (gives VALUE_LAND)
  - OR: `https://gis.wrd.state.or.us/server/rest/services/tax/Tax_Lots_Public_View_WGS84/MapServer/2/query?where=maptaxlot='...'&outSR=4326&f=geojson`, plus the county assessor site
- Confirm city vs unincorporated county. Listings often get the jurisdiction wrong.

## 3. Slope (USGS 3DEP)

- Open a tab on `https://epqs.nationalmap.gov/v1/json?x=LON&y=LAT&units=Feet&wkid=4326`. Run the fetches from that page (same origin, relative `/v1/json?...&includeDate=true`), not from Zillow, because Zillow's CSP stalls them.
- Sampling:
  - Use a 14-16 point grid over the bbox, with point-in-polygon flags.
  - Run 8 concurrent workers in a background async IIFE that writes to `window._out`. Poll it, because calls longer than 45 s time out.
  - Retry nulls up to 3 times.
- Report:
  - Plane-fit slope % and downhill bearing
  - Local slope p10/p50/p90/max (central differences on grid neighbours)
  - Min/max elevation in feet and the LiDAR date
  - A rough elevation grid, to describe benches, troughs and flat building spots

## 4. Hazards and soils (run in parallel)

- **Wetlands:** NWI `https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/0/query` (envelope around the lot, returnGeometry). Compute the share of the lot inside each wetland and the distance to the nearest one.
- **Streams:** NHD `https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/6` (small envelope; it's slow).
- **Flood:** FEMA `https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28` (point query). Retry once if the fetch fails.
- **Soils:** SSURGO POST to `https://sdmdataaccess.sc.egov.usda.gov/tabular/post.rest`:
  - Use `SDA_Get_Mukey_from_intersection_with_WktWgs84` on the polygon.
  - Pull map unit name, drainage class, the 'ENG - Septic Tank Absorption Fields' rating, and the shallowest 'Wet' `cosoilmoist` depth (cm).
- **Landslides (OR):** DOGAMI SLIDO `https://gis.dogami.oregon.gov/arcgis/rest/services/Public/SLIDO_Inventory/MapServer/4`.
- **Tsunami:**
  - OR: DOGAMI flow-depth image services (NoData means outside the zone).
  - WA: the DNR service needs a token, so say it's unconfirmed. The 2018 SW WA models put Ocean Shores entirely under water.
- **Neighbourhood:** industrial neighbours, air quality and other context only when relevant, with sources.

## 5. Rules (read the actual code, cite section numbers)

Answer each of these:
- Can he live or camp in an RV on the vacant lot? Days, permits and sanitation.
- Tents
- RV during construction
- Shed without a house
- Short-term rentals in this zone
- Tree cutting
- Clearing and grading (what Mr. Shovels, a 3,500 lb mini excavator, can do)
- Lot-of-record and minimum lot size
- Setbacks (corner lots often get two front yards)
- Tiny house or manufactured home rules if relevant
- Hookup or system development fees

Where the code lives:
- Many cities are on ecode360. Fetch chapter HTML with DOMParser from an ecode360 tab.
- Grays Harbor County is on Municode (nodeId URLs work in the browser).
- Pacific County ordinances are PDFs at co.pacific.wa.us/ordres. robots.txt blocks WebFetch, so load pdf.js from cdnjs inside a co.pacific.wa.us tab and extract the text.
- WA zoning when the county map is a PDF: WA Commerce zoning atlas `https://services6.arcgis.com/tboeqGwETr5ppr5Q/arcgis/rest/services/WAZA_Prototype_Layers/FeatureServer/0` (it's a prototype; say so).
- WA septic:
  - WAC 246-272A-0320 sets minimum land area: 13,000+ sq ft with public water, 1 acre with a private well. A lot of record can be smaller only if the design meets every rule with no waivers.
  - WAC 246-272A-0210 sets setbacks: drainfield 100 ft from any well, including neighbours' wells.

## 6. Verdict and offer

- Lead with whether it works for what he wants: RV time, camping, cutting trees, building small, renting.
- Name the make-or-break item (usually septic or wetland) and the contingency to write into the offer.
- Base the offer on asking price vs county land value, days on market and price history. State it as a judgment (open X, aim for Y).
- End with a Sources list of links.

## 7. Write the notes.json entry

Add or update `coast/notes.json` in the schaeferwerks repo:
- Listing key = Redfin `id` from `data.json`.
- `rv`: yes, limited or no (leave it out if unknown).
- Up to 4 short `tags`.
- A plain-words `note` (blank lines split paragraphs).
- `sources` with real URLs only. Leave it empty rather than guess a URL.
- `updated` date.

Add or extend an `areas` entry when the rule is town-wide, but only when every listing with that city name falls under the same jurisdiction (unincorporated places like Ocean Park or Copalis Beach are fine; Long Beach and Toledo mix city and county).

Before committing:
- Validate with `python3 -m json.tool coast/notes.json`.
- Add the place to the "What has already been researched" table in `coast/RESEARCH.md`.
- Never edit `data.json`. The daily job rewrites it.
## 8. Notes from the MacBook Pro (2026-10-27)

- Safari JavaScript is on (2026-10-27). `~/LandScout/tools/sjs.sh SLOT URL WAIT 'js'` loads a page in Claude's Safari window and returns the JS result (URL `-` reuses the tab); use it for county search forms. `swift ~/LandScout/tools/pdftext.swift file.pdf` extracts PDF text.
- Assessors: Lincoln `propertyweb.co.lincoln.or.us` (search box takes `12-11-30-CC-00301-00`; detail page lists zoning, RMV, sales, bills). Tillamook `query.co.tillamook.or.us/PSO/search?searchOption=Map&searchValue=4S1030AA%2000200` (space before the 5-digit lot).
- Lincoln County land use code (Chapter 1) PDF: `https://www.co.lincoln.or.us/DocumentCenter/View/647/Land-Use-Code-PDF` (curl works).
- Browser: `~/rv-search/fetch_pool.py` loads pages in Claude's own Safari window and saves the HTML (never touch the user's tabs). Zillow's `__NEXT_DATA__` comes through this way. In-page JavaScript (PDFs, search forms) needs Safari's "Allow JavaScript from Apple Events" setting.
- Tsunami (OR) quick check: `https://gis.dogami.oregon.gov/arcgis/rest/services/Tsunami/XXL1_Flow_Depth_Ft/ImageServer/identify?geometry=LON,LAT&geometryType=esriGeometryPoint&sr=4326&f=json` (NoData = outside).
- SLIDO layers: 11 = deposits, 2 = scarps, 1 = historic points (layer 4 no longer exists).
- If sdmdataaccess is down, SoilWeb gives the map unit: `https://casoilresource.lawr.ucdavis.edu/api/landPKS.php?q=spn&lon=LON&lat=LAT&r=10`.
- Tillamook County moved its site to CivicEngage in 2026; the old `/sites/default/files/...` LUO PDF links now 404. Don't cite them.
