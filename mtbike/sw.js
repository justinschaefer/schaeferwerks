// Bump this string whenever index.html (or any precached file) changes and
// you want phones that already have this installed to pick up the update.
// Bumping it makes the next install() cache into a fresh-named cache and the
// next activate() delete the old one -- without a bump, a device that's
// already cached this will keep serving the old files indefinitely, by
// design (that's what makes it reliable with no signal).
var CACHE_VERSION = 'v28';
var CACHE_NAME = 'gpx-explorer-' + CACHE_VERSION;

// Separate, capped cache for map tiles (see the fetch handler below for why
// this is opportunistic caching of tiles you've actually viewed, not bulk
// pre-downloading -- Thunderforest's and other tile providers' free-tier
// terms explicitly forbid the latter).
var TILE_CACHE_NAME = 'gpx-explorer-tiles-v1';
// A second, tiny cache holding just {url -> cachedAt timestamp} JSON blobs.
// The Cache API doesn't track when an entry was stored and opaque
// cross-origin tile responses can't have a custom header stamped on them
// before caching, so this is the simplest way to know a tile's age without
// pulling in IndexedDB for one number per tile. CARTO's basemap terms
// specifically cap in-browser/on-device caching at 30 days (other providers
// don't specify a number, but the same cap is applied everywhere for
// simplicity and because "some staleness bound" is good practice regardless).
var TILE_META_CACHE_NAME = 'gpx-explorer-tile-meta-v1';
var TILE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
// Deliberately does NOT include server.arcgisonline.com (the 3D view's
// satellite imagery). Testing turned up real cross-origin fetch failures
// specific to that host when relayed through a service worker's fetch()
// (both CORS and no-cors mode) even though curl and the app's own existing
// <img crossOrigin> tags reach it fine -- something about how a
// service-worker-mediated fetch differs from a native <img> load trips it up.
// Satellite imagery already works reliably without this and already falls
// back cleanly to the elevation color terrain when it's unavailable, so
// there's nothing to gain here that offsets the risk of breaking a feature
// that currently works. The 2D map's actual tile layers below use plain
// <img> with no crossOrigin attribute and have tested clean -- except CARTO
// (basemaps.cartocdn.com) turned up the exact same unexplained fetch failure
// as arcgisonline when this was checked, even with the service worker
// completely unregistered, so this may be a sandbox-specific network quirk
// during development rather than a real problem -- worth confirming this
// still works on an actual deployed site before trusting it blindly.
var TILE_HOSTS = [
  'tile.thunderforest.com',
  'tile.openstreetmap.org',
  'basemaps.cartocdn.com'
];
var TILE_CACHE_MAX_ENTRIES = 600; // a few MB -- enough for a park and its approach roads at a couple zoom levels, not unbounded

