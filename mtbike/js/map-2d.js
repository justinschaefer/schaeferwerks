/*
 * map-2d.js
 * The 2D Leaflet map: base layers, fullscreen toggle (shared with the
// 3D view -- see map-3d.js), live location/follow mode, drawing the
// active route and named-trail overlay, and place search.
 *
 * Split out of index.html's single inline script into its own file
 * for navigability -- same global scope as before (classic scripts,
 * not modules), same execution order, no behavior change. See
 * mtbike-explorer/README.txt for why this split happened and how it
 * was verified.
 */
  var map = null, routeLine = null, markerA = null, markerB = null;

  function toggleFullscreen(el, onToggle) {
    var nativeFull = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement;
    var isCssMax = el.classList.contains('js-maximized');
    if (nativeFull || isCssMax) {
      if (nativeFull) {
        var exit = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
        if (exit) exit.call(document);
      }
      el.classList.remove('js-maximized');
      document.body.classList.remove('has-js-maximized');
      // Clear any inline height a caller may have set for embedded/non-fullscreen
      // layout (see sizePanel3dForMobile) -- inline style always wins over the
      // stylesheet, so leaving it in place here would carry a stale px height
      // into whatever comes next. onToggle (e.g. on3DFullscreenToggle) is what
      // recomputes the right value for the state being returned to.
      el.style.height = '';
      if (onToggle) setTimeout(onToggle, 50);
      return;
    }
    var req = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
    var didFallback = false;
    function fallbackToCss() {
      if (didFallback) return;
      didFallback = true;
      el.classList.add('js-maximized');
      document.body.classList.add('has-js-maximized');
      // Same reasoning as the exit branch above, in the opposite direction: an
      // inline px height left over from the embedded mobile layout would block
      // the .js-maximized stylesheet rule's height:100vh from ever taking
      // effect (inline beats stylesheet), which is exactly what capped this
      // "fullscreen" fallback at the embedded view's height on iPhone instead
      // of actually filling the screen.
      el.style.height = '';
      if (onToggle) setTimeout(onToggle, 50);
    }
    if (req) {
      try {
        var result = req.call(el);
        if (result && typeof result.catch === 'function') result.catch(fallbackToCss);
      } catch (e) { fallbackToCss(); }
      // Same inline-height concern as the CSS fallback above applies to native
      // fullscreen too: Chromium's UA stylesheet sizes a :fullscreen element to
      // fill the screen by default, but an explicit inline height from the
      // embedded mobile layout can still override that default, so clear it
      // here as well rather than assuming native fullscreen is immune.
      el.style.height = '';
      // iPhone Safari doesn't support the Fullscreen API on non-video elements and
      // silently no-ops instead of rejecting -- verify shortly after and fall back to
      // a CSS-only "maximize" that works everywhere, just without hiding browser chrome.
      setTimeout(function(){
        var nowFull = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement;
        if (!nowFull) fallbackToCss();
      }, 300);
      if (onToggle) setTimeout(onToggle, 100);
    } else {
      fallbackToCss();
    }
  }

  function addFullscreenControl(map) {
    var FullscreenControl = L.Control.extend({
      options: { position: 'topright' },
      onAdd: function() {
        var container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
        var link = L.DomUtil.create('a', '', container);
        link.href = '#';
        link.title = 'Toggle fullscreen';
        link.innerHTML = '&#x26F6;';
        link.style.fontSize = '16px';
        link.style.display = 'flex';
        link.style.alignItems = 'center';
        link.style.justifyContent = 'center';
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.on(link, 'click', L.DomEvent.stop);
        L.DomEvent.on(link, 'click', function(){ toggleFullscreen(map.getContainer(), function(){ map.invalidateSize(); }); });
        return container;
      }
    });
    map.addControl(new FullscreenControl());

    var onFsChange = function(){ setTimeout(function(){ map.invalidateSize(); }, 100); };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    document.addEventListener('mozfullscreenchange', onFsChange);
  }

  var locateWatchId = null;
  var locateMarker = null;
  var locateAccuracyCircle = null;
  var locateLink = null;
  var fs3dBackBtn = document.getElementById('fs3dBackBtn');
  var fs3dLayersBtn = document.getElementById('fs3dLayersBtn');
  var fs3dLocateBtn = document.getElementById('fs3dLocateBtn');
  var fs3dFullscreenBtn = document.getElementById('fs3dFullscreenBtn');
  var panel3dLayersMenu = document.getElementById('panel3dLayersMenu');
  if (fs3dLocateBtn && !navigator.geolocation) fs3dLocateBtn.hidden = true;
  var locateHasFix = false;
  var lastLocateLatLng = null;

  function locateIcon() {
    return L.divIcon({ className: 'leaflet-marker-me pulsing', iconSize: [16,16] });
  }

  // ---- Follow mode: keep the map centered on you until you manually pan it away ----
  var followMode = true;
  var recenterBtn = document.getElementById('recenterBtn');
  function disengageFollow() {
    if (!followMode) return;
    followMode = false;
    if (recenterBtn) recenterBtn.style.display = 'block';
  }
  function reengageFollow() {
    followMode = true;
    if (recenterBtn) recenterBtn.style.display = 'none';
    if (lastLocateLatLng) map.setView(lastLocateLatLng, Math.max(map.getZoom(), 15));
  }

  function onLocatePosition(pos) {
    var latlng = [pos.coords.latitude, pos.coords.longitude];
    var acc = pos.coords.accuracy || 0;
    lastLocateLatLng = latlng;
    if (!locateMarker) {
      locateMarker = L.marker(latlng, { icon: locateIcon(), zIndexOffset: 1000, interactive: false }).addTo(map);
    } else {
      locateMarker.setLatLng(latlng);
    }
    if (!locateAccuracyCircle) {
      locateAccuracyCircle = L.circle(latlng, { radius: acc, color: '#2563eb', weight: 1, fillColor: '#2563eb', fillOpacity: 0.08 }).addTo(map);
    } else {
      locateAccuracyCircle.setLatLng(latlng);
      locateAccuracyCircle.setRadius(acc);
    }
    if (!locateHasFix) {
      locateHasFix = true;
      map.setView(latlng, Math.max(map.getZoom(), 15));
      if (locateLink) locateLink.classList.remove('pending');
    } else if (followMode) {
      map.setView(latlng, map.getZoom());
    }
    if (panel3d && panel3d.style.display !== 'none' && t3d.scene) updateT3DLocateMarker(latlng[0], latlng[1]);
  }

  function onLocateError(err) {
    if (locateLink) locateLink.classList.remove('pending');
    var msg = 'Could not get your location.';
    if (err && err.code === 1) msg = 'Location access was denied. Enable it for this site in your phone\'s Settings to use "my location".';
    else if (err && err.code === 3) msg = 'Location request timed out — try again, or move somewhere with a clearer GPS signal.';
    showError(msg);
    stopLocate();
  }

  function startLocate() {
    if (!navigator.geolocation) return;
    locateHasFix = false;
    followMode = true;
    if (recenterBtn) recenterBtn.style.display = 'none';
    if (locateLink) { locateLink.classList.add('active', 'pending'); }
    if (fs3dLocateBtn) fs3dLocateBtn.classList.add('active');
    locateWatchId = navigator.geolocation.watchPosition(onLocatePosition, onLocateError, {
      enableHighAccuracy: true, maximumAge: 5000, timeout: 15000
    });
  }

  function stopLocate() {
    if (locateWatchId !== null) { navigator.geolocation.clearWatch(locateWatchId); locateWatchId = null; }
    if (locateMarker) { map.removeLayer(locateMarker); locateMarker = null; }
    if (locateAccuracyCircle) { map.removeLayer(locateAccuracyCircle); locateAccuracyCircle = null; }
    if (locateLink) { locateLink.classList.remove('active', 'pending'); }
    if (fs3dLocateBtn) fs3dLocateBtn.classList.remove('active');
    locateHasFix = false;
    if (recenterBtn) recenterBtn.style.display = 'none';
    removeT3DLocateMarker();
  }

  function addLocateControl(map) {
    // Only offer this if the browser can actually provide a location — otherwise the option shouldn't show at all.
    if (!navigator.geolocation) return;
    var LocateControl = L.Control.extend({
      options: { position: 'topright' },
      onAdd: function() {
        var container = L.DomUtil.create('div', 'leaflet-bar leaflet-control locate-control');
        var link = L.DomUtil.create('a', '', container);
        link.href = '#';
        link.title = 'Show my location';
        link.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><line x1="12" y1="2" x2="12" y2="5"></line><line x1="12" y1="19" x2="12" y2="22"></line><line x1="2" y1="12" x2="5" y2="12"></line><line x1="19" y1="12" x2="22" y2="12"></line></svg>';
        link.style.display = 'flex';
        link.style.alignItems = 'center';
        link.style.justifyContent = 'center';
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.on(link, 'click', L.DomEvent.stop);
        L.DomEvent.on(link, 'click', function(){
          if (locateWatchId !== null) stopLocate();
          else startLocate();
        });
        locateLink = link;
        return container;
      }
    });
    map.addControl(new LocateControl());
  }

  function ensureMap() {
    if (map) return;
    var outdoors = L.tileLayer('https://{s}.tile.thunderforest.com/outdoors/{z}/{x}/{y}.png?apikey=' + THUNDERFOREST_API_KEY, {
      attribution: 'Maps &copy; Thunderforest, Data &copy; OpenStreetMap contributors', maxZoom: 22
    });
    // Thunderforest's own description: "a soft, restrained colour palette
    // that provides context without overwhelming... an ideal base map for
    // overlaid content." That's exactly the pairing this needed once the
    // named-trail overlay (see draw2DTrailNetwork) existed to actually BE the
    // overlaid content -- Outdoors already bakes its own hiking-trail
    // rendering into the tile images, which can visually compete with our
    // own trail colors for the same trails. Same API key as Outdoors, no
    // additional cost or setup.
    var atlas = L.tileLayer('https://{s}.tile.thunderforest.com/atlas/{z}/{x}/{y}.png?apikey=' + THUNDERFOREST_API_KEY, {
      attribution: 'Maps &copy; Thunderforest, Data &copy; OpenStreetMap contributors', maxZoom: 22
    });
    var streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors', maxZoom: 19
    });
    var topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      attribution: 'Map data: &copy; OpenStreetMap contributors, SRTM | Map style: &copy; OpenTopoMap (CC-BY-SA)', maxZoom: 17
    });
    var satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri', maxZoom: 19
    });
    var light = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=' + CARTO_API_KEY, {
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO', maxZoom: 19
    });

    map = L.map('mapDiv', { layers: [outdoors] }).setView([45.5, -122.4], 6);
    L.control.layers({
      'Outdoors': outdoors, 'Atlas': atlas, 'Terrain': topo, 'Streets': streets, 'Satellite': satellite, 'Light': light
    }).addTo(map);
    addFullscreenControl(map);
    addLocateControl(map);
    map.on('dragstart', function(){ if (locateWatchId !== null) disengageFollow(); });

    var loadOverlay = document.getElementById('loadOverlay');
    if (loadOverlay) loadOverlay.remove();
    setTimeout(function(){ map.invalidateSize(); }, 0);

    var aIcon = L.divIcon({ className: 'leaflet-marker-a', iconSize: [14,14] });
    var bIcon = L.divIcon({ className: 'leaflet-marker-b', iconSize: [14,14] });
    markerA = L.marker([0,0], { icon: aIcon }).addTo(map);
    markerB = L.marker([0,0], { icon: bIcon }).addTo(map);
    map.removeLayer(markerA);
    map.removeLayer(markerB);



    var mapWrap = document.getElementById('mapWrap');
    if (window.ResizeObserver) {
      new ResizeObserver(function(){ map.invalidateSize(); }).observe(mapWrap);
    } else {
      window.addEventListener('resize', function(){ map.invalidateSize(); });
    }
  }

  function drawRoute(route) {
    var coords = route.rows.map(function(r){ return [r[1], r[2]]; });
    if (routeLine) map.removeLayer(routeLine);
    // A white halo under the rider's own route, same treatment the trail
    // network already got below (and route weight/prominence bumped above
    // it) -- previously only the reference trails had a halo, so the one
    // thing you actually care about read as LESS visually dominant than the
    // context around it. See mtbike-explorer/README.txt, "Trail styling
    // redesign" for the mockups this came from. Grouped into one
    // L.featureGroup so routeLine stays a single Leaflet layer everywhere
    // else in the app that touches it (map.removeLayer, .getBounds()) --
    // no other file needs to know it's actually two lines underneath.
    var halo = L.polyline(coords, { color: '#fff', weight: 9, opacity: 0.9, lineCap: 'round', lineJoin: 'round' });
    var line = L.polyline(coords, { color: '#d6336c', weight: 5, opacity: 1, lineCap: 'round', lineJoin: 'round' });
    routeLine = L.featureGroup([halo, line]).addTo(map);
    clearDirectionArrows();
    directionArrowMarkers = buildDirectionArrows(route);
    directionArrowMarkers.forEach(function(m){ m.addTo(map); });
    if (!map.hasLayer(markerA)) map.addLayer(markerA);
    if (!map.hasLayer(markerB)) map.addLayer(markerB);
    map.invalidateSize();
    map.fitBounds(routeLine.getBounds(), { padding: [24, 24] });
  }

  // ---- Named trail network on the flat map -- previously only the 3D view
  // showed this; the 2D map only ever drew your own loaded ride, which is a
  // big part of why it read as "a GPX viewer" rather than "a trail map" the
  // way Trailforks/Komoot do. Each trail gets a wider white "halo" line under
  // a narrower colored line -- standard trail-map cartography for keeping a
  // colored line legible over a busy, varyingly-colored base map -- plus a
  // hover tooltip with the trail's name, matching the 3D view's hover. ----
  var network2DLayer = null; // L.layerGroup holding every halo+color pair, so show/hide is one call
  function clear2DTrailNetwork() {
    if (network2DLayer) { map.removeLayer(network2DLayer); network2DLayer = null; }
  }
  function draw2DTrailNetwork() {
    clear2DTrailNetwork();
    if (!show2dNetworkInput || !show2dNetworkInput.checked) return;
    var net = currentTrailData();
    if (!net) return;
    var group = L.layerGroup();
    // Singletrack-only on the 2D map now -- fire roads are already visible
    // and named on the base map tiles themselves (they're real roads), so
    // overlaying our own copy on top of them just covered up something
    // already legible instead of helping. Singletrack is the opposite case:
    // base tiles often don't show it at all, or only render/label it once
    // you're zoomed in uncomfortably far, which is the actual reason this
    // overlay exists. Fire road data (net.roads) is left completely alone
    // here -- it's still used by the 3D view (map-3d.js), which has no base
    // map labeling to lean on and still benefits from drawing them.
    function addCategory(dataset, opts) {
      Object.keys(dataset).forEach(function(name){
        dataset[name].forEach(function(seg){
          if (seg.length < 2) return;
          L.polyline(seg, { color: '#fff', weight: opts.haloWeight, opacity: 0.6, lineCap: 'round', lineJoin: 'round' }).addTo(group);
          L.polyline(seg, { color: opts.color, weight: opts.weight, opacity: opts.opacity, dashArray: opts.dashArray || null, lineCap: 'round', lineJoin: 'round' })
            .bindTooltip(opts.tooltip || name, { sticky: true })
            .addTo(group);
        });
      });
    }
    // A plain array of raw segments, not name-keyed -- for geometry that's
    // real and worth drawing but that nobody's put a name to (see
    // mtbike-explorer/README.txt, "Empire Grade / Highway 9 data split").
    // Every segment gets the same generic tooltip instead of a fake
    // per-segment name.
    function addUnnamedCategory(segList, opts) {
      (segList || []).forEach(function(seg){
        if (seg.length < 2) return;
        L.polyline(seg, { color: '#fff', weight: opts.haloWeight, opacity: 0.5, lineCap: 'round', lineJoin: 'round' }).addTo(group);
        L.polyline(seg, { color: opts.color, weight: opts.weight, opacity: opts.opacity, dashArray: opts.dashArray || null, lineCap: 'round', lineJoin: 'round' })
          .bindTooltip(opts.tooltip, { sticky: true })
          .addTo(group);
      });
    }
    addCategory(net.singletrack, { color: NETWORK_SINGLETRACK_COLOR, haloWeight: 3.5, weight: 1.75, opacity: 0.7 });
    // Named trails that are real but sit outside this park's core area (across
    // Empire Grade, e.g. the four re-homed here plus Wilder-style finds) --
    // drawn for context, dashed and muted so they don't read as part of the
    // core network, and deliberately NOT added to net.singletrack so they
    // never show up in the trail pickers (compare-trails.js only ever reads
    // net.singletrack / net.roads).
    if (net.wilderSingletrack) {
      addCategory(net.wilderSingletrack, { color: NETWORK_WILDER_COLOR, haloWeight: 3, weight: 1.5, opacity: 0.65, dashArray: '6,4' });
    }
    // Real, mapped-but-unnamed connector paths inside the core area (the
    // Side Saddle / Pipeline cluster) -- drawn so the map is honest about
    // what's actually on the ground, without inventing names for them.
    if (net.unnamedPaths) {
      addUnnamedCategory(net.unnamedPaths, { color: NETWORK_UNNAMED_COLOR, haloWeight: 2.5, weight: 1.25, opacity: 0.6, dashArray: '1,4', tooltip: 'Unnamed path' });
    }
    group.addTo(map);
    network2DLayer = group;
  }

  // ---- Search ----
  var searchInput = document.getElementById('searchInput');
  var searchBtn = document.getElementById('searchBtn');

  function searchLocation() {
    var q = searchInput.value.trim();
    if (!q) return;
    searchBtn.disabled = true;
    searchBtn.textContent = 'Searching…';
    fetch('https://photon.komoot.io/api/?q=' + encodeURIComponent(q) + '&limit=1')
      .then(function(res){ return res.json(); })
      .then(function(data){
        searchBtn.disabled = false;
        searchBtn.textContent = 'Search';
        if (!data.features || !data.features.length) {
          showError('No results for "' + q + '".');
          return;
        }
        var coords = data.features[0].geometry.coordinates; // [lon, lat]
        map.setView([coords[1], coords[0]], 14);
      })
      .catch(function(){
        searchBtn.disabled = false;
        searchBtn.textContent = 'Search';
        showError('Search failed — check your internet connection and try again.');
      });
  }
  searchBtn.addEventListener('click', searchLocation);
  searchInput.addEventListener('keydown', function(ev){ if (ev.key === 'Enter') searchLocation(); });

  // ---- Elevation & Speed charts: click-and-drag a range on either chart to compare
  // any two points on the route (replaces the old two-slider design). "Nothing
  // selected" falls back to whole-route stats; dragging sets a shared point-index
  // range that both charts, the map A/B markers, and the 3D A/B markers all read
  // from, since a chart index means the same physical point on the route in both
  // charts even though one plots against distance and the other against time. ----
