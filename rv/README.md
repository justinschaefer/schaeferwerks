# RV Scout

schaeferwerks.com/rv lists used trailers for sale that the Jeep can tow. This file is not published (see `.assetsignore`).

- `rv/data.json` is rewritten every morning at 6:37 by the job on Justin's Mac (`~/RVScout/run.sh`, scheduled by
  `~/Library/LaunchAgents/com.schaeferwerks.rvscout.plist`); no Claude is involved. It uses the fetch tools from the
  old Claude-run search (`~/rv-search`): Craigslist and Airstream Marketplace with plain `curl`, and Facebook Marketplace
  and RV Trader through Safari (logged in to Facebook) in a Safari window of its own. Don't edit `data.json` by hand.
- The rules (tow limits, target models, model specs, what counts as a toy hauler, deal ratings) are in
  `~/RVScout/rvscout.py`. Add a model to `MODELS` there. The log is `~/RVScout/logs/run.log`.
- Stars and passes are saved by `worker.js` (`/rv/api/ratings`) in the `COAST` KV namespace under the key `rv-ratings`.
  The first load starts from `rv/seed-ratings.json`, which holds the passes from the old RV Deal Tracker on claude.ai.
  Those use the tracker's ids; the daily job lists them in a row's `aliases` when its link matches, and does the same
  for an ad that gets reposted under a new id, so a pass or star still shows.
- `/rv` is private: the worker refuses requests that didn't come through Cloudflare Access, and the Access app that
  protects `/coast` also needs the `rv` path.

## Row format (`data.json`)

`{"asof": "2026-10-26", "updated": "2026-10-26T06:41-07:00", "sources": {"Facebook": 120, ...}, "warnings": [...], "rows": [...]}`.
`warnings` names a source that came back empty (for example Safari logged out of Facebook); the page shows it.
Each row has a stable `id` (`fb-`, `cl-`, `rvt-` or `am-` + the ad's own id), `source`, `title`, `kind` (Toy hauler, Airstream or Travel trailer), `family` (model),
`target`, `price`, `typical` (usual asking price for the model), `fit` (yes, check or no) with `fit_why`, `bath`
(yes, no or ?), `length`/`dry`/`tongue`/`gvwr`, `miles` (straight line from Portland), `rating` (top, good or maybe),
`score`, `note`, `remarks` (ad text), `first` (date first seen), `isNew`, `dropFrom` (price before a drop this week)
and `url`.