var PRECACHE_URLS = [
  './',
  'index.html',
  'manifest.json',
  'three.min.js',
  'three-lines.js',
  'leaflet.min.js',
  'leaflet.min.css',
  // The app's own JS, split into per-concern files (see mtbike-explorer/
  // README.txt, "Splitting index.html" section) -- index.html now loads
  // these via <script src> instead of one big inline block, so they need
  // to be precached explicitly or offline mode silently breaks: the page
  // shell would load from cache but every one of these would 404 against
  // the network with no connection. Order here doesn't matter for caching
  // (unlike the <script> tags in index.html, where load order is load-
  // bearing) -- this is just a list of what to fetch and store.
  'js/core.js',
  'js/park-data.js',
  'js/routes-data.js',
  'js/map-2d.js',
  'js/charts.js',
  'js/ui-shell.js',
  'js/map-3d.js',
  'js/compare-trails.js',
  'js/app-init.js',
  'images/marker-icon.png',
  'images/marker-icon-2x.png',
  'images/marker-shadow.png',
  'images/layers.png',
  'images/layers-2x.png',
  'icon-192.png',
  'icon-512.png',
  // Only the default park (index.html falls back to 'ucsc' whenever
  // localStorage has no gpxExplorerNetwork value yet, i.e. every first
  // install) gets precached here. index.html's own comment on
  // window.PARK_BOUNDS explains why: loading all five parks' trail+terrain
  // pairs unconditionally used to mean 1.1MB fetched before you'd even
  // picked a park -- exactly the bandwidth cost ensureParkLoaded()/lazy
  // <script> injection was written to avoid. Precaching every park here at
  // install time would silently reintroduce that same cost for anyone who
  // installs this as a PWA, just moved from "on first page load" to "in the
  // background right after install" -- still a few MB over a trailside
  // connection for parks that may never get opened.
  // The other parks aren't left permanently uncached, though: the
  // cache-first same-origin handler below (see the plain event.respondWith
  // block after the tile-host branch) caches whatever it fetches, so the
  // first time ensureParkLoaded() pulls in annadel/lacamas/fallcreek/art's
  // pair for real, that pair gets stored in CACHE_NAME too and is available
  // offline from then on -- same end state, just paid for lazily instead of
  // upfront. If you add a park and want it precached by default, change
  // index.html's currentNetworkId fallback and the id below together.
  'ucsc_trails_data.js',
  'ucsc_terrain_data.js'
];

self.addEventListener('install', function(event){
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache){
        return Promise.all(PRECACHE_URLS.map(function(url){
          return fetch(url, { cache: 'reload' }).then(function(resp){
            if (!resp.ok) throw new Error('precache fetch failed: ' + url + ' (' + resp.status + ')');
            return cache.put(url, resp);
          });
        }));
      })
      .then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(event){
  event.waitUntil(
    caches.keys().then(function(names){
      return Promise.all(
        names.filter(function(n){ return n !== CACHE_NAME && n !== TILE_CACHE_NAME && n !== TILE_META_CACHE_NAME; })
             .map(function(n){ return caches.delete(n); })
      );
    }).then(function(){ return self.clients.claim(); })
  );
});

function tileMetaKey(req) {
  // A synthetic same-cache-storage key for this tile's metadata, distinct
  // from the tile's own request so the two never collide.
  return new Request('https://tile-meta.invalid/' + encodeURIComponent(req.url));
}

function recordTileCachedNow(req) {
  caches.open(TILE_META_CACHE_NAME).then(function(metaCache){
    metaCache.put(tileMetaKey(req), new Response(JSON.stringify({ cachedAt: Date.now() })));
  });
}

function tileIsExpired(req) {
  return caches.open(TILE_META_CACHE_NAME).then(function(metaCache){
    return metaCache.match(tileMetaKey(req)).then(function(metaRes){
      if (!metaRes) return false; // no record -- treat as fine rather than evicting something we can't confirm the age of
      return metaRes.json().then(function(meta){
        return (Date.now() - meta.cachedAt) > TILE_MAX_AGE_MS;
      }).catch(function(){ return false; });
    });
  });
}

function trimTileCache(cache) {
  cache.keys().then(function(keys){
    var over = keys.length - TILE_CACHE_MAX_ENTRIES;
    if (over <= 0) return;
    // Cache API doesn't track access recency, so this is FIFO by insertion
    // order (keys() returns them in insertion order) rather than true LRU --
    // close enough for "don't grow forever" without extra bookkeeping.
    var evicted = keys.slice(0, over);
    evicted.forEach(function(req){ cache.delete(req); });
    caches.open(TILE_META_CACHE_NAME).then(function(metaCache){
      evicted.forEach(function(req){ metaCache.delete(tileMetaKey(req)); });
    });
  });
}

function isTileHost(hostname) {
  for (var i = 0; i < TILE_HOSTS.length; i++) {
    // Thunderforest (and some other providers) rotate subdomains -- a./b./c.tile...
    // via Leaflet's {s} placeholder -- so an exact hostname match never fires;
    // this needs to check the suffix, not full equality.
    if (hostname === TILE_HOSTS[i] || hostname.slice(-(TILE_HOSTS[i].length + 1)) === '.' + TILE_HOSTS[i]) return true;
  }
  return false;
}

