# RV Scout

schaeferwerks.com/rv lists used trailers for sale that the Jeep can tow. This file is not published (see `.assetsignore`).

- The listings are refreshed every morning at 6:37 by the job on Justin's MacBook Pro (`~/RVScout/run.sh`, scheduled by
  `~/Library/LaunchAgents/com.schaeferwerks.rvscout.plist`); no Claude is involved. That Mac has no GitHub login, so it
  uploads the listings to the worker (`POST /rv/api/data` with the key in `~/RVScout/upload.key`), which keeps them in
  KV (`rv-data`) and serves them as `/rv/data.json`. There is no `rv/data.json` file in the repo. It uses the fetch tools from the
  old Claude-run search (`~/rv-search`): Craigslist and Airstream Marketplace with plain `curl`, and Facebook Marketplace
  and RV Trader through Safari (logged in to Facebook) in a Safari window of its own. 
- The rules (tow limits, target models, model specs, what counts as a toy hauler, deal ratings) are in
  `~/RVScout/rvscout.py`. Add a model to `MODELS` there. The log is `~/RVScout/logs/run.log`.
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
