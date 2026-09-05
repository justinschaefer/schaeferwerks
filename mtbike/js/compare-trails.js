/*
 * compare-trails.js
 * Matching real GPS rides to named trails, the Trails-ridden tab, and
// the Compare-trails tool (trail picker, GPS-verified vs. terrain-grid
// stats, chart/table/profile rendering).
 *
 * Split out of index.html's single inline script into its own file
 * for navigability -- same global scope as before (classic scripts,
 * not modules), same execution order, no behavior change. See
 * mtbike-explorer/README.txt for why this split happened and how it
 * was verified.
 */
  var compareTabContent = document.getElementById('compareTabContent');
  var compareToggleBtn = document.getElementById('compareToggleBtn');
  var backToMapBtn = document.getElementById('backToMapBtn');
  var compareNetworkSelect = document.getElementById('compareNetworkSelect');
  var compareFilterInputEl = document.getElementById('compareFilterInput');
  var compareCountEl = document.getElementById('compareCountEl');
  var compareBrowseAreaEl = document.getElementById('compareBrowseArea');
  var compareSelBarEl = document.getElementById('compareSelBar');
  var compareSelBarTextEl = document.getElementById('compareSelBarText');
  var compareClearSelBtn = document.getElementById('compareClearSelBtn');
  var compareHiResInput = document.getElementById('compareHiRes');
  var compareRunBtn = document.getElementById('compareRunBtn');
  var compareStatusEl = document.getElementById('compareStatus');
  var compareResultsEl = document.getElementById('compareResults');
  var COMPARE_MAX = 6;
  var NETWORK_SHORT = { ucsc: 'UCSC', annadel: 'Annadel', lacamas: 'Lacamas' };
  var compareSelection = [];

  if (allNetworkIds.length && compareToggleBtn) compareToggleBtn.style.display = 'inline-block';

  function compareSetStatus(msg, isErr) {
    compareStatusEl.textContent = msg || '';
    compareStatusEl.classList.toggle('err', !!isErr);
  }

  function populateCompareNetworkSelect() {
    if (!compareNetworkSelect) return;
    compareNetworkSelect.innerHTML = '';
    allNetworkIds.forEach(function(id){
      var opt = document.createElement('option');
      opt.value = id;
      opt.textContent = NETWORKS[id].label;
      compareNetworkSelect.appendChild(opt);
    });
    compareNetworkSelect.value = currentNetworkId;
  }

  function tbFmt(n, d) { return n.toFixed(d === undefined ? 1 : d); }

  function tbNormalizeForFilter(s) {
    // Strip anything that isn't a letter/number so a stray comma, period, or extra
    // space doesn't zero out a match that's right there.
    return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  // ---- Full trail-list browser: computes stats for every named trail in a park at
  // once -- same GPS-verified-first, grid-fallback logic runCompare() already uses
  // per-trail, just run for the whole park so you can sort/filter/browse instead of
  // needing to already know which trail names you want before you can compare them. ----
  var tbAllStats = [];
  var tbSortKey = 'maxPitch', tbSortDir = -1;
  var tbFilterText = '';
  var tbExpanded = {};
  var tbReversedState = {};
  var tbSelected = {};

  function tbComputeAllForPark(id) {
    var netDef = NETWORKS[id];
    var data = netDef && window[netDef.trailVar];
    var terrainData = netDef && window[netDef.terrainVar];
    var out = [];
    if (!data) return out;
    ['singletrack', 'roads'].forEach(function(cat){
      if (!data[cat]) return;
      Object.keys(data[cat]).forEach(function(name){
        var segments = chainSegments(data[cat][name]);
        var elevsBySegMapped = segments.map(function(seg){
          return seg.map(function(pt){ return gridElevFt(terrainData, pt[0], pt[1]); });
        });
        var reversedSegments = reverseSegments(segments);
        var elevsBySegReversed = reversedSegments.map(function(seg){
          return seg.map(function(pt){ return gridElevFt(terrainData, pt[0], pt[1]); });
        });
        var visits = findRealVisitsForTrail(id, name);
        out.push({
          name: name, cat: cat, networkId: id,
          gridMapped: computeCompareStats(segments, elevsBySegMapped),
          gridReversed: computeCompareStats(reversedSegments, elevsBySegReversed),
          gpsMajority: visits.length ? pickGpsVerifiedStats(visits, false) : null,
          gpsMinority: visits.length ? pickGpsVerifiedStats(visits, true) : null,
          gpsVisitCount: visits.length
        });
      });
    });
    return out;
  }

  function tbResolveRow(r) {
    var reversed = !!tbReversedState[r.name];
    if (reversed) {
      if (r.gpsMinority) return { stats: r.gpsMinority, source: 'gps' };
      return { stats: r.gridReversed, source: 'grid' };
    }
    if (r.gpsMajority) return { stats: r.gpsMajority, source: 'gps' };
    return { stats: r.gridMapped, source: 'grid' };
  }

  var TB_SORT_COLS = {
    name:      { label: 'Trail',        get: function(r){ return r.name.toLowerCase(); }, num: false },
    lengthMi:  { label: 'Length',       get: function(r){ return tbResolveRow(r).stats.lengthMi; }, num: true },
    elevMax:   { label: 'Elev range',   get: function(r){ return tbResolveRow(r).stats.elevMax; }, num: true },
    avgGrade:  { label: 'Avg grade',    get: function(r){ return tbResolveRow(r).stats.avgGrade; }, num: true },
    maxPitch:  { label: 'Max pitch',    get: function(r){ return Math.abs(tbResolveRow(r).stats.maxPitch); }, num: true },
    sustained: { label: 'Sustained',    get: function(r){ return Math.abs(tbResolveRow(r).stats.sustainedMaxGrade); }, num: true },
    climbPct:  { label: 'Climbing',     get: function(r){ return tbResolveRow(r).stats.climbPct; }, num: true },
    longestClimbFt: { label: 'Longest climb', get: function(r){ return tbResolveRow(r).stats.longestClimbFt; }, num: true },
    gain:      { label: 'Gain / Loss',  get: function(r){ return tbResolveRow(r).stats.gain; }, num: true }
  };
  var TB_SORT_ORDER = ['name', 'lengthMi', 'elevMax', 'avgGrade', 'maxPitch', 'sustained', 'climbPct', 'longestClimbFt', 'gain'];

  function tbRenderProfileDetail(colSpan, s, source, r) {
    var descNote = s.descentCount
      ? (s.descentCount + ' dip' + (s.descentCount > 1 ? 's' : '') + ', longest ' + Math.round(s.longestDescFt) + ' ft @ ' + tbFmt(s.longestDescGrade) + '%')
      : 'none';
    var gpsNote = source === 'gps'
      ? ('<div class="tb-segwarn">Averaged from ' + s.gpsVisitCount + ' of your real ride' + (s.gpsVisitCount > 1 ? 's' : '') + '.</div>')
      : ('<div class="tb-segwarn">Terrain-grid estimate, direction as OSM mapped it' + (tbReversedState[r.name] ? ' (reversed)' : '') + '. Click &#8635; next to the name to flip direction' + (r.gpsVisitCount ? ', or check your loaded rides for the other direction.' : '.') + '</div>');
    return '<tr class="tb-detail-row"><td colspan="' + colSpan + '">' +
      '<div class="tb-profile-body">' +
        '<div class="tb-profile-chart">' + renderProfileSvg(s.profile, 700, 70) + '</div>' +
        '<div class="tb-profile-stats">' +
          '<div><b>' + tbFmt(s.climbPct, 0) + '%</b> climbing (' + tbFmt(s.climbFt / 5280, 2) + ' mi), <b>' + tbFmt(s.descPct, 0) + '%</b> descending &mdash; ' + descNote + '</div>' +
          '<div>Longest sustained climb: <b>' + tbFmt(s.longestClimbMi, 2) + ' mi</b> @ ' + (s.longestClimbGrade>0?'+':'') + tbFmt(s.longestClimbGrade) + '%</div>' +
          '<div>Steepest sustained ~100ft: <b>' + (s.sustainedMaxGrade>0?'+':'') + tbFmt(s.sustainedMaxGrade) + '%</b> (vs. instantaneous max pitch ' + tbFmt(Math.abs(s.maxPitch)) + '%, which can be a single noisy point)</div>' +
          gpsNote +
        '</div>' +
      '</div>' +
    '</td></tr>';
  }

  function tbRenderTable(rows) {
    var colCount = TB_SORT_ORDER.length;
    var html = '<table><thead><tr><th class="selcol"></th>';
    TB_SORT_ORDER.forEach(function(key){
      var col = TB_SORT_COLS[key];
      var arrow = tbSortKey === key ? (tbSortDir === 1 ? '&#9650;' : '&#9660;') : '';
      html += '<th data-key="' + key + '"' + (col.num ? ' class="num"' : '') + '>' + col.label + '<span class="tb-arrow">' + arrow + '</span></th>';
    });
    html += '<th>Source</th></tr></thead><tbody>';
    rows.forEach(function(r){
      var resolved = tbResolveRow(r);
      var s = resolved.stats;
      html += '<tr class="tb-datarow' + (tbSelected[r.name] ? ' is-selected' : '') + '" data-name="' + r.name.replace(/"/g, '&quot;') + '">' +
        '<td class="selcol"><input type="checkbox" class="tbSelCheckbox"' + (tbSelected[r.name] ? ' checked' : '') + ' title="Select for comparison"></td>' +
        '<td class="tb-trailname"><span class="tb-expandToggle">' + (tbExpanded[r.name] ? '&#9660; ' : '&#9656; ') + r.name + '</span> <button type="button" class="tb-revBtn' + (tbReversedState[r.name] ? ' active' : '') + '" title="Flip direction">&#8635;</button>' + (s.segCount > 1 ? ' <span class="tb-segwarn">(' + s.segCount + ' segs)</span>' : '') + (r.cat === 'roads' ? ' <span class="tb-cat">fire road</span>' : '') + '</td>' +
        '<td class="num">' + tbFmt(s.lengthMi, 2) + ' mi</td>' +
        '<td class="num">' + Math.round(s.elevMin) + '&ndash;' + Math.round(s.elevMax) + ' ft</td>' +
        '<td class="num" style="color:' + (s.avgGrade < 0 ? 'var(--red)' : 'var(--green)') + '">' + (s.avgGrade > 0 ? '+' : '') + tbFmt(s.avgGrade) + '%</td>' +
        '<td class="num">' + tbFmt(Math.abs(s.maxPitch)) + '%</td>' +
        '<td class="num">' + (s.sustainedMaxGrade > 0 ? '+' : '') + tbFmt(s.sustainedMaxGrade) + '%</td>' +
        '<td class="num">' + Math.round(s.climbPct) + '%</td>' +
        '<td class="num">' + Math.round(s.longestClimbFt) + ' ft</td>' +
        '<td class="num">+' + Math.round(s.gain) + ' / -' + Math.round(s.loss) + ' ft</td>' +
        '<td>' + sourceBadge(resolved.source) + '</td>' +
        '</tr>';
      if (tbExpanded[r.name]) html += tbRenderProfileDetail(colCount + 2, s, resolved.source, r);
    });
    html += '</tbody></table>';
    return html;
  }

  function tbSelectedNames() {
    return Object.keys(tbSelected).filter(function(n){ return tbSelected[n]; });
  }

  function tbUpdateSelBar() {
    var names = tbSelectedNames();
    compareSelBarEl.classList.toggle('visible', names.length > 0);
    compareSelBarTextEl.textContent = names.length + ' selected';
  }

  function tbRerender() {
    var rows = tbAllStats.filter(function(r){
      return !tbFilterText || tbNormalizeForFilter(r.name).indexOf(tbFilterText) !== -1;
    });
    rows = rows.slice().sort(function(a, b){
      var av = TB_SORT_COLS[tbSortKey].get(a), bv = TB_SORT_COLS[tbSortKey].get(b);
      if (av < bv) return -1 * tbSortDir;
      if (av > bv) return 1 * tbSortDir;
      return 0;
    });

    compareCountEl.textContent = rows.length + ' of ' + tbAllStats.length + ' trails';
    compareBrowseAreaEl.innerHTML = rows.length ? ('<div class="tb-tablewrap">' + tbRenderTable(rows) + '</div>') : '<div class="cmp-status">No trails match that filter.</div>';

    Array.prototype.forEach.call(compareBrowseAreaEl.querySelectorAll('th[data-key]'), function(th){
      th.addEventListener('click', function(){
        var key = th.getAttribute('data-key');
        if (tbSortKey === key) tbSortDir *= -1; else { tbSortKey = key; tbSortDir = key === 'name' ? 1 : -1; }
        tbRerender();
      });
    });

    Array.prototype.forEach.call(compareBrowseAreaEl.querySelectorAll('tr.tb-datarow'), function(tr){
      var name = tr.getAttribute('data-name');
      tr.querySelector('.tb-expandToggle').addEventListener('click', function(){
        tbExpanded[name] = !tbExpanded[name];
        tbRerender();
      });
      var revBtn = tr.querySelector('.tb-revBtn');
      if (revBtn) {
        revBtn.addEventListener('click', function(e){
          e.stopPropagation();
          tbReversedState[name] = !tbReversedState[name];
          tbRerender();
        });
      }
      var checkbox = tr.querySelector('.tbSelCheckbox');
      if (checkbox) {
        checkbox.addEventListener('click', function(e){ e.stopPropagation(); });
        checkbox.addEventListener('change', function(){
          if (checkbox.checked) tbSelected[name] = true; else delete tbSelected[name];
          tr.classList.toggle('is-selected', checkbox.checked);
          tbUpdateSelBar();
        });
      }
    });

    tbUpdateSelBar();
  }

  function tbLoadPark(id) {
    tbExpanded = {};
    tbReversedState = {};
    tbSelected = {}; // selections are scoped to the park you're browsing -- switching
                      // parks means starting a fresh pick, not silently mixing two
                      // networks' trail names under one currentNetworkId assumption.
    compareSetStatus('Loading ' + (NETWORKS[id] ? NETWORKS[id].label : id) + '…');
    ensureParkLoaded(id).then(function(){
      compareSetStatus('');
      tbAllStats = tbComputeAllForPark(id);
      tbRerender();
    }).catch(function(){
      compareSetStatus('Could not load ' + (NETWORKS[id] ? NETWORKS[id].label : id) + ' — check your connection.', true);
    });
  }

  function tbRunCompareSelected() {
    var names = tbSelectedNames();
    if (!names.length) return;
    if (names.length > COMPARE_MAX) {
      compareSetStatus('Up to ' + COMPARE_MAX + ' trails at a time keeps the chart readable — uncheck a few first (' + names.length + ' selected).', true);
      return;
    }
    compareSetStatus('');
    compareSelection = names.map(function(n){ return { name: n, networkId: currentNetworkId, reversed: !!tbReversedState[n] }; });
    runCompare();
  }

  var tabDetailsBtn = document.getElementById('tabDetailsBtn');
  var tabTrailsBtn = document.getElementById('tabTrailsBtn');
  if (allNetworkIds.length && tabTrailsBtn) tabTrailsBtn.style.display = 'inline-block';
  var detailsTabContent = document.getElementById('detailsTabContent');
  var trailsTabContent = document.getElementById('trailsTabContent');
  var trailsTabBodyEl = document.getElementById('trailsTabBody');

  // ---- Trails ridden: for the currently active route, which named trails did it
  // actually cover -- reusing the exact same GPS-matching findRealVisitsForTrail
  // already does per-trail, just filtered down to visits from THIS route instead of
  // aggregating across every loaded ride. Different question from Compare (which
  // trail is steeper) or Details (this route's own elevation/speed) -- this is
  // "what did I actually ride, in the order I rode it." ----
  function computeTrailsOnRoute(route) {
    var netId = detectRouteNetworkId(route);
    var netDef = netId && NETWORKS[netId];
    var data = netDef && window[netDef.trailVar];
    var items = [];
    if (!data) return { netId: netId, items: items };
    ['singletrack', 'roads'].forEach(function(cat){
      if (!data[cat]) return;
      Object.keys(data[cat]).forEach(function(name){
        var visits = findRealVisitsForTrail(netId, name).filter(function(v){ return v.routeName === route.name; });
        if (!visits.length) return;
        var distMi = visits.reduce(function(sum, v){ return sum + v.distMi; }, 0);
        var timeSec = route.hasTime
          ? visits.reduce(function(sum, v){ return sum + (v.rows[v.rows.length-1][0] - v.rows[0][0]); }, 0)
          : null;
        var firstDist = Math.min.apply(null, visits.map(function(v){ return v.rows[0][4]; }));
        items.push({ name: name, cat: cat, distMi: distMi, timeSec: timeSec, visitCount: visits.length, firstDist: firstDist });
      });
    });
    items.sort(function(a, b){ return a.firstDist - b.firstDist; }); // order encountered along the ride
    return { netId: netId, items: items };
  }

  function renderTrailsRiddenTab() {
    if (!trailsTabBodyEl) return;
    var route = routes[activeIndex];
    if (!route) {
      trailsTabBodyEl.innerHTML = '<div class="panel-empty"><p>Load a GPX file to see which named trails it covers.</p></div>';
      return;
    }
    var result = computeTrailsOnRoute(route);
    if (!result.netId) {
      trailsTabBodyEl.innerHTML = '<div class="panel-empty"><p>This route isn\'t close enough to any loaded park\'s trail network to match against named trails.</p></div>';
      return;
    }
    if (!result.items.length) {
      trailsTabBodyEl.innerHTML = '<div class="panel-empty"><p>No named trails in ' + NETWORKS[result.netId].label + ' matched this ride closely enough to count (needs a sustained stretch within about 40 ft of the mapped line). It may be mostly unnamed connectors or roads, or a park without full trail coverage yet.</p></div>';
      return;
    }
    var matchedMi = result.items.reduce(function(sum, it){ return sum + it.distMi; }, 0);
    var pct = route.totalDistMi ? Math.round(matchedMi / route.totalDistMi * 100) : 0;
    var html = '<p class="chart-hint">' + result.items.length + ' named trail' + (result.items.length > 1 ? 's' : '') + ' in ' + NETWORKS[result.netId].label + ', covering about ' + matchedMi.toFixed(1) + ' mi (' + pct + '%) of this ' + route.totalDistMi.toFixed(1) + ' mi ride, in the order you rode them.</p>';
    html += '<table class="cmp-table"><thead><tr><th>Trail</th><th class="num">Distance</th>' + (route.hasTime ? '<th class="num">Time</th>' : '') + '<th class="num">Passes</th></tr></thead><tbody>';
    result.items.forEach(function(it){
      html += '<tr><td class="cmp-trailname">' + it.name + (it.cat === 'roads' ? ' <span class="cmp-segwarn">(fire road)</span>' : '') + '</td>' +
        '<td class="num">' + it.distMi.toFixed(2) + ' mi</td>' +
        (route.hasTime ? '<td class="num">' + fmtDuration(it.timeSec) + '</td>' : '') +
        '<td class="num">' + it.visitCount + '</td></tr>';
    });
    html += '</tbody></table>';
    trailsTabBodyEl.innerHTML = html;
  }

  function showDetailsTab() {
    detailsTabContent.style.display = 'block';
    if (trailsTabContent) trailsTabContent.style.display = 'none';
    compareTabContent.style.display = 'none';
    tabDetailsBtn.classList.add('active');
    if (tabTrailsBtn) tabTrailsBtn.classList.remove('active');
    if (panelEl) panelEl.classList.remove('compare-active');
    document.body.classList.remove('compare-fullscreen');
    onViewportResize();
  }
  function showTrailsTab() {
    if (!trailsTabContent) return;
    detailsTabContent.style.display = 'none';
    trailsTabContent.style.display = 'block';
    compareTabContent.style.display = 'none';
    tabDetailsBtn.classList.remove('active');
    tabTrailsBtn.classList.add('active');
    if (panelEl) panelEl.classList.remove('compare-active');
    document.body.classList.remove('compare-fullscreen');
    onViewportResize();
    renderTrailsRiddenTab();
  }
  // Full-screen trail browser -- entered ONLY via the top-bar "Compare trails"
  // button (see openComparePanel below), not part of the Details/Trails-ridden
  // sub-tab switcher above; body.compare-fullscreen hides #rightPanelTabs entirely
  // while this is showing, so it doesn't try to participate in that switcher at all.
  function showCompareTab() {
    if (!compareTabContent) return;
    detailsTabContent.style.display = 'none';
    if (trailsTabContent) trailsTabContent.style.display = 'none';
    compareTabContent.style.display = 'block';
    if (panelEl) panelEl.classList.add('compare-active');
    document.body.classList.add('compare-fullscreen');
    onViewportResize();
    populateCompareNetworkSelect();
    tbLoadPark(currentNetworkId);
  }
  tabDetailsBtn.addEventListener('click', showDetailsTab);
  if (tabTrailsBtn) tabTrailsBtn.addEventListener('click', showTrailsTab);

  function openComparePanel() {
    if (!compareTabContent) return;
    openRightPanelTab(showCompareTab, compareToggleBtn);
  }

  if (compareToggleBtn) compareToggleBtn.addEventListener('click', openComparePanel);
  if (compareNetworkSelect) {
    compareNetworkSelect.addEventListener('change', function(){
      setCurrentNetwork(compareNetworkSelect.value, true);
      if (networkSelect) networkSelect.value = currentNetworkId; // keep the 3D panel's selector in sync too
      tbLoadPark(currentNetworkId);
    });
  }
  if (compareFilterInputEl) {
    compareFilterInputEl.addEventListener('input', function(){
      tbFilterText = tbNormalizeForFilter(compareFilterInputEl.value);
      tbRerender();
    });
  }
  if (compareClearSelBtn) {
    compareClearSelBtn.addEventListener('click', function(){
      tbSelected = {};
      tbRerender();
    });
  }
  if (backToMapBtn) {
    backToMapBtn.addEventListener('click', function(){
      // showDetailsTab() only resets which tab's *content* is showing inside the
      // right panel -- it doesn't close the panel drawer itself. Without
      // closeDrawers() here, the panel stayed open (just showing the empty
      // Details tab) after leaving Compare, which is why "Back to map" used to
      // land on a map with a stray side panel still open.
      showDetailsTab();
      closeDrawers();
    });
  }

  // ---- Elevation sourcing ----
  function gridElevFt(terrainData, lat, lon) {
    if (!terrainData || !terrainData.grid) return 0;
    var b = terrainData.bbox, n = terrainData.gridN;
    var fi = (lat - b.latMin) / (b.latMax - b.latMin) * (n - 1);
    var fj = (lon - b.lonMin) / (b.lonMax - b.lonMin) * (n - 1);
    fi = Math.max(0, Math.min(n - 1, fi));
    fj = Math.max(0, Math.min(n - 1, fj));
    var i0 = Math.floor(fi), j0 = Math.floor(fj);
    var i1 = Math.min(n - 1, i0 + 1), j1 = Math.min(n - 1, j0 + 1);
    var ti = fi - i0, tj = fj - j0;
    var g = terrainData.grid;
    var e00 = g[i0][j0], e01 = g[i0][j1], e10 = g[i1][j0], e11 = g[i1][j1];
    var e0 = e00 + (e01 - e00) * tj, e1 = e10 + (e11 - e10) * tj;
    return e0 + (e1 - e0) * ti; // already feet in the bundled grid
  }

  function fetchElevationsLive(points) {
    // Query the same USGS EPQS ground-truth DEM the 3D view/terrain grid already
    // trust -- at each trail point's exact location, instead of interpolating from
    // the coarser bundled grid. (Previously this hit Open-Elevation, a public
    // aggregated dataset that's lower resolution than USGS EPQS -- switched so
    // "higher-res" actually means higher-res of the SAME good source, not a
    // different, worse one.) Sequential with retry, mirroring fetchElevGrid's logic.
    function fetchOne(pt, attempt) {
      var url = 'https://epqs.nationalmap.gov/v1/json?x=' + pt[1] + '&y=' + pt[0] +
                 '&units=Feet&wkid=4326&includeDate=false';
      var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var timer = controller ? setTimeout(function(){ controller.abort(); }, 12000) : null;
      return fetch(url, controller ? { signal: controller.signal } : undefined).then(function(res){
        if (timer) clearTimeout(timer);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      }).then(function(data){
        if (typeof data.value !== 'number') throw new Error('no value');
        return data.value; // already feet (units=Feet above)
      }).catch(function(err){
        if (timer) clearTimeout(timer);
        if (attempt < 2) {
          return new Promise(function(res){ setTimeout(res, 400 * (attempt + 1)); })
            .then(function(){ return fetchOne(pt, attempt + 1); });
        }
        throw err;
      });
    }
    // Latency-bound like the grid fetch, so keep a healthy concurrency instead of
    // going strictly sequential (which would make even a small trail feel slow).
    var CONCURRENCY = 12;
    return new Promise(function(resolve, reject){
      var results = new Array(points.length);
      var idx = 0, active = 0, failed = false;
      function launchNext() {
        if (failed) return;
        if (idx >= points.length) { if (active === 0) resolve(results); return; }
        var myIdx = idx++;
        active++;
        fetchOne(points[myIdx], 0).then(function(val){
          results[myIdx] = val;
          active--;
          launchNext();
        }).catch(function(err){
          failed = true;
          reject(err);
        });
      }
      var starters = Math.min(CONCURRENCY, points.length);
      for (var k = 0; k < starters; k++) launchNext();
    });
  }


  // Overpass (and the merged CA State Parks/OSM data for Annadel) doesn't guarantee
  // multi-segment ways come back in physical trail order or a consistent internal
  // direction -- summed gain/loss/avg-grade tolerate that fine, but anything
  // order-dependent (climb/descend runs, longest sustained climb, the shape chart)
  // needs segments actually chained head-to-tail first, or a scrambled return order
  // shows up as fake "dips" where the profile jumps between disconnected points.
  function chainSegments(segments) {
    if (segments.length <= 1) return segments;
    var remaining = segments.map(function(s){ return s.slice(); });
    var chain = [remaining.shift()];
    while (remaining.length) {
      var chainStart = chain[0][0];
      var chainEnd = chain[chain.length - 1][chain[chain.length - 1].length - 1];
      var bestIdx = -1, bestSide = null, bestRev = false, bestD = Infinity;
      for (var i = 0; i < remaining.length; i++) {
        var s = remaining[i];
        var sStart = s[0], sEnd = s[s.length - 1];
        var dEndToStart = haversineFt(chainEnd[0], chainEnd[1], sStart[0], sStart[1]);
        var dEndToEnd = haversineFt(chainEnd[0], chainEnd[1], sEnd[0], sEnd[1]);
        var dStartToStart = haversineFt(chainStart[0], chainStart[1], sStart[0], sStart[1]);
        var dStartToEnd = haversineFt(chainStart[0], chainStart[1], sEnd[0], sEnd[1]);
        if (dEndToStart < bestD) { bestD = dEndToStart; bestIdx = i; bestSide = 'append'; bestRev = false; }
        if (dEndToEnd < bestD) { bestD = dEndToEnd; bestIdx = i; bestSide = 'append'; bestRev = true; }
        if (dStartToEnd < bestD) { bestD = dStartToEnd; bestIdx = i; bestSide = 'prepend'; bestRev = false; }
        if (dStartToStart < bestD) { bestD = dStartToStart; bestIdx = i; bestSide = 'prepend'; bestRev = true; }
      }
      if (bestIdx === -1) break;
      var chosen = remaining.splice(bestIdx, 1)[0];
      if (bestRev) chosen = chosen.slice().reverse();
      if (bestSide === 'append') chain.push(chosen); else chain.unshift(chosen);
    }
    return chain;
  }

  function reverseSegments(segments) {
    return segments.slice().reverse().map(function(seg){ return seg.slice().reverse(); });
  }

  // ---- GPS calibration: use your own loaded/imported rides to override the terrain-grid
  // estimate wherever real data exists, instead of only ever guessing from the map. ----
  var GPS_MATCH_THRESH_FT = 40;
  var GPS_MIN_VISIT_MI = 0.12;
  var GPS_MIN_NET_PROGRESS_FT = 150; // filters out "loitering near a junction" false matches
  var GPS_VISIT_GAP_SEC = 90;

  function findRealVisitsForTrail(networkId, trailName) {
    if (!routes.length) return [];
    var netDef = NETWORKS[networkId];
    var data = netDef && window[netDef.trailVar];
    if (!data) return [];
    var raw = (data.singletrack && data.singletrack[trailName]) || (data.roads && data.roads[trailName]);
    if (!raw) return [];
    var chained = chainSegments(raw);
    var trailPts = [];
    chained.forEach(function(seg){ seg.forEach(function(pt){ trailPts.push(pt); }); });

    function nearestDistFt(lat, lon) {
      var best = Infinity;
      for (var i = 0; i < trailPts.length; i++) {
        var d = haversineFt(lat, lon, trailPts[i][0], trailPts[i][1]);
        if (d < best) best = d;
        if (best < 5) break;
      }
      return best;
    }

    var visits = [];
    routes.forEach(function(route){
      if (!route.hasEle || !route.rows || route.rows.length < 3) return;
      var assigned = route.rows.map(function(row){ return nearestDistFt(row[1], row[2]) <= GPS_MATCH_THRESH_FT; });
      var i = 0;
      var fragments = [];
      while (i < assigned.length) {
        if (!assigned[i]) { i++; continue; }
        var j = i;
        while (j + 1 < assigned.length && assigned[j+1]) j++;
        fragments.push({ startIdx: i, endIdx: j });
        i = j + 1;
      }
      // stitch fragments from the same ride that are close together in time
      var stitched = [];
      fragments.forEach(function(f){
        var last = stitched[stitched.length - 1];
        if (last && (route.rows[f.startIdx][0] - route.rows[last.endIdx][0]) < GPS_VISIT_GAP_SEC) {
          last.endIdx = f.endIdx;
        } else {
          stitched.push({ startIdx: f.startIdx, endIdx: f.endIdx });
        }
      });
      stitched.forEach(function(f){
        var rows = route.rows.slice(f.startIdx, f.endIdx + 1);
        if (rows.length < 3) return;
        var distMi = rows[rows.length - 1][4] - rows[0][4];
        if (distMi < GPS_MIN_VISIT_MI) return;
        var netProgressFt = haversineFt(rows[0][1], rows[0][2], rows[rows.length-1][1], rows[rows.length-1][2]);
        if (netProgressFt < GPS_MIN_NET_PROGRESS_FT) return; // looks like loitering near a junction, not a real traverse
        visits.push({ routeName: route.name, distMi: distMi, rows: rows });
      });
    });
    return visits;
  }

  function computeGpsVerifiedStats(visits) {
    // Average each visit's computed stats -- simple mean, not distance-weighted, so one long
    // ride doesn't drown out a short one; all are real recordings of the same trail.
    var perVisit = visits.map(function(v){
      var latlonSeg = v.rows.map(function(r){ return [r[1], r[2]]; });
      var elevSeg = v.rows.map(function(r){ return r[3]; });
      return computeCompareStats([latlonSeg], [elevSeg]);
    });
    var avg = {};
    var numericKeys = ['lengthMi','elevMin','elevMax','gain','loss','avgGrade','maxPitch','climbFt','descFt','flatFt','climbPct','descPct','flatPct','climbCount','descentCount','longestClimbMi','longestClimbGrade','longestDescMi','longestDescFt','longestDescGrade','sustainedMaxGrade'];
    numericKeys.forEach(function(k){
      var sum = 0, n = 0;
      perVisit.forEach(function(s){ if (typeof s[k] === 'number' && isFinite(s[k])) { sum += s[k]; n++; } });
      avg[k] = n ? sum / n : 0;
    });
    avg.segCount = 1;
    // profile: use the longest single visit's own profile for the shape chart (averaging
    // profiles across visits of different lengths/alignments isn't meaningful)
    var longest = perVisit.reduce(function(best, s, i){ return (!best || visits[i].distMi > visits[best.i].distMi) ? { s: s, i: i } : best; }, null);
    avg.profile = longest ? longest.s.profile : [];
    avg.gpsVisitCount = visits.length;
    avg.gpsRouteNames = visits.map(function(v){ return v.routeName; });
    return avg;
  }

  function medianSmoothCmp(arr) {
    if (arr.length < 3) return arr.slice();
    var out = arr.slice();
    for (var i = 1; i < arr.length - 1; i++) {
      var trio = [arr[i - 1], arr[i], arr[i + 1]].slice().sort(function(a, b){ return a - b; });
      out[i] = trio[1];
    }
    return out;
  }

  var SUSTAIN_WINDOW_FT = 100; // rolling-window size for "sustained steepness" vs. a single noisy point
  var FLAT_GRADE_THRESH = 3;   // |grade| at or under this counts as "flat" when classifying climb/descend runs
  // A run has to clear BOTH a minimum length and a minimum actual elevation change to count
  // as its own dip/climb -- otherwise a single OSM point spaced 20-30ft from its neighbor,
  // interpolated against the (smooth but not perfectly monotonic) terrain grid, can produce
  // a 1ft wobble that's technically >3% grade over that short a gap but isn't a real feature
  // a rider would notice. Verified against a real GPX ride up U-Con Trail: without this,
  // grid noise produced 4 spurious "dips" alongside the 2 real ones.
  var MIN_RUN_FT = 20;
  var MIN_RUN_ELEV_FT = 3;

  function mergeRuns(rawRuns) {
    var runs = rawRuns.map(function(r){ return { dir: r.dir, distFt: r.distFt, elevFt: r.elevFt }; });
    var changed = true;
    while (changed && runs.length > 1) {
      changed = false;
      for (var i = 0; i < runs.length; i++) {
        var insignificant = runs[i].distFt < MIN_RUN_FT || Math.abs(runs[i].elevFt) < MIN_RUN_ELEV_FT;
        if (insignificant && runs[i].dir !== 'flat') {
          var prev = i > 0 ? runs[i - 1] : null;
          var next = i < runs.length - 1 ? runs[i + 1] : null;
          var targetIdx = -1;
          if (prev && next) targetIdx = (prev.distFt >= next.distFt) ? i - 1 : i + 1;
          else if (prev) targetIdx = i - 1;
          else if (next) targetIdx = i + 1;
          else break;
          runs[targetIdx].distFt += runs[i].distFt;
          runs[targetIdx].elevFt += runs[i].elevFt;
          runs.splice(i, 1);
          changed = true;
          break;
        }
      }
    }
    var out = [];
    runs.forEach(function(r){
      if (out.length && out[out.length - 1].dir === r.dir) {
        out[out.length - 1].distFt += r.distFt;
        out[out.length - 1].elevFt += r.elevFt;
      } else {
        out.push({ dir: r.dir, distFt: r.distFt, elevFt: r.elevFt });
      }
    });
    return out;
  }

  function computeCompareStats(segments, elevsBySeg) {
    var totalLen = 0, totalGain = 0, totalLoss = 0, maxGrade = 0, netChangeSum = 0, allElevs = [];
    var climbFt = 0, descFt = 0, flatFt = 0, climbCount = 0, descentCount = 0;
    var longestClimb = { distFt: 0, elevFt: 0 };
    var longestDesc = { distFt: 0, elevFt: 0 };
    var sustainedMaxGrade = 0;
    var profile = [];
    var profileOffset = 0;

    segments.forEach(function(seg, si){
      var elevs = medianSmoothCmp(elevsBySeg[si]);
      allElevs = allElevs.concat(elevs);
      var dists = [0];
      for (var i = 1; i < seg.length; i++) {
        dists.push(dists[i - 1] + haversineFt(seg[i - 1][0], seg[i - 1][1], seg[i][0], seg[i][1]));
      }
      var segLen = dists[dists.length - 1];
      totalLen += segLen;
      netChangeSum += (elevs[elevs.length - 1] - elevs[0]);

      for (var pi = 0; pi < dists.length; pi++) profile.push({ d: profileOffset + dists[pi], e: elevs[pi] });
      profileOffset += segLen;

      // Point-to-point classification merged into contiguous up/down/flat runs, so a
      // short blip doesn't get counted as a separate "climb" -- this is what lets us
      // say "2 dips, longest 60 ft" instead of just a raw gain/loss total. Raw runs are
      // buffered here and then run through mergeRuns() to absorb noise-level blips.
      var rawRuns = [];
      var curDir = null, curDistFt = 0, curElevFt = 0;
      function flushRun() {
        if (curDir !== null) rawRuns.push({ dir: curDir, distFt: curDistFt, elevFt: curElevFt });
        curDistFt = 0; curElevFt = 0;
      }

      for (var j = 1; j < seg.length; j++) {
        var dd = dists[j] - dists[j - 1];
        var de = elevs[j] - elevs[j - 1];
        if (de > 0) totalGain += de; else totalLoss += -de;
        if (dd > 5) {
          var g = de / dd * 100;
          if (Math.abs(g) > Math.abs(maxGrade)) maxGrade = g;
        }
        if (dd <= 0) continue;
        var dir = Math.abs(de / dd * 100) <= FLAT_GRADE_THRESH ? 'flat' : (de > 0 ? 'up' : 'down');
        if (dir !== curDir) { flushRun(); curDir = dir; }
        curDistFt += dd; curElevFt += de;
      }
      flushRun();

      mergeRuns(rawRuns).forEach(function(r){
        if (r.dir === 'up') {
          climbFt += r.distFt; climbCount++;
          if (r.distFt > longestClimb.distFt) longestClimb = { distFt: r.distFt, elevFt: r.elevFt };
        } else if (r.dir === 'down') {
          descFt += r.distFt; descentCount++;
          if (r.distFt > longestDesc.distFt) longestDesc = { distFt: r.distFt, elevFt: r.elevFt };
        } else if (r.dir === 'flat') {
          flatFt += r.distFt;
        }
      });

      // Steepest *sustained* grade over a rolling ~100ft window (two-pointer over the
      // already-cumulative distance array) -- catches "this climb is genuinely steep for
      // a while" and ignores a single grid/GPS-noisy point that inflates raw max pitch.
      var left = 0;
      for (var right = 0; right < dists.length; right++) {
        while (dists[right] - dists[left] > SUSTAIN_WINDOW_FT) left++;
        var winDist = dists[right] - dists[left];
        if (winDist >= SUSTAIN_WINDOW_FT * 0.6) {
          var wg = (elevs[right] - elevs[left]) / winDist * 100;
          if (Math.abs(wg) > Math.abs(sustainedMaxGrade)) sustainedMaxGrade = wg;
        }
      }
    });

    return {
      lengthMi: totalLen / 5280,
      elevMin: Math.min.apply(null, allElevs),
      elevMax: Math.max.apply(null, allElevs),
      gain: totalGain,
      loss: totalLoss,
      avgGrade: totalLen ? (netChangeSum / totalLen * 100) : 0,
      maxPitch: maxGrade,
      segCount: segments.length,
      climbFt: climbFt, descFt: descFt, flatFt: flatFt,
      climbPct: totalLen ? climbFt / totalLen * 100 : 0,
      descPct: totalLen ? descFt / totalLen * 100 : 0,
      flatPct: totalLen ? flatFt / totalLen * 100 : 0,
      climbCount: climbCount, descentCount: descentCount,
      longestClimbMi: longestClimb.distFt / 5280,
      longestClimbFt: longestClimb.distFt,
      longestClimbGrade: longestClimb.distFt ? (longestClimb.elevFt / longestClimb.distFt * 100) : 0,
      longestDescMi: longestDesc.distFt / 5280,
      longestDescFt: longestDesc.distFt,
      longestDescGrade: longestDesc.distFt ? (longestDesc.elevFt / longestDesc.distFt * 100) : 0,
      sustainedMaxGrade: sustainedMaxGrade,
      profile: profile
    };
  }

  function renderProfileSvg(profile, w, h) {
    if (!profile || !profile.length) return '';
    var minE = Math.min.apply(null, profile.map(function(p){ return p.e; }));
    var maxE = Math.max.apply(null, profile.map(function(p){ return p.e; }));
    var maxD = profile[profile.length - 1].d || 1;
    var pad = Math.max(5, (maxE - minE) * 0.12);
    minE -= pad; maxE += pad;
    var range = maxE - minE || 1;
    function X(d) { return d / maxD * w; }
    function Y(e) { return h - (e - minE) / range * h; }
    var pts = profile.map(function(p){ return X(p.d).toFixed(1) + ',' + Y(p.e).toFixed(1); }).join(' L');
    var line = 'M' + pts;
    var area = line + ' L' + X(maxD).toFixed(1) + ',' + h + ' L0,' + h + ' Z';
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" height="' + h + '" preserveAspectRatio="none" class="cmp-profile-svg">' +
      '<path d="' + area + '" fill="rgba(37,99,235,0.13)" stroke="none"></path>' +
      '<path d="' + line + '" fill="none" stroke="#2563eb" stroke-width="1.6"></path>' +
      '</svg>';
  }

  function sourceBadge(source) {
    if (source === 'gps') return '<span class="cmp-badge cmp-badge-gps">&#10003; GPS-verified</span>';
    if (source === 'hires') return '<span class="cmp-badge">USGS per-point</span>';
    return '<span class="cmp-badge">Terrain-grid estimate</span>';
  }

  function renderProfileDetail(name, s, source) {
    var descNote = s.descentCount
      ? (s.descentCount + ' dip' + (s.descentCount > 1 ? 's' : '') + ', longest ' + Math.round(s.longestDescFt) + ' ft @ ' + cmpFmt(s.longestDescGrade) + '%')
      : 'none';
    var gpsNote = source === 'gps' ? ('<div class="cmp-segwarn">Averaged from ' + s.gpsVisitCount + ' of your real ride' + (s.gpsVisitCount > 1 ? 's' : '') + '.</div>') : '';
    return '<div class="cmp-profile">' +
      '<div class="cmp-profile-head">' + name + ' ' + sourceBadge(source) + '</div>' +
      '<div class="cmp-profile-body">' +
        '<div class="cmp-profile-chart">' + renderProfileSvg(s.profile, 420, 60) + '</div>' +
        '<div class="cmp-profile-stats">' +
          '<div><b>' + Math.round(s.climbPct) + '%</b> climbing (' + cmpFmt(s.climbFt / 5280, 2) + ' mi)</div>' +
          '<div><b>' + Math.round(s.descPct) + '%</b> descending &mdash; ' + descNote + '</div>' +
          '<div>Longest sustained climb: <b>' + cmpFmt(s.longestClimbMi, 2) + ' mi</b> @ ' + (s.longestClimbGrade > 0 ? '+' : '') + cmpFmt(s.longestClimbGrade) + '%</div>' +
          '<div>Steepest sustained ~100ft: <b>' + (s.sustainedMaxGrade > 0 ? '+' : '') + cmpFmt(s.sustainedMaxGrade) + '%</b> <span class="cmp-segwarn">(vs. instantaneous max pitch ' + cmpFmt(Math.abs(s.maxPitch)) + '%, which can be a single noisy point)</span></div>' +
          gpsNote +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function renderCompareProfiles(statsByName, sourceByName) {
    var html = '<div class="cmp-chart-title">Trail shape &mdash; where the climbing and dips actually are</div>';
    Object.keys(statsByName).forEach(function(name){
      html += renderProfileDetail(name, statsByName[name], sourceByName ? sourceByName[name] : 'grid');
    });
    return html;
  }

  function cmpFmt(n, d) { return n.toFixed(d === undefined ? 1 : d); }

  function renderCompareTable(statsByName, sourceByName) {
    var html = '<table class="cmp-table"><thead><tr>' +
      '<th>Trail</th><th class="num">Length</th><th class="num">Elev range</th>' +
      '<th class="num">Avg grade</th><th class="num">Max pitch</th><th class="num">Gain / Loss</th><th>Source</th>' +
      '</tr></thead><tbody>';
    Object.keys(statsByName).forEach(function(name){
      var s = statsByName[name];
      var source = sourceByName ? sourceByName[name] : 'grid';
      html += '<tr>' +
        '<td class="cmp-trailname">' + name + (s.segCount > 1 ? ' <span class="cmp-segwarn">(' + s.segCount + ' segs)</span>' : '') + '</td>' +
        '<td class="num">' + cmpFmt(s.lengthMi, 2) + ' mi</td>' +
        '<td class="num">' + Math.round(s.elevMin) + '&ndash;' + Math.round(s.elevMax) + ' ft</td>' +
        '<td class="num" style="color:' + (s.avgGrade < 0 ? 'var(--red)' : 'var(--green)') + '">' + (s.avgGrade > 0 ? '+' : '') + cmpFmt(s.avgGrade) + '%</td>' +
        '<td class="num">' + cmpFmt(Math.abs(s.maxPitch)) + '%</td>' +
        '<td class="num">+' + Math.round(s.gain) + ' / -' + Math.round(s.loss) + ' ft</td>' +
        '<td>' + sourceBadge(source) + '</td>' +
        '</tr>';
    });
    html += '</tbody></table>';
    return html;
  }

  function renderCompareChart(statsByName) {
    var names = Object.keys(statsByName);
    var allVals = names.map(function(n){ return statsByName[n].avgGrade; })
      .concat(names.map(function(n){ return statsByName[n].maxPitch; }));
    var maxAbs = Math.max(10, Math.max.apply(null, allVals.map(Math.abs)));

    var barH = 22, gap = 10, groupGap = 16, leftPad = 150, chartW = 560;
    var rowH = barH * 2 + gap + groupGap;
    var svgH = rowH * names.length + 30;
    var midX = leftPad + chartW / 2;
    var scale = (chartW / 2 - 10) / maxAbs;

    var bars = '';
    names.forEach(function(name, i){
      var y0 = i * rowH + 10;
      var avg = statsByName[name].avgGrade;
      var pitch = statsByName[name].maxPitch;
      [['avg', avg, y0], ['pitch', pitch, y0 + barH + gap]].forEach(function(row){
        var kind = row[0], val = row[1], y = row[2];
        var w = Math.abs(val) * scale;
        var x = val >= 0 ? midX : midX - w;
        var color = kind === 'avg' ? (val < 0 ? '#dc2626' : '#16a34a') : '#6b7280';
        bars += '<rect x="' + x + '" y="' + y + '" width="' + Math.max(w, 1) + '" height="' + (barH - 3) + '" fill="' + color + '" opacity="' + (kind === 'avg' ? 1 : 0.55) + '" rx="2"></rect>';
        var labelX = val >= 0 ? x + w + 4 : x - 4;
        var anchor = val >= 0 ? 'start' : 'end';
        bars += '<text x="' + labelX + '" y="' + (y + barH / 2) + '" dominant-baseline="middle" text-anchor="' + anchor + '" class="cmp-barlabel">' + (val > 0 ? '+' : '') + cmpFmt(val) + '%</text>';
      });
      bars += '<text x="' + (leftPad - 10) + '" y="' + (y0 + barH) + '" dominant-baseline="middle" text-anchor="end" class="cmp-barlabel" font-weight="600">' + name + '</text>';
    });

    return '<div class="cmp-chart-title">Avg grade (solid) vs. max pitch (light) &mdash; negative = downhill</div>' +
      '<svg viewBox="0 0 ' + (leftPad + chartW + 40) + ' ' + svgH + '" width="100%" style="max-width:760px">' +
      '<line x1="' + midX + '" y1="0" x2="' + midX + '" y2="' + (svgH - 20) + '" class="cmp-zeroline"></line>' +
      bars + '</svg>';
  }

  function pickGpsVerifiedStats(visits, wantReversed) {
    // Visits ridden in different directions shouldn't just get blindly averaged together
    // (that would wash an "up" ride and a "down" ride into a meaningless near-zero grade).
    // Group by climbing direction, use whichever direction has more real visits as the
    // default; the reversed toggle switches to the other direction if you've got any
    // real rides in it, otherwise there's nothing real to show for that direction.
    var perVisitStats = visits.map(function(v){
      var latlonSeg = v.rows.map(function(r){ return [r[1], r[2]]; });
      var elevSeg = v.rows.map(function(r){ return r[3]; });
      return { visit: v, stats: computeCompareStats([latlonSeg], [elevSeg]) };
    });
    var climbing = perVisitStats.filter(function(x){ return x.stats.avgGrade >= 0; });
    var descending = perVisitStats.filter(function(x){ return x.stats.avgGrade < 0; });
    var majority = climbing.length >= descending.length ? climbing : descending;
    var minority = majority === climbing ? descending : climbing;
    var chosen = wantReversed ? minority : majority;
    if (!chosen.length) return null;
    return computeGpsVerifiedStats(chosen.map(function(x){ return x.visit; }));
  }

  function runCompare() {
    if (!compareSelection.length) { compareSetStatus('Add at least one trail to compare.', true); return; }
    var hiRes = compareHiResInput.checked;

    compareRunBtn.disabled = true;
    compareResultsEl.innerHTML = '';
    compareSetStatus('Checking your loaded rides for real coverage\u2026');

    var statsByName = {};
    var missing = [];
    var sourceByName = {}; // 'gps' | 'hires' | 'grid', for status/labeling
    var chain = Promise.resolve();
    compareSelection.forEach(function(sel){
      chain = chain.then(function(){
        return ensureParkLoaded(sel.networkId).catch(function(){ return null; });
      }).then(function(){
        var netDef = NETWORKS[sel.networkId];
        var data = netDef && window[netDef.trailVar];
        var terrainData = netDef && window[netDef.terrainVar];
        var displayName = sel.name + ' · ' + (NETWORK_SHORT[sel.networkId] || sel.networkId) + (sel.reversed ? ' (reversed)' : '');
        if (!data) { missing.push(displayName); return null; }
        var rawSegments = (data.singletrack && data.singletrack[sel.name]) || (data.roads && data.roads[sel.name]);
        if (!rawSegments) { missing.push(displayName); return null; }

        var realVisits = findRealVisitsForTrail(sel.networkId, sel.name);
        var gpsStats = realVisits.length ? pickGpsVerifiedStats(realVisits, sel.reversed) : null;
        if (gpsStats) {
          statsByName[displayName] = gpsStats;
          sourceByName[displayName] = 'gps';
          return null;
        }

        var segments = chainSegments(rawSegments);
        if (sel.reversed) segments = reverseSegments(segments);
        if (hiRes) {
          var elevsBySeg = [];
          var segChain = Promise.resolve();
          segments.forEach(function(seg){
            segChain = segChain.then(function(){
              return fetchElevationsLive(seg).then(function(elevs){ elevsBySeg.push(elevs); });
            });
          });
          return segChain.then(function(){
            statsByName[displayName] = computeCompareStats(segments, elevsBySeg);
            sourceByName[displayName] = 'hires';
          });
        } else {
          if (!terrainData) { missing.push(displayName + ' (no precomputed terrain)'); return null; }
          var elevsBySegGrid = segments.map(function(seg){
            return seg.map(function(pt){ return gridElevFt(terrainData, pt[0], pt[1]); });
          });
          statsByName[displayName] = computeCompareStats(segments, elevsBySegGrid);
          sourceByName[displayName] = 'grid';
          return null;
        }
      });
    });

    chain.then(function(){
      var found = Object.keys(statsByName);
      if (!found.length) {
        compareSetStatus('Could not find geometry for the selected trail(s).', true);
        compareRunBtn.disabled = false;
        return;
      }
      var parkCount = {};
      compareSelection.forEach(function(sel){ parkCount[sel.networkId] = true; });
      var crossPark = Object.keys(parkCount).length > 1;
      var gpsCount = found.filter(function(n){ return sourceByName[n] === 'gps'; }).length;
      var msg = 'Compared ' + found.length + ' trail' + (found.length > 1 ? 's' : '') +
        (crossPark ? ' across ' + Object.keys(parkCount).length + ' parks' : '') + '.' +
        (gpsCount ? ' ' + gpsCount + ' from your real rides.' : '');
      if (missing.length) msg += ' Skipped: ' + missing.join(', ') + '.';
      compareSetStatus(msg, missing.length > 0);
      compareResultsEl.innerHTML = renderCompareTable(statsByName, sourceByName) + renderCompareChart(statsByName) + renderCompareProfiles(statsByName, sourceByName);
      compareRunBtn.disabled = false;
      // Scrolling here, only once results actually exist, rather than right
      // after kicking off runCompare(), matters because this whole function
      // runs through an async Promise chain -- scrolling immediately on click
      // targeted the empty results div's position before it grew to its final
      // height, landing short of the actual content.
      compareResultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }).catch(function(err){
      console.error(err);
      compareSetStatus('Error: ' + err.message, true);
      compareRunBtn.disabled = false;
    });
  }
  if (compareRunBtn) compareRunBtn.addEventListener('click', tbRunCompareSelected);