self.addEventListener('fetch', function(event){
  var req = event.request;
  if (req.method !== 'GET') return; // don't touch anything but simple reads

  var url = new URL(req.url);
  if (url.origin !== self.location.origin) {
    if (!isTileHost(url.hostname)) {
      // Geocoding, elevation queries, Overpass, etc. -- all inherently
      // online-only, one-shot lookups that don't benefit from caching. Leave
      // these alone so they behave exactly as they already do.
      return;
    }
    // Map tiles: stale-while-revalidate, and ONLY for tiles actually
    // requested by normal use (panning/zooming the map), never fetched
    // speculatively by this file. That distinction is what keeps this inside
    // Thunderforest's own terms ("tiles may be cached in-browser and
    // on-device for offline use") rather than the bulk pre-downloading they
    // explicitly prohibit without a paid plan. Practical effect: pan and
    // zoom around a route before you lose signal and those tiles are there
    // when you're back offline later; areas you've never actually looked at
    // stay uncached, same as they would with the browser's own HTTP cache.
    event.respondWith(
      caches.open(TILE_CACHE_NAME).then(function(cache){
        return cache.match(req).then(function(cached){
          if (cached) {
            return tileIsExpired(req).then(function(expired){
              if (expired) {
                // Past the 30-day cap -- treat as uncached rather than serve
                // stale content past what CARTO's (and, as a shared policy,
                // every provider's) terms permit.
                cache.delete(req);
                return fetch(req).then(function(res){
                  if (res && (res.ok || res.type === 'opaque')) {
                    cache.put(req, res.clone()).catch(function(){});
                    recordTileCachedNow(req);
                    trimTileCache(cache);
                  }
                  return res;
                });
              }
              // Serve the cached tile immediately (this is what makes offline
              // panning over already-seen ground work at all) and refresh it
              // in the background when online so tiles don't go stale forever
              // -- but a background refresh failing must never affect the
              // response already served, so it gets its own no-op catch.
              fetch(req).then(function(res){
                if (res && (res.ok || res.type === 'opaque')) {
                  cache.put(req, res.clone()).catch(function(){});
                  recordTileCachedNow(req);
                  trimTileCache(cache);
                }
              }).catch(function(){});
              return cached;
            });
          }
          // Not cached: return the network fetch's own promise directly,
          // rather than catching a failure into a fallback value. Resolving
          // respondWith() to anything other than a real Response -- null
          // included -- makes Chrome report the request as ERR_FAILED
          // instead of a normal network error. Letting a real rejection
          // propagate here means an offline, uncached tile fails exactly the
          // way it would with no service worker involved at all: no worse
          // than baseline, and no swallowed-into-null failure.
          return fetch(req).then(function(res){
            if (res && (res.ok || res.type === 'opaque')) {
              cache.put(req, res.clone()).catch(function(){});
              recordTileCachedNow(req);
              trimTileCache(cache);
            }
            return res;
          });
        });
      })
    );
    return;
  }

  // Cache-first for everything from this app's own origin: check cache,
  // serve instantly if present, and only touch the network if it's genuinely
  // missing. This is the piece that avoids "tries to reload, then wipes out
  // the map" -- there's no network round-trip (and no timeout to wait out)
  // standing between opening the app and seeing the map when there's no
  // signal.
  event.respondWith(
    caches.match(req).then(function(cached){
      if (cached) return cached;
      return fetch(req).then(function(res){
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function(cache){ cache.put(req, copy); });
        }
        return res;
      }).catch(function(){
        // Nothing cached and no network -- only real recourse is to fail
        // this one request; everything precached at install time still
        // works normally.
        return new Response('Offline and not cached.', { status: 503, statusText: 'Offline' });
      });
    })
  );
});
