/*
 * routes-data.js
 * The loaded-route data model: parsing a GPX file into a route object,
// persisting routes to localStorage, the route sidebar, direction
// arrows, loading/importing files (including drag-and-drop), and
// exporting a route as a standalone HTML file.
 *
 * Split out of index.html's single inline script into its own file
 * for navigability -- same global scope as before (classic scripts,
 * not modules), same execution order, no behavior change. See
 * mtbike-explorer/README.txt for why this split happened and how it
 * was verified.
 */
  var ROUTES_KEY = 'gpxExplorerRoutes';

  var routes = [];      // { name, rows, hasTime, hasEle, totalDistMi, totalTimeSec, pointCount }
  var activeIndex = -1;

  var sidebarList = document.getElementById('routeList');
  var errorBox = document.getElementById('errorBox');
  var dropOverlay = document.getElementById('dropOverlay');
  var statsPanel = document.getElementById('statsPanel');
  var statsPanelEmpty = document.getElementById('statsPanelEmpty');

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.style.display = 'block';
    setTimeout(function(){ errorBox.style.display = 'none'; }, 6000);
  }

  // ---- Persistence ----
  function saveRoutes() {
    try { localStorage.setItem(ROUTES_KEY, JSON.stringify(routes)); }
    catch (e) { showError('Could not save routes locally (storage full?). New routes will still work this session.'); }
  }
  function loadRoutes() {
    try {
      var raw = localStorage.getItem(ROUTES_KEY);
      routes = raw ? JSON.parse(raw) : [];
    } catch (e) { routes = []; }
  }

  // ---- GPX parsing ----
  function parseGPX(xmlText) {
    var parser = new DOMParser();
    var doc = parser.parseFromString(xmlText, 'application/xml');
    if (doc.querySelector('parsererror')) {
      throw new Error('This file isn\'t valid XML/GPX.');
    }
    var trkpts = doc.getElementsByTagName('trkpt');
    if (!trkpts.length) {
      throw new Error('No <trkpt> track points found in this GPX file.');
    }
    var pts = [];
    for (var i = 0; i < trkpts.length; i++) {
      var el = trkpts[i];
      var lat = parseFloat(el.getAttribute('lat'));
      var lon = parseFloat(el.getAttribute('lon'));
      if (isNaN(lat) || isNaN(lon)) continue;

      var eleEl = el.getElementsByTagName('ele')[0];
      var ele = eleEl ? parseFloat(eleEl.textContent) : null;

      var timeEl = el.getElementsByTagName('time')[0];
      var t = null;
      if (timeEl && timeEl.textContent) {
        var parsed = Date.parse(timeEl.textContent);
        if (!isNaN(parsed)) t = parsed;
      }
      pts.push({ lat: lat, lon: lon, ele: ele, t: t });
    }
    if (!pts.length) throw new Error('No usable track points found in this GPX file.');
    return pts;
  }

  function buildRoute(name, pts) {
    var n = pts.length;
    var hasTime = pts.every(function(p){ return p.t !== null; });
    var hasEle = pts.every(function(p){ return p.ele !== null; });
    var t0 = hasTime ? pts[0].t : null;

    var cumdistM = new Array(n);
    cumdistM[0] = 0;
    for (var i = 1; i < n; i++) {
      cumdistM[i] = cumdistM[i-1] + haversineM(pts[i-1].lat, pts[i-1].lon, pts[i].lat, pts[i].lon);
    }

    var target = 550;
    var step = Math.max(1, Math.floor(n / target));
    var idxs = [];
    for (var j = 0; j < n; j += step) idxs.push(j);
    if (idxs[idxs.length-1] !== n-1) idxs.push(n-1);

    var rows = idxs.map(function(i){
      var p = pts[i];
      var tSec = hasTime ? (p.t - t0) / 1000 : i;
      var eleFt = hasEle ? p.ele * 3.28084 : 0;
      var distMi = cumdistM[i] * 0.000621371;
      return [Math.round(tSec), Math.round(p.lat*100000)/100000, Math.round(p.lon*100000)/100000, Math.round(eleFt*10)/10, Math.round(distMi*10000)/10000];
    });

    return {
      name: name,
      rows: rows,
      hasTime: hasTime,
      hasEle: hasEle,
      totalDistMi: cumdistM[n-1] * 0.000621371,
      totalTimeSec: hasTime ? (pts[n-1].t - t0) / 1000 : null,
      pointCount: n
    };
  }



  // Small rotated triangle glyphs placed along a route's line showing which
  // way it was ridden. Spaced by distance (not by GPS point count) so arrow
  // density stays sensible regardless of how frequently a given watch/app
  // logs points -- a high-frequency recording shouldn't get 5x the arrows of
  // the same ride logged at a coarser interval.
  var ARROW_SPACING_MI = 0.2;
  var ARROW_BEARING_WINDOW_MI = 0.05; // smooths bearing over a short local
    // stretch rather than two adjacent (GPS-noise-prone) points
  function directionArrowIcon(deg) {
    // A small open arrowhead instead of a solid filled triangle, and semi-
    // transparent -- previously a bold 15px solid triangle with a heavy
    // 4-direction outline, which read as chunky and competed with the
    // route line itself for attention. See mtbike-explorer/README.txt,
    // "Trail styling redesign" for the side-by-side comparisons this came
    // from.
    return L.divIcon({
      className: 'route-direction-arrow',
      html: '<div style="transform: rotate(' + deg + 'deg);">'
        + '<svg width="11" height="11" viewBox="0 0 24 24"><path d="M12 3 L20 17 L12 13 L4 17 Z" '
        + 'fill="#fff" stroke="#1a1a1a" stroke-width="1.5" stroke-linejoin="round"/></svg>'
        + '</div>',
      iconSize: [11, 11], iconAnchor: [5.5, 5.5]
    });
  }
  function buildDirectionArrows(route) {
    var rows = route.rows;
    var markers = [];
    if (rows.length < 2) return markers;
    var nextMark = 0;
    for (var i = 0; i < rows.length - 1; i++) {
      if (rows[i][4] < nextMark) continue;
      var j = i;
      while (j < rows.length - 1 && (rows[j][4] - rows[i][4]) < ARROW_BEARING_WINDOW_MI) j++;
      if (j === i) j = i + 1; // near the very end of the ride, just use the next point
      var deg = bearingDeg(rows[i][1], rows[i][2], rows[j][1], rows[j][2]);
      markers.push(L.marker([rows[i][1], rows[i][2]], {
        icon: directionArrowIcon(deg), interactive: false, keyboard: false
      }));
      nextMark = rows[i][4] + ARROW_SPACING_MI;
    }
    return markers;
  }
  var directionArrowMarkers = [];
  function clearDirectionArrows() {
    directionArrowMarkers.forEach(function(m){ map.removeLayer(m); });
    directionArrowMarkers = [];
  }

  // ---- Group the sidebar's route list by which park each ride actually belongs to,
  // instead of one flat undifferentiated list once you've got rides from more than
  // one place loaded. Every network already ships a bounding box (used elsewhere for
  // map-fitting), so "nearest park by bbox center" is enough to sort a ride correctly
  // without repeating the expensive point-by-point trail matching the GPS-verified
  // feature does -- that answers "which trail," this only needs "which park." ----
  function networkCentroid(netId) {
    var b = window.PARK_BOUNDS && window.PARK_BOUNDS[netId];
    if (!b) return null;
    return { lat: (b.latMin + b.latMax) / 2, lon: (b.lonMin + b.lonMax) / 2 };
  }

  function routeCentroid(route) {
    var rows = route.rows, n = rows.length;
    if (!n) return null;
    // Sampling keeps this cheap on multi-thousand-point rides -- a centroid doesn't
    // need every point, just a representative spread of them.
    var step = Math.max(1, Math.floor(n / 200));
    var sumLat = 0, sumLon = 0, count = 0;
    for (var i = 0; i < n; i += step) { sumLat += rows[i][1]; sumLon += rows[i][2]; count++; }
    return { lat: sumLat / count, lon: sumLon / count };
  }

  function detectRouteNetworkId(route) {
    if (route._detectedNetworkId !== undefined) return route._detectedNetworkId; // cache per route object
    var c = routeCentroid(route);
    var best = null, bestD = Infinity;
    if (c) {
      Object.keys(NETWORKS).forEach(function(id){
        var nc = networkCentroid(id);
        if (!nc) return;
        var d = haversineMi(c.lat, c.lon, nc.lat, nc.lon);
        if (d < bestD) { bestD = d; best = id; }
      });
    }
    route._detectedNetworkId = best;
    return best;
  }

  function renderSidebar() {
    sidebarList.innerHTML = '';
    if (!routes.length) {
      var hint = document.createElement('p');
      hint.className = 'empty-hint';
      hint.textContent = 'No routes yet. Open or drop a GPX file.';
      sidebarList.appendChild(hint);
      return;
    }

    function makeRouteLi(r, idx) {
      var li = document.createElement('li');
      li.className = idx === activeIndex ? 'active' : '';
      var meta = r.totalDistMi.toFixed(1) + ' mi' + (r.hasTime && r.totalTimeSec ? ' · ' + fmtDuration(r.totalTimeSec) : '');
      var infoDiv = document.createElement('div');
      infoDiv.className = 'info';
      var fnameSpan = document.createElement('span');
      fnameSpan.className = 'fname';
      fnameSpan.textContent = r.name;
      fnameSpan.title = r.name; // native tooltip for whatever the ellipsis cuts off
      var fmetaSpan = document.createElement('span');
      fmetaSpan.className = 'fmeta';
      fmetaSpan.textContent = meta;
      infoDiv.appendChild(fnameSpan);
      infoDiv.appendChild(fmetaSpan);

      function startRename(ev) {
        if (ev) ev.stopPropagation();
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'fname-input';
        input.value = r.name;
        infoDiv.replaceChild(input, fnameSpan);
        input.focus();
        input.select();
        function commit() {
          var next = input.value.trim();
          if (next && next !== r.name) {
            r.name = next;
            saveRoutes();
            if (idx === activeIndex) document.getElementById('rTitle').textContent = r.name;
          }
          renderSidebar();
        }
        input.addEventListener('click', function(ev2){ ev2.stopPropagation(); });
        input.addEventListener('keydown', function(ev2){
          if (ev2.key === 'Enter') { ev2.preventDefault(); input.blur(); }
          else if (ev2.key === 'Escape') { ev2.preventDefault(); renderSidebar(); }
        });
        input.addEventListener('blur', commit);
      }

      var btnWrap = document.createElement('div');
      btnWrap.className = 'route-btns';
      var renameBtn = document.createElement('button');
      renameBtn.className = 'route-rename-btn';
      renameBtn.textContent = '✎';
      renameBtn.title = 'Rename this route';
      renameBtn.addEventListener('click', startRename);
      var delBtn = document.createElement('button');
      delBtn.className = 'route-del-btn';
      delBtn.textContent = '×';
      delBtn.title = 'Remove this route';
      delBtn.addEventListener('click', function(ev){ ev.stopPropagation(); removeRoute(idx); });
      btnWrap.appendChild(renameBtn);
      btnWrap.appendChild(delBtn);

      li.appendChild(infoDiv);
      li.appendChild(btnWrap);
      li.addEventListener('click', function(){ activate(idx); });
      return li;
    }

    var groupOrder = Object.keys(NETWORKS).concat(['_other']);
    var groups = {};
    routes.forEach(function(r, idx){
      var netId = detectRouteNetworkId(r) || '_other';
      (groups[netId] = groups[netId] || []).push(idx);
    });
    var presentGroups = groupOrder.filter(function(id){ return groups[id] && groups[id].length; });

    // Always show the park header, even with just one group present -- a
    // single park's worth of routes still benefits from a clear "this is
    // what you're looking at" heading anchoring the list, which is the
    // actual, common case (most real usage is mostly-one-park) that the
    // previous "skip it if there's nothing to tell apart" logic missed
    // entirely: with 19 of 19 routes in the same park, the header never
    // rendered at all, so the font-hierarchy fix meant to fix "this looks
    // like a pile of files" never got a chance to show up. Reported
    // directly after that fix shipped and still not visible -- caught by
    // actually checking the deployed page's DOM (0 headers, 19 flat
    // items), not by re-reasoning about the CSS that was already correct.
    presentGroups.forEach(function(netId){
      var idxs = groups[netId];
      var header = document.createElement('li');
      header.className = 'route-group-header';
      var label = netId === '_other' ? 'Other' : NETWORKS[netId].label;
      header.innerHTML = label + ' <span class="route-group-count">(' + idxs.length + ')</span>';
      sidebarList.appendChild(header);
      idxs.forEach(function(idx){ sidebarList.appendChild(makeRouteLi(routes[idx], idx)); });
    });
  }


  function removeRoute(idx) {
    routes.splice(idx, 1);
    saveRoutes();
    if (idx === activeIndex) {
      activeIndex = -1;
      if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
      clearDirectionArrows();
      if (routes.length) {
        activate(Math.min(idx, routes.length - 1));
      } else {
        showNoRouteInfo();
        renderSidebar();
      }
    } else {
      if (activeIndex > idx) activeIndex--;
      renderSidebar();
    }
  }

  function showRouteInfo(route) {
    document.getElementById('rTitle').textContent = route.name;
    var parts = [route.totalDistMi.toFixed(2) + ' mi'];
    if (route.hasTime && route.totalTimeSec) parts.push(fmtDuration(route.totalTimeSec));
    parts.push(route.pointCount.toLocaleString() + ' GPS points');
    document.getElementById('rSubtitle').textContent = parts.join(' · ');
    // #timeNote's text is fully owned by updateStatsFromSelection() (called right
    // after this in activate()) -- it knows whether a range is currently selected
    // and picks the right wording accordingly, so nothing needs setting here.
    statsPanel.style.display = 'block';
    statsPanelEmpty.style.display = 'none';
  }

  function showNoRouteInfo() {
    document.getElementById('rTitle').textContent = 'Explore the map';
    document.getElementById('rSubtitle').textContent = 'Search a place above, or drag a GPX file anywhere on this window.';
    statsPanel.style.display = 'none';
    statsPanelEmpty.style.display = 'block';
    panel3d.style.display = 'none';
  }

  // ---- Leaflet map setup (created once, at startup) ----
  function activate(idx) {
    activeIndex = idx;
    var route = routes[idx];
    showRouteInfo(route);

    selLo = null; selHi = null; hoverIdx = null;
    buildCharts(route);

    drawRoute(route);
    renderSidebar();
    updateStatsFromSelection();
    renderTrailsRiddenTab();

    // Switching the active route used to always force you back to the Map view --
    // if you were looking at 3D terrain, panel3d got hidden here but nothing ever
    // un-hid #mapWrap or reset the toggle buttons/legend, so BOTH views ended up
    // display:none at once: a blank viewport with the "3D" button still showing
    // itself as active. Staying in 3D and refreshing it for the new route (same
    // path the 3D toggle button itself uses) is both the fix and the better
    // behavior -- you don't get bounced out of 3D just for switching rides.
    if (document.body.classList.contains('showing3d')) {
      // Refreshing alone isn't enough if the new route is in a different park --
      // without this it silently kept showing whichever park's terrain happened to
      // be selected before, with the new route's line drawn (if at all) miles off
      // to the side of it. Clicking a specific route is a clear, deliberate signal
      // of intent, so it's treated the same as an explicit park-dropdown choice.
      var detectedNetId = detectRouteNetworkId(route);
      if (detectedNetId) setCurrentNetwork(detectedNetId, true);
      open3DPanel();
    } else {
      panel3d.style.display = 'none';
    }
  }

  function loadFile(file) {

    if (!file.name.toLowerCase().endsWith('.gpx')) {
      showError('"' + file.name + '" doesn\'t look like a .gpx file — skipped.');
      return;
    }
    var reader = new FileReader();
    reader.onload = function(e) {
      try {
        var pts = parseGPX(e.target.result);
        var route = buildRoute(file.name, pts);
        routes.push(route);
        saveRoutes();
        activate(routes.length - 1);
      } catch (err) {
        showError('Couldn\'t read "' + file.name + '": ' + err.message);
      }
    };
    reader.onerror = function() { showError('Failed to read "' + file.name + '".'); };
    reader.readAsText(file);
  }

  function loadFiles(fileList) {
    for (var i = 0; i < fileList.length; i++) loadFile(fileList[i]);
  }

  var dragDepth = 0;
  window.addEventListener('dragenter', function(e){
    e.preventDefault();
    dragDepth++;
    dropOverlay.classList.add('show');
  });
  window.addEventListener('dragover', function(e){ e.preventDefault(); });
  window.addEventListener('dragleave', function(e){
    dragDepth--;
    if (dragDepth <= 0) { dragDepth = 0; dropOverlay.classList.remove('show'); }
  });
  window.addEventListener('drop', function(e){
    e.preventDefault();
    dragDepth = 0;
    dropOverlay.classList.remove('show');
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
      loadFiles(e.dataTransfer.files);
    }
  });

  function buildStandaloneHTML(route) {
    var title = route.name.replace(/\.gpx$/i, '');
    var subtitleParts = [route.totalDistMi.toFixed(2) + ' mi'];
    if (route.hasTime && route.totalTimeSec) subtitleParts.push(fmtDuration(route.totalTimeSec));
    subtitleParts.push(route.pointCount.toLocaleString() + ' GPS points');
    var subtitle = subtitleParts.join(' · ');
    var timeNote = route.hasTime ? '' : ' This file has no per-point timestamps, so time/speed stats are unavailable — sliders move by point index instead.';

    return STANDALONE_TEMPLATE
      .replace(/{{title}}/g, title)
      .replace(/{{subtitle}}/g, subtitle)
      .replace('{{ROWS_JSON}}', JSON.stringify(route.rows))
      .replace('{{APIKEY}}', THUNDERFOREST_API_KEY)
      .replace('{{CARTOKEY}}', CARTO_API_KEY)
      .replace('{{HAS_TIME}}', route.hasTime ? 'true' : 'false')
      .replace(/{{timeNote}}/g, timeNote);
  }

  document.getElementById('exportBtn').addEventListener('click', function(){
    var route = routes[activeIndex];
    if (!route) return;
    var title = route.name.replace(/\.gpx$/i, '');
    var html = buildStandaloneHTML(route);

    var blob = new Blob([html], { type: 'text/html' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = title + '.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  var STANDALONE_TEMPLATE = [
    '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<title>Route explorer -- {{title}}</title>',
    '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css">',
    '<style>:root{--bg:#fff;--card:#f7f7f6;--border:#e5e5e3;--text:#111827;--text2:#4b5563;--text3:#9ca3af;--green:#16a34a;--red:#dc2626;}',
    '*{box-sizing:border-box;}body{margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:var(--bg);color:var(--text);}',
    'h1{font-size:1.3rem;font-weight:500;margin:0 0 4px;}.subtitle{color:var(--text2);font-size:.9rem;margin:0 0 18px;}',
    '.layout{display:flex;gap:20px;flex-wrap:wrap;align-items:flex-start;}.map-card{flex:1 1 480px;min-width:320px;}',
    '#mapWrap{width:100%;height:75vh;min-width:320px;min-height:260px;max-width:100%;max-height:85vh;resize:both;overflow:hidden;border-radius:12px;border:1px solid var(--border);}',
    '#mapDiv{width:100%;height:100%;background:#eee;}',
    '#mapDiv:fullscreen,#mapDiv:-webkit-full-screen{width:100vw;height:100vh;border-radius:0;border:none;}',
    '#mapDiv:-moz-full-screen{width:100vw;height:100vh;border-radius:0;border:none;}',
    '.legend{display:flex;gap:16px;margin-top:8px;font-size:12px;color:var(--text2);}.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px;}',
    '.panel{flex:0 0 280px;min-width:260px;}.slider-block{margin-bottom:16px;}.slider-block label{font-size:13px;color:var(--text2);display:block;margin-bottom:4px;}',
    '.slider-block .val{font-weight:500;color:var(--text);}input[type=range]{width:100%;}',
    '.stats{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px;}.stat{background:var(--card);border-radius:8px;padding:12px;}',
    '.stat p:first-child{font-size:11px;color:var(--text2);margin:0 0 4px;}.stat p:last-child{font-size:18px;font-weight:500;margin:0;}',
    '.note{font-size:12px;color:var(--text3);margin-top:14px;}',
    '.leaflet-marker-a{background:var(--green);border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,0.2);}',
    '.leaflet-marker-b{background:var(--red);border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,0.2);}',
    '</style></head><body>',
    '<h1>{{title}}</h1><p class="subtitle">{{subtitle}}</p>',
    '<div class="layout"><div class="map-card"><div id="mapWrap"><div id="mapDiv"></div></div>',
    '<div class="legend"><span><span class="dot" style="background:var(--green)"></span>point A</span>',
    '<span><span class="dot" style="background:var(--red)"></span>point B</span>',
    '<span style="color:var(--text3);"> &middot; drag the bottom-right corner to resize</span></div></div>',
    '<div class="panel"><div class="slider-block"><label>Point A &mdash; <span class="val" id="aTime"></span></label>',
    '<input type="range" id="sliderA" min="0" max="{{maxIdx}}" value="0" step="1"></div>',
    '<div class="slider-block"><label>Point B &mdash; <span class="val" id="bTime"></span></label>',
    '<input type="range" id="sliderB" min="0" max="{{maxIdx}}" value="{{maxIdx}}" step="1"></div>',
    '<div class="stats"><div class="stat"><p>Distance (along route)</p><p id="statDist">-</p></div>',
    '<div class="stat"><p>Straight-line distance</p><p id="statStraight">-</p></div>',
    '<div class="stat"><p>Time between points</p><p id="statTime">-</p></div>',
    '<div class="stat"><p>Avg speed</p><p id="statSpeed">-</p></div>',
    '<div class="stat"><p>Elevation change</p><p id="statEle">-</p></div>',
    '<div class="stat"><p>Climb / descent</p><p id="statGainLoss">-</p></div></div>',
    '<p class="note">Drag either slider to compare any two points on the route.{{timeNote}}</p></div></div>',
    '<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"><\/script>',
    '<script>',
    'var ROWS={{ROWS_JSON}};var HAS_TIME={{HAS_TIME}};var APIKEY="{{APIKEY}}";var CARTOKEY="{{CARTOKEY}}";',
    'var outdoors=L.tileLayer("https://{s}.tile.thunderforest.com/outdoors/{z}/{x}/{y}.png?apikey="+APIKEY,{attribution:"Maps &copy; Thunderforest, Data &copy; OpenStreetMap contributors",maxZoom:22});',
    'var streets=L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:"&copy; OpenStreetMap contributors",maxZoom:19});',
    'var topo=L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",{attribution:"Map data: &copy; OpenStreetMap contributors, SRTM | Map style: &copy; OpenTopoMap (CC-BY-SA)",maxZoom:17});',
    'var satellite=L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",{attribution:"Tiles &copy; Esri",maxZoom:19});',
    'var light=L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key="+CARTOKEY,{attribution:"&copy; OpenStreetMap contributors &copy; CARTO",maxZoom:19});',
    'var map=L.map("mapDiv",{layers:[outdoors]}).setView([ROWS[0][1],ROWS[0][2]],13);',
    'L.control.layers({"Outdoors":outdoors,"Terrain":topo,"Streets":streets,"Satellite":satellite,"Light":light}).addTo(map);',
    'var FullscreenControl=L.Control.extend({options:{position:"topright"},onAdd:function(){var container=L.DomUtil.create("div","leaflet-bar leaflet-control");var link=L.DomUtil.create("a","",container);link.href="#";link.title="Toggle fullscreen";link.innerHTML="&#x26F6;";link.style.fontSize="16px";link.style.display="flex";link.style.alignItems="center";link.style.justifyContent="center";L.DomEvent.disableClickPropagation(container);L.DomEvent.on(link,"click",L.DomEvent.stop);L.DomEvent.on(link,"click",function(){toggleFs(map.getContainer());});return container;}});',
    'function toggleFs(el){var isFull=document.fullscreenElement||document.webkitFullscreenElement||document.mozFullScreenElement;if(!isFull){var req=el.requestFullscreen||el.webkitRequestFullscreen||el.mozRequestFullScreen||el.msRequestFullscreen;if(req)req.call(el);}else{var exit=document.exitFullscreen||document.webkitExitFullscreen||document.mozCancelFullScreen||document.msExitFullscreen;if(exit)exit.call(document);}}',
    'map.addControl(new FullscreenControl());',
    'var onFsChange=function(){setTimeout(function(){map.invalidateSize();},100);};',
    'document.addEventListener("fullscreenchange",onFsChange);document.addEventListener("webkitfullscreenchange",onFsChange);document.addEventListener("mozfullscreenchange",onFsChange);',
    'if(window.ResizeObserver){new ResizeObserver(function(){map.invalidateSize();}).observe(document.getElementById("mapWrap"));}',
    'var coords=ROWS.map(function(r){return [r[1],r[2]];});',
    'L.polyline(coords,{color:"#fff",weight:9,opacity:0.9,lineCap:"round",lineJoin:"round"}).addTo(map);',
    'var routeLine=L.polyline(coords,{color:"#d6336c",weight:5,opacity:1,lineCap:"round",lineJoin:"round"}).addTo(map);',
    'map.fitBounds(routeLine.getBounds(),{padding:[24,24]});',
    'var aIcon=L.divIcon({className:"leaflet-marker-a",iconSize:[14,14]});',
    'var bIcon=L.divIcon({className:"leaflet-marker-b",iconSize:[14,14]});',
    'var markerA=L.marker(coords[0],{icon:aIcon}).addTo(map);',
    'var markerB=L.marker(coords[coords.length-1],{icon:bIcon}).addTo(map);',
    'var sliderA=document.getElementById("sliderA");var sliderB=document.getElementById("sliderB");',
    'var aTime=document.getElementById("aTime");var bTime=document.getElementById("bTime");',
    'var statDist=document.getElementById("statDist");var statStraight=document.getElementById("statStraight");',
    'var statTime=document.getElementById("statTime");var statSpeed=document.getElementById("statSpeed");',
    'var statEle=document.getElementById("statEle");var statGainLoss=document.getElementById("statGainLoss");',
    'function fmtElapsed(sec){var m=Math.floor(sec/60);var s=Math.round(sec%60);return m+":"+(s<10?"0":"")+s;}',
    'function haversineMi(lat1,lon1,lat2,lon2){var R=3958.8;var p1=lat1*Math.PI/180,p2=lat2*Math.PI/180;var dphi=(lat2-lat1)*Math.PI/180,dl=(lon2-lon1)*Math.PI/180;var a=Math.sin(dphi/2)*Math.sin(dphi/2)+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)*Math.sin(dl/2);return 2*R*Math.asin(Math.sqrt(a));}',
    'function update(){var ia=parseInt(sliderA.value,10);var ib=parseInt(sliderB.value,10);var lo=Math.min(ia,ib),hi=Math.max(ia,ib);var rowA=ROWS[ia],rowB=ROWS[ib];var rowLo=ROWS[lo],rowHi=ROWS[hi];',
    'markerA.setLatLng([rowA[1],rowA[2]]);markerB.setLatLng([rowB[1],rowB[2]]);',
    'aTime.textContent=HAS_TIME?fmtElapsed(rowA[0]):("point #"+ia);bTime.textContent=HAS_TIME?fmtElapsed(rowB[0]):("point #"+ib);',
    'var pathDist=rowHi[4]-rowLo[4];var straight=haversineMi(rowLo[1],rowLo[2],rowHi[1],rowHi[2]);var dur=rowHi[0]-rowLo[0];var eleChange=rowHi[3]-rowLo[3];',
    'var gain=0,loss=0;for(var i=lo+1;i<=hi;i++){var d=ROWS[i][3]-ROWS[i-1][3];if(d>0)gain+=d;else loss+=-d;}',
    'statDist.textContent=pathDist.toFixed(2)+" mi";statStraight.textContent=straight.toFixed(2)+" mi";',
    'if(HAS_TIME){var h=Math.floor(dur/3600),m=Math.floor((dur%3600)/60),s=Math.round(dur%60);statTime.textContent=(h>0?h+":":"")+(h>0&&m<10?"0":"")+m+":"+(s<10?"0":"")+s;var speed=dur>0?pathDist/(dur/3600):0;statSpeed.textContent=speed.toFixed(1)+" mph";}',
    'else{statTime.textContent="n/a (no timestamps)";statSpeed.textContent="n/a";}',
    'statEle.textContent=(eleChange>=0?"+":"")+Math.round(eleChange)+" ft";statGainLoss.textContent="+"+Math.round(gain)+" / -"+Math.round(loss)+" ft";}',
    'sliderA.addEventListener("input",update);sliderB.addEventListener("input",update);update();',
    '<\/script></body></html>'
  ].join('');

  // ---- 3D terrain view (real USGS elevation, WebGL via Three.js) ----
