/*
 * charts.js
 * Elevation and speed profile charts (the SVG charts under the Details
// tab, with drag-to-select and synced hover) -- self-contained, only
// touches the route object and its own DOM.
 *
 * Split out of index.html's single inline script into its own file
 * for navigability -- same global scope as before (classic scripts,
 * not modules), same execution order, no behavior change. See
 * mtbike-explorer/README.txt for why this split happened and how it
 * was verified.
 */
  var CHART_VB_W = 600, CHART_VB_H = 170;
  var CHART_PAD = { left: 40, right: 10, top: 12, bottom: 22 };
  var IDLE_MPH = 0.5; // below this, a segment counts as "stopped" for Moving Time

  var selLo = null, selHi = null; // null = whole route, nothing dragged yet
  var hoverIdx = null;            // shared hover crosshair position, or null
  var eleChart = null, speedChart = null;

  function buildSpeedSeries(route) {
    var rows = route.rows, n = rows.length;
    var raw = new Array(n);
    raw[0] = 0;
    for (var i = 1; i < n; i++) {
      var dt = rows[i][0] - rows[i-1][0];
      var dd = rows[i][4] - rows[i-1][4];
      raw[i] = dt > 0 ? (dd / (dt/3600)) : 0;
    }
    raw[0] = raw[1] || 0;
    // Light 3-point smoothing tames single-point GPS jitter spikes without
    // flattening the real shape of the ride.
    return raw.map(function(v, i){
      var a = raw[Math.max(0, i-1)], c = raw[Math.min(n-1, i+1)];
      return (a + v + c) / 3;
    });
  }

  function computeMovingTimeSec(route, lo, hi) {
    var rows = route.rows, moving = 0;
    for (var i = lo+1; i <= hi; i++) {
      var dt = rows[i][0] - rows[i-1][0];
      var dd = rows[i][4] - rows[i-1][4];
      var mph = dt > 0 ? dd/(dt/3600) : 0;
      if (mph >= IDLE_MPH) moving += dt;
    }
    return moving;
  }

  function chartGeometry(xs, ys) {
    var n = xs.length;
    var xMin = xs[0], xMax = xs[n-1];
    var yMin = Math.min.apply(null, ys), yMax = Math.max.apply(null, ys);
    if (yMin === yMax) { yMin -= 1; yMax += 1; }
    var pad = (yMax - yMin) * 0.08;
    yMin -= pad; yMax += pad;
    var innerW = CHART_VB_W - CHART_PAD.left - CHART_PAD.right;
    var innerH = CHART_VB_H - CHART_PAD.top - CHART_PAD.bottom;
    function xPix(x) { return CHART_PAD.left + (xMax > xMin ? (x - xMin) / (xMax - xMin) : 0) * innerW; }
    function yPix(y) { return CHART_PAD.top + (1 - (y - yMin) / (yMax - yMin)) * innerH; }
    function idxAtFrac(frac) {
      frac = Math.max(0, Math.min(1, frac));
      var target = xMin + frac * (xMax - xMin);
      var lo = 0, hi = n - 1;
      while (lo < hi) { var mid = (lo+hi) >> 1; if (xs[mid] < target) lo = mid+1; else hi = mid; }
      if (lo > 0 && Math.abs(xs[lo-1]-target) < Math.abs(xs[lo]-target)) lo--;
      return lo;
    }
    return { xMin: xMin, xMax: xMax, yMin: yMin, yMax: yMax, innerW: innerW, innerH: innerH,
             baseline: CHART_PAD.top + innerH, xPix: xPix, yPix: yPix, idxAtFrac: idxAtFrac };
  }

  function niceTicks(lo, hi, count) {
    var out = [];
    for (var i = 0; i <= count; i++) out.push(lo + (hi-lo)*i/count);
    return out;
  }

  function svgEl(tag, attrs) {
    var el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (var k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  function drawChart(chart) {
    var geo = chartGeometry(chart.xs, chart.ys);
    chart.geo = geo;
    var svg = chart.svgEl;
    svg.setAttribute('viewBox', '0 0 ' + CHART_VB_W + ' ' + CHART_VB_H);
    svg.innerHTML = '';

    niceTicks(geo.yMin, geo.yMax, 3).forEach(function(v){
      var py = geo.yPix(v);
      svg.appendChild(svgEl('line', { class:'chart-gridline', x1:CHART_PAD.left, y1:py, x2:CHART_VB_W-CHART_PAD.right, y2:py }));
      var t = svgEl('text', { class:'chart-axis-label', x:2, y:py+3 });
      t.textContent = chart.yFmt(v);
      svg.appendChild(t);
    });
    svg.appendChild(svgEl('line', { class:'chart-baseline', x1:CHART_PAD.left, y1:geo.baseline, x2:CHART_VB_W-CHART_PAD.right, y2:geo.baseline }));

    niceTicks(geo.xMin, geo.xMax, 4).forEach(function(v){
      var px = geo.xPix(v);
      var anchor = Math.abs(v-geo.xMin) < 1e-9 ? 'start' : (Math.abs(v-geo.xMax) < 1e-9 ? 'end' : 'middle');
      var t = svgEl('text', { class:'chart-axis-label', x:px, y:CHART_VB_H-4, 'text-anchor': anchor });
      t.textContent = chart.xFmt(v);
      svg.appendChild(t);
    });

    if (selLo !== null) {
      var x1 = geo.xPix(chart.xs[selLo]), x2 = geo.xPix(chart.xs[selHi]);
      svg.appendChild(svgEl('rect', { class:'chart-selection', x:Math.min(x1,x2), y:CHART_PAD.top, width:Math.max(1,Math.abs(x2-x1)), height:geo.innerH }));
    }

    var n = chart.xs.length;
    var d = 'M' + geo.xPix(chart.xs[0]) + ',' + geo.yPix(chart.ys[0]);
    for (var i = 1; i < n; i++) d += ' L' + geo.xPix(chart.xs[i]) + ',' + geo.yPix(chart.ys[i]);
    var areaD = d + ' L' + geo.xPix(chart.xs[n-1]) + ',' + geo.baseline + ' L' + geo.xPix(chart.xs[0]) + ',' + geo.baseline + ' Z';
    var fillPath = svgEl('path', { class:'chart-fill', d:areaD });
    fillPath.style.fill = chart.color;
    svg.appendChild(fillPath);
    var linePath = svgEl('path', { class:'chart-line', d:d });
    linePath.style.stroke = chart.color;
    svg.appendChild(linePath);

    function badge(px, letter, color, grabbable) {
      var g = svgEl('g', { 'class': grabbable ? 'chart-handle' : '' });
      if (grabbable) {
        // A visible vertical guide the whole height of the plot, so the badge reads
        // as "the top of a draggable edge" rather than a fixed decoration -- this is
        // what actually makes it look grabbable instead of just a static label.
        var guide = svgEl('line', { class:'chart-handle-guide', x1:px, y1:CHART_PAD.top, x2:px, y2:geo.baseline });
        guide.style.stroke = color;
        g.appendChild(guide);
        // A wide, invisible hit-target strip -- much easier to grab than the visible
        // 16px badge alone, especially with a fingertip on mobile.
        g.appendChild(svgEl('rect', { class:'chart-handle-hit', x:px-14, y:CHART_PAD.top, width:28, height:geo.innerH }));
      }
      var ring = svgEl('circle', { class:'chart-badge-ring', cx:px, cy:CHART_PAD.top-2, r:8 });
      ring.style.stroke = color; ring.style.fill = color;
      g.appendChild(ring);
      var t = svgEl('text', { class:'chart-badge-text', x:px, y:CHART_PAD.top-2 });
      t.textContent = letter;
      g.appendChild(t);
      svg.appendChild(g);
    }
    var aIdx = selLo !== null ? selLo : 0;
    var bIdx = selHi !== null ? selHi : (n-1);
    badge(geo.xPix(chart.xs[aIdx]), 'A', 'var(--green)', true);
    badge(geo.xPix(chart.xs[bIdx]), 'B', 'var(--red)', true);

    if (hoverIdx !== null && hoverIdx >= 0 && hoverIdx < n) {
      var hx = geo.xPix(chart.xs[hoverIdx]), hy = geo.yPix(chart.ys[hoverIdx]);
      svg.appendChild(svgEl('line', { class:'chart-guide', x1:hx, y1:CHART_PAD.top, x2:hx, y2:geo.baseline }));
      svg.appendChild(svgEl('circle', { class:'chart-guide-dot', cx:hx, cy:hy, r:3.5 }));
    }
  }

  function redrawAllCharts() {
    if (eleChart) drawChart(eleChart);
    if (speedChart) drawChart(speedChart);
  }

  function positionTooltip(tooltipEl, wrapEl, pxViewBox) {
    var rect = wrapEl.getBoundingClientRect();
    var scaleX = rect.width / CHART_VB_W;
    var left = pxViewBox * scaleX;
    tooltipEl.style.display = 'block';
    if (left > rect.width * 0.6) {
      tooltipEl.style.left = 'auto';
      tooltipEl.style.right = Math.max(4, rect.width - left + 10) + 'px';
    } else {
      tooltipEl.style.right = 'auto';
      tooltipEl.style.left = (left + 10) + 'px';
    }
  }

  function wireChartInteraction(wrapEl, tooltipEl, getChart) {
    var dragging = false, dragMode = null, dragHandle = null, startIdx = null;

    function idxFromClientX(clientX) {
      var chart = getChart();
      if (!chart || !chart.geo) return null;
      var rect = wrapEl.getBoundingClientRect();
      if (!rect.width) return null;
      return chart.geo.idxAtFrac((clientX - rect.left) / rect.width);
    }

    function pixFromClientX(clientX) {
      var chart = getChart();
      if (!chart || !chart.geo) return null;
      var rect = wrapEl.getBoundingClientRect();
      if (!rect.width) return null;
      return (clientX - rect.left) / (rect.width / CHART_VB_W);
    }

    // Hit-test against the SAME A/B positions drawChart just rendered (whole-route
    // ends when nothing's selected, the selection's own edges once something is) --
    // in screen-pixel terms, not index terms, since that's what a thumb or cursor
    // actually judges "close" by.
    function nearestHandle(px) {
      var chart = getChart();
      if (!chart || !chart.geo || px === null) return null;
      var n = chart.xs.length;
      var aIdx = selLo !== null ? selLo : 0;
      var bIdx = selHi !== null ? selHi : (n-1);
      var aPix = chart.geo.xPix(chart.xs[aIdx]);
      var bPix = chart.geo.xPix(chart.xs[bIdx]);
      var THRESH = 16;
      if (Math.abs(px - aPix) <= THRESH) return 'A';
      if (Math.abs(px - bPix) <= THRESH) return 'B';
      return null;
    }

    function updateHover(idx) {
      hoverIdx = idx;
      var chart = getChart();
      if (chart && idx !== null) {
        positionTooltip(tooltipEl, wrapEl, chart.geo.xPix(chart.xs[idx]));
        tooltipEl.innerHTML = chart.tooltipHtml(idx);
      }
      redrawAllCharts();
    }

    function clearHover() {
      hoverIdx = null;
      tooltipEl.style.display = 'none';
      redrawAllCharts();
    }

    function onDown(clientX) {
      var idx = idxFromClientX(clientX);
      if (idx === null) return;
      var handle = nearestHandle(pixFromClientX(clientX));
      dragging = true;
      if (handle) {
        dragMode = 'handle';
        dragHandle = handle;
        // Grabbing a handle when nothing's selected yet "activates" the current
        // whole-route endpoints as real, adjustable A/B rather than requiring a
        // fresh drag-from-scratch first.
        var chart = getChart();
        if (selLo === null) { selLo = 0; selHi = chart.xs.length - 1; }
      } else {
        dragMode = 'range';
        startIdx = idx;
      }
      updateHover(idx);
    }
    function onDragMove(clientX) {
      var idx = idxFromClientX(clientX);
      if (idx === null) return;
      if (dragMode === 'handle') {
        if (dragHandle === 'A') selLo = idx; else selHi = idx;
        if (selLo > selHi) {
          var tmp = selLo; selLo = selHi; selHi = tmp;
          dragHandle = (dragHandle === 'A') ? 'B' : 'A'; // the handle follows whichever value it now holds
        }
      } else {
        selLo = Math.min(startIdx, idx);
        selHi = Math.max(startIdx, idx);
      }
      updateHover(idx);
      updateStatsFromSelection();
    }
    function onUp() {
      if (!dragging) return;
      dragging = false;
      if (dragMode === 'range' && selLo !== null && (selHi - selLo) < 2) {
        // Too small to be a meaningful drag -- treat it as a tap and clear back
        // to whole-route stats rather than leaving a near-zero-width selection.
        selLo = null; selHi = null;
        updateStatsFromSelection();
      }
      dragMode = null; dragHandle = null;
      redrawAllCharts();
    }

    wrapEl.addEventListener('mousedown', function(e){ onDown(e.clientX); e.preventDefault(); });
    wrapEl.addEventListener('mousemove', function(e){
      if (dragging) return;
      var idx = idxFromClientX(e.clientX);
      if (idx !== null) updateHover(idx);
      wrapEl.style.cursor = nearestHandle(pixFromClientX(e.clientX)) ? 'ew-resize' : 'crosshair';
    });
    wrapEl.addEventListener('mouseleave', function(){ if (!dragging) { clearHover(); wrapEl.style.cursor = ''; } });
    window.addEventListener('mousemove', function(e){ if (dragging) onDragMove(e.clientX); });
    window.addEventListener('mouseup', onUp);

    wrapEl.addEventListener('touchstart', function(e){ onDown(e.touches[0].clientX); }, { passive: true });
    wrapEl.addEventListener('touchmove', function(e){ if (dragging) { onDragMove(e.touches[0].clientX); e.preventDefault(); } }, { passive: false });
    wrapEl.addEventListener('touchend', function(){ onUp(); clearHover(); });
  }

  function buildCharts(route) {
    var rows = route.rows;
    var xsDist = rows.map(function(r){ return r[4]; });
    var ysEle = rows.map(function(r){ return r[3]; });

    eleChart = {
      svgEl: eleChartSvgEl, xs: xsDist, ys: ysEle, color: 'var(--green)',
      xFmt: function(v){ return v < 0.2 ? Math.round(v*1760) + ' yd' : v.toFixed(2) + ' mi'; },
      yFmt: function(v){ return Math.round(v).toLocaleString() + ' ft'; },
      tooltipHtml: function(idx){
        var r = rows[idx];
        return '<div class="tt-row"><span class="tt-label">Distance</span><span class="tt-val">' + r[4].toFixed(2) + ' mi</span></div>' +
               '<div class="tt-row"><span class="tt-label">Elevation</span><span class="tt-val">' + Math.round(r[3]).toLocaleString() + ' ft</span></div>';
      }
    };

    if (route.hasTime) {
      var ysSpeed = buildSpeedSeries(route);
      var xsTime = rows.map(function(r){ return r[0]; });
      speedChart = {
        svgEl: speedChartSvgEl, xs: xsTime, ys: ysSpeed, color: 'var(--accent)',
        xFmt: function(v){ return fmtElapsed(v); },
        yFmt: function(v){ return v.toFixed(1) + ' mph'; },
        tooltipHtml: function(idx){
          var r = rows[idx];
          return '<div class="tt-row"><span class="tt-label">Time</span><span class="tt-val">' + fmtElapsed(r[0]) + '</span></div>' +
                 '<div class="tt-row"><span class="tt-label">Speed</span><span class="tt-val">' + ysSpeed[idx].toFixed(1) + ' mph</span></div>';
        }
      };
      speedChartCardEl.style.display = '';
    } else {
      speedChart = null;
      speedChartCardEl.style.display = 'none';
    }

    redrawAllCharts();
  }

  function updateStatsFromSelection() {
    var route = routes[activeIndex];
    if (!route) return;
    var rows = route.rows;
    var lo = selLo === null ? 0 : selLo;
    var hi = selHi === null ? rows.length - 1 : selHi;
    var rowLo = rows[lo], rowHi = rows[hi];

    if (markerA) markerA.setLatLng([rowLo[1], rowLo[2]]);
    if (markerB) markerB.setLatLng([rowHi[1], rowHi[2]]);

    var pathDist = rowHi[4] - rowLo[4];
    var straight = haversineMi(rowLo[1], rowLo[2], rowHi[1], rowHi[2]);

    var gain = 0, loss = 0, high = rowLo[3], low = rowLo[3];
    for (var i = lo; i <= hi; i++) {
      if (rows[i][3] > high) high = rows[i][3];
      if (rows[i][3] < low) low = rows[i][3];
      if (i > lo) {
        var d = rows[i][3] - rows[i-1][3];
        if (d > 0) gain += d; else loss += -d;
      }
    }

    statGain.textContent = '+' + Math.round(gain).toLocaleString() + ' ft';
    statLoss.textContent = '-' + Math.round(loss).toLocaleString() + ' ft';
    statHigh.textContent = Math.round(high).toLocaleString() + ' ft';
    statLow.textContent = Math.round(low).toLocaleString() + ' ft';
    statDist.textContent = pathDist.toFixed(2) + ' mi';
    statStraight.textContent = straight.toFixed(2) + ' mi';
    // A route that loops back near its own start (straight-line distance
    // close to zero) gives a bearing that's basically noise -- direction
    // between two nearly-identical points is meaningless, not just
    // imprecise, so say so instead of showing a random-looking degree value.
    if (straight < 0.02) {
      statDirection.textContent = 'n/a (A and B too close)';
    } else {
      var deg = bearingDeg(rowLo[1], rowLo[2], rowHi[1], rowHi[2]);
      statDirection.textContent = compassLabel(deg) + ' (' + Math.round(deg) + '\u00b0)';
    }

    if (route.hasTime) {
      var elapsed = rowHi[0] - rowLo[0];
      var moving = computeMovingTimeSec(route, lo, hi);
      var avgSpeed = moving > 0 ? pathDist / (moving/3600) : 0;
      statAvgSpeed.textContent = avgSpeed.toFixed(1) + ' mph';
      statMovingTime.textContent = fmtDuration(moving);
      statElapsedTime.textContent = fmtDuration(elapsed);
    } else {
      statAvgSpeed.textContent = 'n/a';
      statMovingTime.textContent = 'n/a';
      statElapsedTime.textContent = 'n/a';
    }

    var hasSelection = selLo !== null;
    chartHintEl.style.display = hasSelection ? 'none' : '';
    eleClearBtn.style.display = hasSelection ? '' : 'none';
    timeNoteEl.textContent = route.hasTime
      ? (hasSelection
          ? 'Drag point A or B to fine-tune this, or drag anywhere else on a chart to pick a new range.'
          : 'Drag across either chart to select a range, or drag point A or B directly.')
      : 'This file has no per-point timestamps, so time/speed stats are unavailable — the elevation chart still works.';

    if (panel3d.style.display !== 'none' && t3d.scene) updateAB3DMarkers();
  }

  var eleChartSvgEl = document.getElementById('eleChartSvg');
  var speedChartSvgEl = document.getElementById('speedChartSvg');
  var eleChartWrapEl = document.getElementById('eleChartWrap');
  var speedChartWrapEl = document.getElementById('speedChartWrap');
  var eleChartTooltipEl = document.getElementById('eleChartTooltip');
  var speedChartTooltipEl = document.getElementById('speedChartTooltip');
  var speedChartCardEl = document.getElementById('speedChartCard');
  var chartHintEl = document.getElementById('chartHint');
  var eleClearBtn = document.getElementById('eleClearBtn');
  var timeNoteEl = document.getElementById('timeNote');
  var statDist = document.getElementById('statDist');
  var statStraight = document.getElementById('statStraight');
  var statDirection = document.getElementById('statDirection');
  var statGain = document.getElementById('statGain');
  var statLoss = document.getElementById('statLoss');
  var statHigh = document.getElementById('statHigh');
  var statLow = document.getElementById('statLow');
  var statAvgSpeed = document.getElementById('statAvgSpeed');
  var statMovingTime = document.getElementById('statMovingTime');
  var statElapsedTime = document.getElementById('statElapsedTime');

  wireChartInteraction(eleChartWrapEl, eleChartTooltipEl, function(){ return eleChart; });
  wireChartInteraction(speedChartWrapEl, speedChartTooltipEl, function(){ return speedChart; });

  eleClearBtn.addEventListener('click', function(){
    selLo = null; selHi = null;
    updateStatsFromSelection();
    redrawAllCharts();
  });

