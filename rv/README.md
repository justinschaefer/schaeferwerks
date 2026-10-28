# RV Scout

schaeferwerks.com/rv lists used trailers for sale that the Jeep can tow. This file is not published (see `.assetsignore`).

- The listings are refreshed every morning at 6:37 by the job on Justin's MacBook Pro (`~/RVScout/run.sh`, scheduled by
  `~/Library/LaunchAgents/com.schaeferwerks.rvscout.plist`); no Claude is involved. It
  uploads the listings to the worker (`POST /rv/api/data` with the key in `~/RVScout/upload.key`), which keeps them in
  KV (`rv-data`) and serves them as `/rv/data.json`. There is no `rv/data.json` file in the repo. A newer `/rv` page
  can be uploaded the same way (`POST /rv/api/page`, kept in KV as `rv-page`); it replaces `rv/index.html` until removed. It uses the fetch tools from the
  old Claude-run search (`~/rv-search`): Craigslist and Airstream Marketplace with plain `curl`, and Facebook Marketplace
  and RV Trader through Safari (logged in to Facebook) in a Safari window of its own. 
- "Search now" on the page asks for a search (`POST /rv/api/search`, state in KV `rv-search`). The MacBook Pro checks
  every 2 minutes (`~/RVScout/searchnow.sh`, LaunchAgent `com.schaeferwerks.rvscout-searchnow`, `POST /rv/api/search/claim`
  with its key) and starts the daily job; its upload marks the search finished. No new request within 15 minutes of one.
- The rules (tow limits, target models, model specs, what counts as a toy hauler, deal ratings) are in
  `~/RVScout/rvscout.py`. Add a model to `MODELS` there. The log is `~/RVScout/logs/run.log`.
- "Well built" brands (`WELL_BUILT` in rvscout.py): Rockwood (Geo Pro, Mini Lite) and Flagstaff (E-Pro, Micro Lite) and
  Lance travel trailers any year, Surveyor and No Boundaries 2017-2019. They're searched on every site, get a "Well built" tag
  (row field `built`) and rank higher; the page has a Well built button.
- Heartland and its lines (Sundance, Mallard, Prowler...) are never listed: `DROP_BRANDS` in rvscout.py. So is the Geo Pro / E-Pro 12RK (too small; `DROP_FAMILIES`), the Rockwood Roo / Flagstaff Shamrock, and every "Sun" brand (Sunray, Sun Lite, Rush, Sunset Trail...).
- Nothing older than 2016 is listed except Airstreams (`OLDEST_YEAR`); an ad with no year is kept. Nor is anything
  under 15 ft (`MIN_LENGTH`, when the ad states the length) or with a tent (pop-ups, hybrids, teardrops: `TENT`).
- Only Justin's models (`MODELS`) and the well-built brands are listed; anything else the broad searches find is dropped,
  as is any ad without a price.
  Trailers that aren't toy haulers are listed only from the approved brands: Airstream, Wolf Pup, R-Pod, Lance and the
  well-built brands, and only within 250 miles of Portland (`NEAR_MILES`); toy haulers and Airstreams from anywhere. Geo Pros / E-Pros are listed only as toy haulers.
- The top model is the Rockwood Geo Pro G19FBTH (and its twin, the Flagstaff E-Pro E19FBTH): `TOP_MODEL` in rvscout.py.
  Its siblings, the Rockwood 19FS and the Geo Pro / E-Pro 19TH toy haulers, are targets too (the page's
  Geo Pro toy haulers button shows all three). It's searched nationwide; one that fits, is within budget and within 600 miles is always a top pick.
- Stars and passes are saved by `worker.js` (`/rv/api/ratings`) in the `COAST` KV namespace under the key `rv-ratings`.
  The first load starts from `rv/seed-ratings.json`, which holds the passes from the old RV Deal Tracker on claude.ai.
  Those use the tracker's ids; the daily job lists them in a row's `aliases` when its link matches, and does the same
  for an ad that gets reposted under a new id, so a pass or star still shows.
- Not private yet: like `/coast`, `/rv` isn't behind Cloudflare Access, so anyone who finds it can see it (both pages
  tell search engines not to list them). Ranks save from the page itself or through Access. To make both private, add
  `coast` and `rv` paths to a Cloudflare Access app for schaeferwerks.com.

## Row format (`data.json`)

`{"asof": "2026-10-26", "updated": "2026-10-26T06:41-07:00", "sources": {"Facebook": 120, ...}, "warnings": [...], "rows": [...]}`.
`warnings` names a source that came back empty (for example Safari logged out of Facebook); the page shows it.
Each row has a stable `id` (`fb-`, `cl-`, `rvt-` or `am-` + the ad's own id), `source`, `title`, `kind` (Toy hauler, Airstream or Travel trailer), `family` (model),
`target`, `price`, `typical` (usual asking price for the model), `fit` (yes, check or no) with `fit_why`, `bath`
(yes, no or ?), `length`/`dry`/`tongue`/`gvwr`, `miles` (straight line from Portland), `rating` (top, good or maybe),
`score`, `note`, `remarks` (ad text), `first` (date first seen), `isNew`, `dropFrom` (price before a drop this week)
and `url`.
