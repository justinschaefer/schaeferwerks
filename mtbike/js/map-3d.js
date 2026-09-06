/*
 * map-3d.js
 * The 3D terrain view: Three.js scene/camera/renderer, USGS elevation
// grid fetching and caching, satellite texture fetching, terrain mesh
// and route-ribbon geometry, the fullscreen icon stack and layers
// menu, and switching between 2D/3D view modes. The largest single
// concern in the app -- loads after map-2d.js because it calls
// reengageFollow(), which map-2d.js defines.
 *
 * Split out of index.html's single inline script into its own file
 * for navigability -- same global scope as before (classic scripts,
 * not modules), same execution order, no behavior change. See
 * mtbike-explorer/README.txt for why this split happened and how it
 * was verified.
 */
  var panel3d = document.getElementById('panel3d');
  var iso3dContainer = document.getElementById('iso3dContainer');
  var iso3dStatus = document.getElementById('iso3dStatus');
  var iso3dTooltip = document.getElementById('iso3dTooltip');
  var iso3dExaggInput = document.getElementById('iso3dExagg');
  var iso3dAllRoutesInput = document.getElementById('iso3dAllRoutes');
  var iso3dShowRidesInput = document.getElementById('iso3dShowRides');
  var iso3dShowNetworkInput = document.getElementById('iso3dShowNetwork');
  var show2dNetworkInput = document.getElementById('show2dNetwork');
  var map2dNetworkLabel = document.getElementById('map2dNetworkLabel');
  var iso3dSatelliteInput = document.getElementById('iso3dSatelliteInput');
  var iso3dNetworkLabel = document.getElementById('iso3dNetworkLabel');
  var bottomLegendEl = document.getElementById('bottomLegend');
  updateLegend([]); // initial paint: Map mode's point A/B + resize hint, before any route loads

  var networkSelect = document.getElementById('networkSelect');
  // Every park is selectable now regardless of whether its data has actually
  // loaded yet -- with lazy loading (see ensureParkLoaded), "loaded" is no
  // longer a fixed set determined once at page-load time, it changes as you
  // switch parks. The dropdown lists all of them; picking one triggers its
  // load if it hasn't happened yet (see the networkSelect 'change' handler).
  var allNetworkIds = Object.keys(NETWORKS);

  if (allNetworkIds.length) {
    iso3dNetworkLabel.style.display = 'flex';
    if (map2dNetworkLabel) map2dNetworkLabel.style.display = 'flex';
    if (!NETWORKS[currentNetworkId]) currentNetworkId = allNetworkIds[0];
    if (networkSelect) {
      networkSelect.innerHTML = '';
      allNetworkIds.forEach(function(id){
        var opt = document.createElement('option');
        opt.value = id;
        opt.textContent = NETWORKS[id].label;
        networkSelect.appendChild(opt);
      });
      networkSelect.value = currentNetworkId;
      networkSelect.style.display = allNetworkIds.length > 1 ? 'inline-block' : 'none';
    }
  }
  if (show2dNetworkInput) {
    show2dNetworkInput.addEventListener('change', function(){
      draw2DTrailNetwork();
      updateLegend([]);
    });
  }

  // Index 0 (the color used when there's just one route -- the common case)
  // matches 2D's route magenta now, for consistency switching between views;
  // the rest stay a distinct rainbow for telling MULTIPLE routes apart when
  // several are shown in 3D at once, a different concern from single-route
  // styling. See mtbike-explorer/README.txt, "3D line improvements".
  var ROUTE_COLORS = ['#d6336c', '#2fd4ff', '#ffd23f', '#7dd956', '#c77dff', '#ff8fab'];
  // Both categories recede to a neutral gray family (see mtbike-explorer/
  // README.txt, "Trail styling redesign" for the reasoning and mockups this
  // came from) -- differentiated from each other by a shade difference here
  // and, on the 2D map specifically, a dashed pattern for roads (see
  // draw2DTrailNetwork in map-2d.js). The point is for these to read as
  // reference context, not compete with the rider's own route for attention.
  var NETWORK_SINGLETRACK_COLOR = '#000000';
  var NETWORK_ROAD_COLOR = '#3f3f3f';
  // Same "recede to reference context" idea as the two above, but shifted in
  // hue (not just shade) so this reads as a different KIND of context -- a
  // real trail that just doesn't have a name yet, rather than a road.
  // See mtbike-explorer/README.txt, "Empire Grade / Highway 9 data split".
  var NETWORK_UNNAMED_COLOR = '#8a6d3f';

  var t3d = {
    scene: null, camera: null, renderer: null,
    terrainMesh: null, routeLines: [], networkLines: [], markerA3d: null, markerB3d: null,
    meMarker3d: null, meBeacon3d: null,
    lat0: 0, lon0: 0, mLat: 110540, mLon: 111320,
    grid: null, gridN: 0, gridLatMin: 0, gridLatMax: 0, gridLonMin: 0, gridLonMax: 0,
    camDist: 800, camTheta: Math.PI*0.65, camPhi: Math.PI*0.32, camTarget: null,
    exagg: 2,
    cacheKey: null,
    animFrame: null,
    raycaster: null, mouseNDC: null, hoverActive: false,
    // Route lines (PROTOTYPE) are drawn with THREE.Line2 (see three-lines.js --
    // vendored, unmodified except for module->classic-script conversion, from
    // Three.js's own official "fat lines" example) instead of this file's
    // hand-rolled buildRibbonGeometry mesh. Line2 computes true screen-space
    // pixel width and correct joins in its shader, which is what actually
    // fixes the dashing/gap problem -- see mtbike-explorer/README.txt,
    // "SWITCHING ROUTE RENDERING TO THREE.Line2" for the full story of why
    // patching the hand-rolled version further wasn't converging. Network
    // trails (buildNetworkLines) are NOT converted yet -- this is deliberately
    // scoped to routes only as a first, smaller, verifiable step.
    // resolution must be kept in sync with the actual canvas size (in real
    // CSS/device pixels) for Line2's shader to compute width correctly --
    // wrong values means wrong width, not a crash, so this is easy to get
    // subtly wrong and not notice; resizeIso3DRenderer updates this and every
    // material in lineMaterials whenever the canvas size changes.
    lineResolution: null,
    lineMaterials: []
  };

  function toLocalXZ(lat, lon) {
    return {
      x: (lon - t3d.lon0) * t3d.mLon,
      z: -(lat - t3d.lat0) * t3d.mLat
    };
  }

  function sampleGridElevM(lat, lon) {
    if (!t3d.grid) return 0;
    var n = t3d.gridN;
    var fi = (lat - t3d.gridLatMin) / (t3d.gridLatMax - t3d.gridLatMin) * (n-1);
    var fj = (lon - t3d.gridLonMin) / (t3d.gridLonMax - t3d.gridLonMin) * (n-1);
    fi = Math.max(0, Math.min(n-1, fi));
    fj = Math.max(0, Math.min(n-1, fj));
    var i0 = Math.floor(fi), j0 = Math.floor(fj);
    var i1 = Math.min(n-1, i0+1), j1 = Math.min(n-1, j0+1);
    var ti = fi - i0, tj = fj - j0;
    var e00 = t3d.grid[i0][j0], e01 = t3d.grid[i0][j1];
    var e10 = t3d.grid[i1][j0], e11 = t3d.grid[i1][j1];
    var e0 = e00 + (e01-e00)*tj, e1 = e10 + (e11-e10)*tj;
    return (e0 + (e1-e0)*ti) / 3.28084; // ft -> m
  }

  function computeBBox(routeList, includeNetwork) {
    var latMin=Infinity, latMax=-Infinity, lonMin=Infinity, lonMax=-Infinity;
    routeList.forEach(function(r){
      r.rows.forEach(function(row){
        if (row[1] < latMin) latMin = row[1];
        if (row[1] > latMax) latMax = row[1];
        if (row[2] < lonMin) lonMin = row[2];
        if (row[2] > lonMax) lonMax = row[2];
      });
    });
    if (!routeList.length) { latMin=latMax=lonMin=lonMax=0; }
    var padLat = (latMax-latMin)*0.15 + 0.0015;
    var padLon = (lonMax-lonMin)*0.15 + 0.0015;
    var raw = {
      latMin: latMin-padLat, latMax: latMax+padLat,
      lonMin: lonMin-padLon, lonMax: lonMax+padLon
    };
    if (includeNetwork && currentTrailData()) {
      var nb = currentTrailData().bounds;
      raw.latMin = Math.min(raw.latMin, nb.latMin);
      raw.latMax = Math.max(raw.latMax, nb.latMax);
      raw.lonMin = Math.min(raw.lonMin, nb.lonMin);
      raw.lonMax = Math.max(raw.lonMax, nb.lonMax);
    }
    // Snap outward to a fixed geographic grid (~1.1km cells) so nearby/overlapping
    // routes land on the *same* tile and actually share the cache, instead of each
    // route computing its own slightly-different box that never matches anything.
    var CELL = 0.01;
    return {
      latMin: Math.floor(raw.latMin / CELL) * CELL,
      latMax: Math.ceil(raw.latMax / CELL) * CELL,
      lonMin: Math.floor(raw.lonMin / CELL) * CELL,
      lonMax: Math.ceil(raw.lonMax / CELL) * CELL
    };
  }

  // If a route falls inside (or close to) a known trail network's mapped area, treat the
  // WHOLE network footprint as one single, stable, reusable tile -- rather than computing
  // a route-specific box that shifts slightly every time you switch rides or toggle the
  // network overlay, which was the actual cause of the "keeps re-fetching" problem: two
  // nearly-identical areas that don't hash to the exact same cache key are, to a cache,
  // completely different areas.
  function routeNearNetwork(routeList) {
    if (!currentTrailData()) return false;
    var nb = currentTrailData().bounds;
    var marginLat = (nb.latMax - nb.latMin) * 0.5;
    var marginLon = (nb.lonMax - nb.lonMin) * 0.5;
    return routeList.some(function(r){
      return r.rows.some(function(row){
        return row[1] >= nb.latMin - marginLat && row[1] <= nb.latMax + marginLat &&
               row[2] >= nb.lonMin - marginLon && row[2] <= nb.lonMax + marginLon;
      });
    });
  }

  function networkOnlyBBox() {
    var nb = currentTrailData().bounds;
    var CELL = 0.01;
    return {
      latMin: Math.floor(nb.latMin / CELL) * CELL,
      latMax: Math.ceil(nb.latMax / CELL) * CELL,
      lonMin: Math.floor(nb.lonMin / CELL) * CELL,
      lonMax: Math.ceil(nb.lonMax / CELL) * CELL
    };
  }

  function fetchElevGrid(bbox, gridN, onProgress, onPartialSave, resumeData) {
    var lats = [], lons = [];
    for (var i=0;i<gridN;i++) lats.push(bbox.latMin + (bbox.latMax-bbox.latMin)*i/(gridN-1));
    for (var j=0;j<gridN;j++) lons.push(bbox.lonMin + (bbox.lonMax-bbox.lonMin)*j/(gridN-1));

    var grid = (resumeData && resumeData.grid) ? resumeData.grid : (function(){
      var g = []; for (var i=0;i<gridN;i++) g.push(new Array(gridN).fill(0)); return g;
    })();
    var filled = (resumeData && resumeData.filled) ? resumeData.filled : (function(){
      var f = []; for (var i=0;i<gridN;i++) f.push(new Array(gridN).fill(false)); return f;
    })();

    var tasks = [];
    for (var i=0;i<gridN;i++) {
      for (var j=0;j<gridN;j++) {
        if (!filled[i][j]) tasks.push({ i: i, j: j, lat: lats[i], lon: lons[j] });
      }
    }

    // The USGS API returns tiny responses (~100 bytes) — this is latency-bound, not
    // bandwidth-bound, so concurrency should stay high regardless of connection quality.
    // (A weak trail connection is better served by the per-request timeout + resume
    // logic below than by throttling parallelism, which just slows everyone down.)
    var CONCURRENCY = 16;
    var total = gridN * gridN;
    var done = total - tasks.length; // credit for points already filled on a resume
    var idx = 0;
    var failedCount = 0;
    var lastSave = Date.now();

    return new Promise(function(resolve, reject){
      function fetchOne(task, attempt) {
        var url = 'https://epqs.nationalmap.gov/v1/json?x=' + task.lon + '&y=' + task.lat +
                   '&units=Feet&wkid=4326&includeDate=false';
        var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        var timer = controller ? setTimeout(function(){ controller.abort(); }, 12000) : null;
        return fetch(url, controller ? { signal: controller.signal } : undefined).then(function(res){
          if (timer) clearTimeout(timer);
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        }).then(function(data){
          if (typeof data.value !== 'number') throw new Error('no value');
          return data.value;
        }).catch(function(err){
          if (timer) clearTimeout(timer);
          if (attempt < 2) {
            return new Promise(function(res){ setTimeout(res, 400 * (attempt+1)); })
              .then(function(){ return fetchOne(task, attempt+1); });
          }
          throw err;
        });
      }
      function maybePersist() {
        if (!onPartialSave) return;
        var now = Date.now();
        if (now - lastSave > 2500) {
          lastSave = now;
          onPartialSave(grid, filled);
        }
      }
      var finished = false;
      function finish() {
        if (finished) return;
        finished = true;
        if (onPartialSave) onPartialSave(grid, filled); // one last snapshot either way
        if (failedCount > total * 0.15) {
          reject(new Error(failedCount + ' of ' + total + ' elevation points failed to load — try again in a moment. What loaded so far has been saved, so retrying will pick up where this left off.'));
        } else {
          resolve(grid);
        }
      }
      function afterTask() {
        done++;
        if (onProgress) onProgress(done, total);
        maybePersist();
        if (idx < tasks.length) next();
        else if (done >= total) finish();
      }
      function next() {
        if (idx >= tasks.length) return;
        var task = tasks[idx++];
        fetchOne(task, 0).then(function(val){
          grid[task.i][task.j] = val;
          filled[task.i][task.j] = true; // only successes count as "filled" — a failed point stays open so a later retry can pick it up
          afterTask();
        }).catch(function(){
          grid[task.i][task.j] = 0;
          failedCount++;
          afterTask();
        });
      }
      if (tasks.length === 0) { finish(); return; }
      for (var c=0; c<CONCURRENCY && c<tasks.length; c++) next();
    });
  }


  function elevColorRGB(t) {
    var stops = [
      [0.10,0.30,0.12],[0.30,0.45,0.18],[0.55,0.52,0.28],[0.55,0.42,0.28],[0.80,0.78,0.72]
    ];
    var scaled = t * (stops.length-1);
    var idx = Math.min(stops.length-2, Math.max(0, Math.floor(scaled)));
    var f = scaled - idx;
    var c0 = stops[idx], c1 = stops[idx+1];
    return [c0[0]+(c1[0]-c0[0])*f, c0[1]+(c1[1]-c0[1])*f, c0[2]+(c1[2]-c0[2])*f];
  }

  // ---- Satellite imagery draped on the 3D terrain, using the same free, keyless Esri
  // World_Imagery tile source the flat map's Satellite layer already uses. Tiles are
  // stitched onto one canvas and mapped onto the terrain mesh via UV coordinates that
  // line up with each vertex's actual lat/lon, so real aerial detail (tree cover, bare
  // rock, fire roads) shows through instead of a synthetic elevation color ramp. This
  // is purely a client-side texture -- it never touches the elevation data itself, so
  // toggling it never re-fetches USGS grid data. ----
  var satelliteTextureCache = {}; // cacheKey -> resolved THREE.CanvasTexture, or a pending Promise for one
  var SAT_TARGET_TILES_ACROSS = 8; // cap texture size at ~8*256=2048px per side

  function lonToTileX(lon, z) { return Math.floor((lon+180)/360 * Math.pow(2,z)); }
  function latToTileY(lat, z) {
    var rad = lat * Math.PI/180;
    return Math.floor((1 - Math.log(Math.tan(rad) + 1/Math.cos(rad))/Math.PI) / 2 * Math.pow(2,z));
  }

  function satTileRange(latMin, latMax, lonMin, lonMax, z) {
    var xMin = lonToTileX(lonMin, z), xMax = lonToTileX(lonMax, z);
    var yMin = latToTileY(latMax, z), yMax = latToTileY(latMin, z); // north (latMax) has the smaller tile-y
    return { xMin: xMin, xMax: xMax, yMin: yMin, yMax: yMax, cols: xMax-xMin+1, rows: yMax-yMin+1 };
  }

  function satPickZoom(latMin, latMax, lonMin, lonMax) {
    for (var z = 18; z >= 2; z--) {
      var r = satTileRange(latMin, latMax, lonMin, lonMax, z);
      if (Math.max(r.cols, r.rows) <= SAT_TARGET_TILES_ACROSS) return z;
    }
    return 8;
  }

  function fetchSatelliteTexture(bbox, cacheKey) {
    if (satelliteTextureCache[cacheKey]) return Promise.resolve(satelliteTextureCache[cacheKey]);
    var z = satPickZoom(bbox.latMin, bbox.latMax, bbox.lonMin, bbox.lonMax);
    var r = satTileRange(bbox.latMin, bbox.latMax, bbox.lonMin, bbox.lonMax, z);
    var cols = r.cols, rows = r.rows;
    var canvas = document.createElement('canvas');
    canvas.width = cols * 256; canvas.height = rows * 256;
    var ctx = canvas.getContext('2d');

    var total = cols * rows, loaded = 0, failed = 0;
    var promise = new Promise(function(resolve){
      function done() {
        // A handful of missing edge tiles (coastline, service hiccup) still gives a
        // usable texture; only bail out to the elevation color ramp if most failed.
        if (failed > total * 0.4) { resolve(null); return; }
        var texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.generateMipmaps = true;
        satelliteTextureCache[cacheKey] = texture;
        resolve(texture);
      }
      for (var ty = r.yMin; ty <= r.yMax; ty++) {
        for (var tx = r.xMin; tx <= r.xMax; tx++) {
          (function(tx, ty){
            var img = new Image();
            img.crossOrigin = 'anonymous';
            var dx = (tx - r.xMin) * 256, dy = (ty - r.yMin) * 256;
            img.onload = function(){
              ctx.drawImage(img, dx, dy, 256, 256);
              loaded++; if (loaded + failed >= total) done();
            };
            img.onerror = function(){
              failed++; if (loaded + failed >= total) done();
            };
            img.src = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/' + z + '/' + ty + '/' + tx;
          })(tx, ty);
        }
      }
    });
    satelliteTextureCache[cacheKey] = promise; // dedupe concurrent requests for the same area
    return promise;
  }

  function buildTerrainMesh() {

    if (t3d.terrainMesh) { t3d.scene.remove(t3d.terrainMesh); t3d.terrainMesh = null; }
    var n = t3d.gridN;
    var geometry = new THREE.PlaneGeometry(1,1,n-1,n-1);
    var posAttr = geometry.attributes.position;
    var uvAttr = geometry.attributes.uv;
    var colors = [];
    var minE = Infinity, maxE = -Infinity;
    for (var i=0;i<n;i++) for (var j=0;j<n;j++) {
      var e = t3d.grid[i][j]/3.28084;
      if (e<minE) minE=e; if (e>maxE) maxE=e;
    }
    var vi = 0;
    for (var i=0;i<n;i++) {
      var lat = t3d.gridLatMin + (t3d.gridLatMax-t3d.gridLatMin)*i/(n-1);
      for (var j=0;j<n;j++) {
        var lon = t3d.gridLonMin + (t3d.gridLonMax-t3d.gridLonMin)*j/(n-1);
        var xz = toLocalXZ(lat, lon);
        var eM = t3d.grid[i][j]/3.28084;
        posAttr.setXYZ(vi, xz.x, eM*t3d.exagg, xz.z);
        // u runs west->east with j (lon), matching the satellite canvas's columns;
        // v runs south->north with i (lat), which lines up with CanvasTexture's
        // default flipY (v=0 samples the canvas's bottom row) since the canvas is
        // drawn with its northernmost tile row at the top -- see fetchSatelliteTexture.
        uvAttr.setXY(vi, j/(n-1), i/(n-1));
        var col = elevColorRGB((eM-minE)/Math.max(1,(maxE-minE)));
        colors.push(col[0], col[1], col[2]);
        vi++;
      }
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    var material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide });
    t3d.terrainMesh = new THREE.Mesh(geometry, material);
    t3d.scene.add(t3d.terrainMesh);

    if (iso3dSatelliteInput && iso3dSatelliteInput.checked) {
      var bbox = { latMin: t3d.gridLatMin, latMax: t3d.gridLatMax, lonMin: t3d.gridLonMin, lonMax: t3d.gridLonMax };
      var satCacheKey = t3d.cacheKey;
      fetchSatelliteTexture(bbox, satCacheKey).then(function(texture){
        // The user may have switched areas, toggled the checkbox off, or closed the
        // panel while this was in flight -- only apply it if it's still relevant.
        if (!texture || t3d.cacheKey !== satCacheKey || !t3d.terrainMesh || !iso3dSatelliteInput.checked) return;
        t3d.terrainMesh.material.map = texture;
        t3d.terrainMesh.material.vertexColors = false;
        t3d.terrainMesh.material.needsUpdate = true;
      });
    }
  }

  function ribbonHalfWidthForPixels(targetPx, minHalfWidthM, maxHalfWidthM) {
    // A ribbon with a fixed real-world width is invisible from far away and
    // looks right only from whatever distance it happened to be tuned for --
    // the trail is a few meters wide in reality, but the initial "fit the
    // whole park" camera view sits kilometers back, where a few meters
    // subtends a fraction of a screen pixel. Sizing the ribbon in world units
    // so it subtends a roughly constant number of *pixels* at the current
    // camera distance keeps it visible when zoomed out without making it look
    // absurdly bloated once the user zooms in close.
    var canvasH = (t3d.renderer && t3d.renderer.domElement.clientHeight) || 600;
    var fovRad = (t3d.camera ? t3d.camera.fov : 50) * Math.PI / 180;
    var worldWidth = targetPx * 2 * t3d.camDist * Math.tan(fovRad/2) / canvasH;
    return Math.max(minHalfWidthM, Math.min(maxHalfWidthM, worldWidth / 2));
  }

  // The catch: ribbon geometry is only actually BUILT (and thus only actually
  // sized via ribbonHalfWidthForPixels above) when open3DPanel()/applyOverlays
  // run -- a toggle, a new route, a park switch. Scrolling to zoom in/out
  // doesn't rebuild anything, it just moves the camera, so a ribbon calibrated
  // for "correct" pixel width at the wide initial fit-to-scene distance keeps
  // that same fixed real-world size as you manually zoom in afterward -- and
  // a fixed-size real object naturally looks bigger the closer the camera
  // gets, same as anything else in the scene. That's what "fire roads are too
  // big" turned out to actually be: not a wrong target width, a width that
  // was correct once, at build time, and never got recalibrated as the
  // camera moved. Debounced (not rebuilt on every single wheel tick) since
  // rebuilding the whole merged-network mesh is real work, not free -- only
  // worth paying once scrolling actually stops.
  var ribbonRescaleTimer = null;
  function scheduleRibbonRescale() {
    if (ribbonRescaleTimer) clearTimeout(ribbonRescaleTimer);
    ribbonRescaleTimer = setTimeout(rescaleRibbonsForZoom, 250);
  }
  function rescaleRibbonsForZoom() {
    ribbonRescaleTimer = null;
    if (!t3d.scene) return;
    // Route lines (Line2, see addRibbonWithHitTarget) no longer actually NEED
    // this rebuild -- their width is true screen-space pixels handled by the
    // shader every frame, not a real-world size baked in at build time like
    // the network trails' mesh ribbons still are. Rebuilding them here is
    // harmless (just a little redundant GPU work) but not yet worth special-
    // casing out until the network trails get the same Line2 treatment and
    // this function's real job shrinks to just buildNetworkLines().
    if (t3d.lastShowRides && t3d.lastRouteList && t3d.lastRouteList.length) buildRouteLines(t3d.lastRouteList);
    if (t3d.lastShowNetwork) buildNetworkLines();
  }

  function buildRibbonGeometry(points, halfWidth) {
    // A flat quad strip in the local XZ (ground) plane, offset perpendicular to
    // each segment's direction. THREE.LineBasicMaterial's linewidth is capped at
    // 1px on virtually every real browser (ANGLE on Windows, and Chrome/Safari
    // everywhere -- the WebGL spec only guarantees linewidth=1), so trails drawn
    // as THREE.Line were hairline-thin regardless of the linewidth value that was
    // being set. An actual ribbon of triangles has real screen-space width no
    // matter what GPU or browser renders it.
    //
    // Each segment is extruded perpendicular to ITS OWN direction, independent
    // of its neighbors -- at a turn, the outgoing quad and the incoming quad
    // are offset along two different normals, so they don't share an edge at
    // the shared vertex. On the outside of the turn that leaves a wedge-shaped
    // gap; on the inside it's just double-covered (harmless overdraw, not
    // visible). At the wide ribbon widths this app used before its styling
    // pass, that gap was small relative to the ribbon's own footprint and
    // self-masked by overlap with nearby geometry -- once ribbons got thinner
    // (correctly, to stop looking oversized), the same gap became a real
    // visible break in the line exactly where a trail turns, reported
    // directly and confirmed by reading this function rather than guessing
    // from a screenshot. Fixed below by adding a small joint quad at every
    // interior vertex, filling the wedge regardless of which side it's on.
    var positions = [];
    var indices = [];
    var vi = 0;
    var prevNx = null, prevNz = null, prevP1x = null, prevP1y = null, prevP1z = null;
    for (var i = 0; i < points.length - 1; i++) {
      var p0 = points[i], p1 = points[i+1];
      var dx = p1.x - p0.x, dz = p1.z - p0.z;
      var len = Math.sqrt(dx*dx + dz*dz);
      if (len < 1e-6) continue; // skip zero-length steps (duplicate points)
      var nx = -dz/len * halfWidth, nz = dx/len * halfWidth;
      positions.push(p0.x+nx, p0.y, p0.z+nz);
      positions.push(p0.x-nx, p0.y, p0.z-nz);
      positions.push(p1.x-nx, p1.y, p1.z-nz);
      positions.push(p1.x+nx, p1.y, p1.z+nz);
      indices.push(vi, vi+1, vi+2, vi, vi+2, vi+3);
      vi += 4;

      if (prevNx !== null) {
        // BUG (found from a real screenshot on a real dense GPS track, not
        // from reasoning about the geometry in the abstract): the previous
        // version of this joint always emitted a full quad spanning BOTH
        // the "+n" and "-n" sides at this shared vertex. Only one side
        // ever has an actual gap to fill (the outside of the turn) -- the
        // other side is where the previous and current quads already meet
        // and overlap on their own, so adding MORE geometry there doesn't
        // fix anything, it just stacks a second, fully coplanar copy of
        // that overlap at the exact same depth. That's a textbook
        // z-fighting setup, and with a real ~6000-point ride where the
        // median turn is only a few degrees, it fires at nearly every
        // single vertex -- which is exactly the dashed/"missing segment"
        // look reported, and it showed up even with no halo involved
        // (multi-route view has none), which is what proved this wasn't
        // the earlier halo-vs-visual bug repeating.
        // Fixed by measuring which side actually has the gap (whichever
        // offset pairing ends up farther apart) and filling ONLY that
        // side, with a single triangle fanned from the shared, un-offset
        // centerline point -- the non-gap side is never touched, so
        // there's no second copy of anything to conflict with.
        var plusDx = (p0.x+nx) - (prevP1x+prevNx), plusDz = (p0.z+nz) - (prevP1z+prevNz);
        var minusDx = (p0.x-nx) - (prevP1x-prevNx), minusDz = (p0.z-nz) - (prevP1z-prevNz);
        var plusDistSq = plusDx*plusDx + plusDz*plusDz;
        var minusDistSq = minusDx*minusDx + minusDz*minusDz;
        if (plusDistSq > minusDistSq) {
          positions.push(prevP1x+prevNx, prevP1y, prevP1z+prevNz);
          positions.push(p0.x+nx, p0.y, p0.z+nz);
          positions.push(p0.x, p0.y, p0.z);
        } else {
          positions.push(prevP1x-prevNx, prevP1y, prevP1z-prevNz);
          positions.push(p0.x-nx, p0.y, p0.z-nz);
          positions.push(p0.x, p0.y, p0.z);
        }
        indices.push(vi, vi+1, vi+2);
        vi += 3;
      }
      prevNx = nx; prevNz = nz; prevP1x = p1.x; prevP1y = p1.y; prevP1z = p1.z;
    }
    var geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setIndex(indices);
    return geom;
  }

  // A visible ribbon reading correctly as "trail width" needs to stay only a
  // few meters wide -- but that makes it a very small, hard-to-hit target for
  // hover raycasting once the camera is more than a stone's throw away (unlike
  // the old THREE.Line, which had a generous camera-distance-scaled pick
  // threshold built in). Pairing each visible ribbon with a much wider,
  // fully-transparent "hit" ribbon gets the old easy-hover behavior back
  // without making the visuals themselves oversized.
  function addRibbonWithHitTarget(targetArray, pts, color, targetPx, name, opts) {
    opts = opts || {};
    var halfWidthM = ribbonHalfWidthForPixels(targetPx, 1.4, 40); // meters, for the hit-test mesh only -- see below
    // A white halo ribbon under the colored one, same technique as the 2D
    // map's white-outline-under-colored-line (see draw2DTrailNetwork in
    // map-2d.js) -- 3D had no equivalent before, so a ribbon at ~opacity 1
    // against similarly-toned satellite terrain (dirt, dry grass) could
    // read as low-contrast even at a "correct" width. Drawn first/wider so
    // it peeks out as an edge outline once the narrower colored ribbon
    // goes on top of it. Tracked on the pushed entry (not just added to the
    // scene and forgotten) so clearRouteLines() below can actually find and
    // remove it on the next rebuild -- the first version of this didn't,
    // so a halo from an earlier single-route view stuck around as an
    // orphaned mesh through later rebuilds, including ones that correctly
    // decided not to add a NEW halo. Caught by the QA script's scene-graph
    // check finding leftover white meshes even after the multi-route halo
    // fix landed -- see mtbike-explorer/README.txt, "3D line improvements".
    // BUG (found by actually zooming into a real render, not just checking the
    // scene graph for leftover meshes): the halo used the exact same `pts` as
    // the colored ribbon underneath it, only wider -- so both meshes sit at
    // the IDENTICAL ground height across the halo's entire overlap with the
    // colored ribbon. Two coplanar surfaces at the same depth is a textbook
    // z-fighting setup: the GPU can't consistently resolve which one wins
    // per-pixel, so it flickers between them triangle-by-triangle, which in a
    // single static screenshot shows up as the route looking chopped into
    // dashes/"missing segments" -- reported directly, and confirmed by
    // A halo and its route line share the exact same centerline points --
    // coplanar-at-the-same-depth by construction, so without something to
    // break the tie, the GPU can't consistently resolve which one wins per
    // pixel (z-fighting). The first fix for this (see git history / earlier
    // README notes) dropped the halo a fixed amount in WORLD-SPACE Y --
    // that only works when the camera is looking mostly downward, since a
    // vertical offset barely changes CAMERA-SPACE depth when the view is
    // near-horizontal (exactly the common case for these terrain flyover
    // shots, and exactly the angle real screenshots kept showing dashing
    // at). Confirmed directly: reproduced the same checkered/dashed
    // pattern in total isolation (a bare Line2 halo+line pair, no terrain,
    // no app) purely by viewing it at a shallow angle, regardless of how
    // large the Y-drop was made. Fixed instead with polygonOffset, which
    // operates directly in depth-buffer space rather than world space, so
    // it doesn't care what angle the camera is at -- verified against the
    // same isolated pair at a deliberately extreme near-edge-on angle
    // (camera looking almost exactly along the line's own direction) and
    // it held up cleanly where the Y-drop failed completely.
    var halo = null;
    if (opts.halo) {
      var haloPositions = [];
      pts.forEach(function(p){ haloPositions.push(p.x, p.y, p.z); });
      var haloGeom2 = new THREE.LineGeometry();
      haloGeom2.setPositions(haloPositions);
      // Line2's linewidth is a true screen-space pixel diameter, computed in
      // its own shader from t3d.lineResolution + the projection matrix -- no
      // meters-at-build-distance conversion needed (contrast with halfWidthM
      // above, which exists only because the hit-test mesh below still uses
      // the old real-world-sized approach). targetPx*1.8 matches the old
      // halo's "1.8x the route's own width" ratio, *2 to go from the old
      // code's half-width convention to Line2's full-diameter linewidth.
      var haloMat2 = new THREE.LineMaterial({ color: 0xffffff, linewidth: targetPx * 1.5 * 2, transparent: true, opacity: 0.85, resolution: t3d.lineResolution });
      haloMat2.polygonOffset = true;
      haloMat2.polygonOffsetFactor = 4;
      haloMat2.polygonOffsetUnits = 200;
      t3d.lineMaterials.push(haloMat2);
      halo = new THREE.Line2(haloGeom2, haloMat2);
      halo.computeLineDistances();
      t3d.scene.add(halo);
    }
    var positions = [];
    pts.forEach(function(p){ positions.push(p.x, p.y, p.z); });
    var geom2 = new THREE.LineGeometry();
    geom2.setPositions(positions);
    var baseHex = colorToHex(color);
    var baseR = (baseHex >> 16 & 255) / 255, baseG = (baseHex >> 8 & 255) / 255, baseB = (baseHex & 255) / 255;
    var LIGHTEN = 0.65; // 0 = full base color throughout, 1 = pure white at the start
    var gradColors = [];
    for (var gi = 0; gi < pts.length; gi++) {
      var t = pts.length > 1 ? gi / (pts.length - 1) : 1; // 0 at start, 1 at end
      var mixAmt = LIGHTEN * (1 - t); // fades out as t -> 1, leaving pure base color at the end
      gradColors.push(baseR + (1 - baseR) * mixAmt, baseG + (1 - baseG) * mixAmt, baseB + (1 - baseB) * mixAmt);
    }
    geom2.setColors(gradColors);
    var matOpts2 = { color: 0xffffff, vertexColors: true, linewidth: targetPx * 2, resolution: t3d.lineResolution };
    if (opts.opacity != null) { matOpts2.transparent = true; matOpts2.opacity = opts.opacity; }
    var mat2 = new THREE.LineMaterial(matOpts2);
    mat2.defines = { USE_COLOR: '' };
    if (opts.halo) {
      mat2.polygonOffset = true;
      mat2.polygonOffsetFactor = -4;
      mat2.polygonOffsetUnits = -200;
    }
    t3d.lineMaterials.push(mat2);
    var visual = new THREE.Line2(geom2, mat2);
    visual.computeLineDistances();
    t3d.scene.add(visual);

    var hitGeom = buildRibbonGeometry(pts, Math.max(halfWidthM, 6));
    var hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    var hit = new THREE.Mesh(hitGeom, hitMat);
    t3d.scene.add(hit);

    targetArray.push({ line: hit, visual: visual, halo: halo, name: name, lineMaterials: halo ? [mat2, haloMat2] : [mat2] });
  }

  function colorToHex(c) {
    return (typeof c === 'string' && c.charAt(0) === '#') ? parseInt(c.slice(1), 16) : c;
  }

  // Building one mesh PER TRAIL SEGMENT (as addRibbonWithHitTarget does) means
  // a dense park like UCSC -- 225 named-trail segments -- turns into 450
  // separate draw calls and 450 separate GPU geometries just for the trail
  // overlay, all rendering pixel-for-pixel identical ribbons a single merged
  // mesh could draw in one call. This concatenates every segment in a dataset
  // (all singletrack, or all roads) into ONE geometry, keeping a sorted
  // faceIndex->name lookup table so hover picking still resolves to the right
  // trail name after a raycast hit, exactly as it did per-segment before.
  function buildMergedRibbon(segments, halfWidth) {
    // Same per-segment quad extrusion as buildRibbonGeometry above, and the
    // same joint-gap problem at interior vertices -- see that function's
    // comment for the full explanation. Fixed the same way here, with one
    // difference worth being careful about: the joint-filling logic resets
    // at the start of EACH segment (inside segments.forEach, not carried
    // across the outer loop), since adjacent segments in this merged dataset
    // are very often NOT geographically continuous -- different trails
    // entirely, or disconnected pieces of the same named trail (see
    // mtbike-explorer/README.txt's "trail-naming mess" notes). Adding a
    // joint between the end of one unrelated segment and the start of the
    // next would draw a fake connecting ribbon across empty ground between
    // trails that don't actually meet there.
    var positions = [];
    var indices = [];
    var vi = 0;
    var faceRanges = [];
    segments.forEach(function(seg){
      var startFace = indices.length / 3;
      var pts = seg.pts;
      var prevNx = null, prevNz = null, prevP1x = null, prevP1y = null, prevP1z = null;
      for (var i = 0; i < pts.length - 1; i++) {
        var p0 = pts[i], p1 = pts[i+1];
        var dx = p1.x - p0.x, dz = p1.z - p0.z;
        var len = Math.sqrt(dx*dx + dz*dz);
        if (len < 1e-6) continue;
        var nx = -dz/len * halfWidth, nz = dx/len * halfWidth;
        positions.push(p0.x+nx, p0.y, p0.z+nz);
        positions.push(p0.x-nx, p0.y, p0.z-nz);
        positions.push(p1.x-nx, p1.y, p1.z-nz);
        positions.push(p1.x+nx, p1.y, p1.z+nz);
        indices.push(vi, vi+1, vi+2, vi, vi+2, vi+3);
        vi += 4;

        if (prevNx !== null) {
          var plusDx = (p0.x+nx) - (prevP1x+prevNx), plusDz = (p0.z+nz) - (prevP1z+prevNz);
          var minusDx = (p0.x-nx) - (prevP1x-prevNx), minusDz = (p0.z-nz) - (prevP1z-prevNz);
          var plusDistSq = plusDx*plusDx + plusDz*plusDz;
          var minusDistSq = minusDx*minusDx + minusDz*minusDz;
          if (plusDistSq > minusDistSq) {
            positions.push(prevP1x+prevNx, prevP1y, prevP1z+prevNz);
            positions.push(p0.x+nx, p0.y, p0.z+nz);
            positions.push(p0.x, p0.y, p0.z);
          } else {
            positions.push(prevP1x-prevNx, prevP1y, prevP1z-prevNz);
            positions.push(p0.x-nx, p0.y, p0.z-nz);
            positions.push(p0.x, p0.y, p0.z);
          }
          indices.push(vi, vi+1, vi+2);
          vi += 3;
        }
        prevNx = nx; prevNz = nz; prevP1x = p1.x; prevP1y = p1.y; prevP1z = p1.z;
      }
      var endFace = indices.length / 3;
      if (endFace > startFace) faceRanges.push({ start: startFace, end: endFace, name: seg.name });
    });
    var geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setIndex(indices);
    return { geometry: geom, faceRanges: faceRanges };
  }

  function nameForFace(faceRanges, faceIndex) {
    // faceRanges is built in ascending, non-overlapping order, so a linear
    // scan is simple and, at a few hundred entries, effectively free -- this
    // only runs once per hover event, not per frame.
    for (var i = 0; i < faceRanges.length; i++) {
      if (faceIndex >= faceRanges[i].start && faceIndex < faceRanges[i].end) return faceRanges[i].name;
    }
    return null;
  }

  function addMergedGroup(targetArray, segments, color, halfWidthM, opts) {
    if (!segments.length) return;
    opts = opts || {};
    // Same low-contrast problem the route's white halo (see
    // addRibbonWithHitTarget) was built to fix, independently present here:
    // a thin, semi-transparent, neutral-gray line has effectively no way to
    // stay visible against terrain that swings from dark green tree cover to
    // light tan dirt within the same screenshot -- confirmed directly by
    // rendering a real park with satellite on (trails essentially invisible)
    // and off (still very low contrast against the color-ramp terrain). A
    // white halo (right choice for a single bold route color) isn't the fix
    // here, though: the whole point of these lines is to recede, not compete
    // with the route, and a white edge on every trail in a dense network
    // would read as a bright grid smeared across the terrain. A dark casing
    // (thin, semi-opaque outline under the line) is the standard topo-map
    // answer to the same problem -- it reads as edge contrast against light
    // AND dark ground alike without adding brightness, the same reason
    // contour lines get a dark casing rather than a white one.
    //
    // A casing and its visual line share the exact same centerline points --
    // coplanar-at-the-same-depth by construction, same root problem as the
    // route halo above (see addRibbonWithHitTarget's comment for the full
    // story of why a world-space Y-drop doesn't reliably fix this at a
    // grazing camera angle -- it barely changes CAMERA-SPACE depth when the
    // view is near-horizontal, exactly the common case for these terrain
    // flyover shots). Fixed the same way: polygonOffset, which works on any
    // material (this is still the plain mesh-based ribbon approach, not
    // Line2) since it operates in GL depth-buffer space directly, not
    // world space, so it doesn't care what angle the camera is at.
    //
    // Tracked as a property on the SAME entry pushed below (casing: ...),
    // not as a separate targetArray entry -- animate()'s hover raycaster
    // does `allLines.map(r => r.line)` over every entry in this array and
    // feeds the result straight to THREE.Raycaster.intersectObjects, which
    // throws on a null object. A separate {line: null, ...} entry for the
    // casing would have crashed hover on every single frame once a network
    // was loaded. Same reason the route's halo is attached to its route's
    // own entry instead of pushed separately.
    var casing = null;
    if (opts.casing) {
      var casingBuilt = buildMergedRibbon(segments, halfWidthM * 1.9);
      var casingMat = new THREE.MeshBasicMaterial({ color: '#1e293b', side: THREE.DoubleSide, transparent: true, opacity: 0.4 });
      casingMat.polygonOffset = true;
      casingMat.polygonOffsetFactor = 4;
      casingMat.polygonOffsetUnits = 200;
      casing = new THREE.Mesh(casingBuilt.geometry, casingMat);
      t3d.scene.add(casing);
    }
    var visualBuilt = buildMergedRibbon(segments, halfWidthM);
    var matOpts = { color: color, side: THREE.DoubleSide };
    if (opts.opacity != null) { matOpts.transparent = true; matOpts.opacity = opts.opacity; }
    var mat = new THREE.MeshBasicMaterial(matOpts);
    if (opts.casing) {
      mat.polygonOffset = true;
      mat.polygonOffsetFactor = -4;
      mat.polygonOffsetUnits = -200;
    }
    var visual = new THREE.Mesh(visualBuilt.geometry, mat);
    t3d.scene.add(visual);

    var hitBuilt = buildMergedRibbon(segments, Math.max(halfWidthM, 6));
    var hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    var hit = new THREE.Mesh(hitBuilt.geometry, hitMat);
    t3d.scene.add(hit);

    targetArray.push({
      line: hit, visual: visual, casing: casing,
      resolveName: function(faceIndex){ return nameForFace(hitBuilt.faceRanges, faceIndex); }
    });
  }

  function clearRouteLines() {
    t3d.routeLines.forEach(function(rl){
      t3d.scene.remove(rl.line);
      t3d.scene.remove(rl.visual);
      if (rl.halo) t3d.scene.remove(rl.halo);
      if (rl.lineMaterials) {
        rl.lineMaterials.forEach(function(m){
          var idx = t3d.lineMaterials.indexOf(m);
          if (idx !== -1) t3d.lineMaterials.splice(idx, 1);
        });
      }
    });
    t3d.routeLines = [];
  }

  function buildRouteLines(routeList) {
    clearRouteLines();
    // The halo (see addRibbonWithHitTarget) only makes sense when there's ONE
    // route to emphasize against the terrain -- with several routes shown at
    // once ("all loaded, not just active"), which is a real, regularly-used
    // view, every route getting its own wide white underlay meant overlapping
    // rides stacked into a solid white mass that buried the colored lines
    // entirely instead of helping any one of them stand out. Multi-route view
    // already has ROUTE_COLORS' rainbow palette to tell routes apart; it
    // doesn't need or want a "this one's the important one" treatment applied
    // to all of them simultaneously. Caught from a real screenshot after this
    // shipped with only a single-route case ever tested -- see mtbike-explorer/
    // README.txt, "3D line improvements" for the correction.
    var showHalo = routeList.length === 1;
    routeList.forEach(function(route, idx){
      var pts = route.rows.map(function(row){
        var xz = toLocalXZ(row[1], row[2]);
        var eM = sampleGridElevM(row[1], row[2]) + 2.5;
        return { x: xz.x, y: eM*t3d.exagg, z: xz.z };
      });
      var color = ROUTE_COLORS[idx % ROUTE_COLORS.length];
      var beforeLen = t3d.routeLines.length;
      addRibbonWithHitTarget(t3d.routeLines, pts, color, 2.8, route.name, { halo: showHalo });
      t3d.routeLines[beforeLen].route = route;
      t3d.routeLines[beforeLen].color = color;
    });
    updateLegend(routeList);
  }

  function clearNetworkLines() {
    t3d.networkLines.forEach(function(nl){ t3d.scene.remove(nl.line); t3d.scene.remove(nl.visual); if (nl.casing) t3d.scene.remove(nl.casing); });
    t3d.networkLines = [];
  }

  function buildNetworkLines() {
    clearNetworkLines();
    var net = currentTrailData();
    if (!net) return;

    function collectSegments(dataset, liftM) {
      var out = [];
      Object.keys(dataset).forEach(function(name){
        dataset[name].forEach(function(seg){
          var pts = seg.map(function(p){
            var xz = toLocalXZ(p[0], p[1]);
            var eM = sampleGridElevM(p[0], p[1]) + liftM;
            return { x: xz.x, y: eM*t3d.exagg, z: xz.z };
          });
          if (pts.length >= 2) out.push({ pts: pts, name: name });
        });
      });
      return out;
    }
    // Same shape as collectSegments but for net.unnamedPaths, which is a
    // plain array of raw segments (no name key -- see map-2d.js's
    // addUnnamedCategory for why) rather than a name -> segments object.
    function collectUnnamedSegments(segList, liftM) {
      var out = [];
      (segList || []).forEach(function(seg){
        var pts = seg.map(function(p){
          var xz = toLocalXZ(p[0], p[1]);
          var eM = sampleGridElevM(p[0], p[1]) + liftM;
          return { x: xz.x, y: eM*t3d.exagg, z: xz.z };
        });
        if (pts.length >= 2) out.push({ pts: pts, name: 'Unnamed path' });
      });
      return out;
    }
    // Real fire roads run wider than singletrack -- giving them different ribbon
    // widths (not just different colors) reads more like an actual trail map.
    // Both are sized in screen-pixel terms (see ribbonHalfWidthForPixels) so
    // they stay visible at whatever zoom level this view opens at. Each dataset
    // batches into a single pair of meshes (visible + hit-test) instead of one
    // pair per trail segment.
    // Roads previously targeted 4px -- wider than the route's own 3.5px at the
    // time -- and both categories were fully opaque, same backwards hierarchy
    // as 2D had before its redesign. Now both are narrower than the route
    // (4.5px) and semi-transparent so they read as reference context, not
    // competing lines. Opacity values match the 2D map's for the same
    // categories (see draw2DTrailNetwork in map-2d.js) for a consistent feel
    // switching between views.
    // Widths and opacity both bumped up from the previous pass (roads
    // 1.6px->2.0px, singletrack 2.0px->2.4px; opacity 0.55->0.8, 0.75->0.9) --
    // the old values were tuned by reasoning about hierarchy (route should
    // visually win) without actually rendering a real park and checking
    // whether the network was still legible at all once that hierarchy was
    // applied. It wasn't. The dark casing (see addMergedGroup) is doing most
    // of the actual contrast work now, so these can afford to sit closer to
    // opaque without competing with the route the way the old fully-opaque
    // values did before the styling redesign.
    addMergedGroup(t3d.networkLines, collectSegments(net.roads, 1.0), NETWORK_ROAD_COLOR, ribbonHalfWidthForPixels(2.0, 1.2, 25), { opacity: 0.8, casing: true });
    addMergedGroup(t3d.networkLines, collectSegments(net.singletrack, 1.5), NETWORK_SINGLETRACK_COLOR, ribbonHalfWidthForPixels(2.4, 1.2, 30), { opacity: 0.9, casing: true });
    // net.unnamedPaths -- real but unnamed connectors inside this park's core
    // area -- drawn here since the 3D view has no base-map labeling to lean
    // on, same reasoning as the always-drawn net.roads above. Matters more
    // here than on the 2D map since we're the ones actually drawing the
    // terrain these trails sit on -- leaving real geometry out understates
    // what's really there. See mtbike-explorer/README.txt, "Empire Grade /
    // Highway 9 data split". (Trails across Empire Grade itself now live in
    // their own separate park -- see wilder_trails_data.js / NETWORKS.wilder
    // in park-data.js -- rather than as an overlay on this one, since they
    // need their own elevation grid to render correctly in 3D.)
    if (net.unnamedPaths) {
      addMergedGroup(t3d.networkLines, collectUnnamedSegments(net.unnamedPaths, 1.5), NETWORK_UNNAMED_COLOR, ribbonHalfWidthForPixels(2.0, 1.2, 30), { opacity: 0.7, casing: true });
    }
  }


  function updateLegend(routeList) {
    // One legend bar, contextual to whichever view is actually on screen, instead of
    // the 3D view's route/trail-type colors living in their own block while a
    // separate, always-visible strip below assumed you were still looking at the 2D
    // map (point A/B plus a "drag to resize" hint that isn't even true in 3D, since
    // only #mapWrap -- not #panel3d -- has a resize handle).
    var is3D = document.body.classList.contains('showing3d');
    var html = '';
    if (is3D) {
      routeList.forEach(function(route, idx){
        var color = ROUTE_COLORS[idx % ROUTE_COLORS.length];
        html += '<span class="lg-item"><span class="lg-dot" style="background:' + color + '"></span>' + route.name + '</span>';
      });
      if (iso3dShowNetworkInput.checked && currentTrailData()) {
        html += '<span class="lg-item"><span class="lg-dot" style="background:' + NETWORK_SINGLETRACK_COLOR + '"></span>Named singletrack</span>';
        html += '<span class="lg-item"><span class="lg-dot" style="background:' + NETWORK_ROAD_COLOR + '"></span>Fire roads / access</span>';
      }
    } else if (show2dNetworkInput && show2dNetworkInput.checked && currentTrailData()) {
      html += '<span class="lg-item"><span class="lg-dot" style="background:' + NETWORK_SINGLETRACK_COLOR + '"></span>Named singletrack</span>';
    }
    html += '<span><span class="dot" style="background:var(--green)"></span>point A</span>';
    html += '<span><span class="dot" style="background:var(--red)"></span>point B</span>';
    if (!is3D) {
      html += '<span style="color:var(--text3);">&middot; drag the map\'s bottom-right corner to resize it</span>';
    } else {
      html += '<span style="color:var(--text3);" title="Real terrain built from USGS 1-meter elevation data — not stylized. Requires an internet connection to fetch new areas.">&middot; drag to rotate, scroll to zoom, right-click to pan</span>';
    }
    bottomLegendEl.innerHTML = html;
  }

  function updateAB3DMarkers() {
    var route = routes[activeIndex];
    if (t3d.markerA3d) { t3d.scene.remove(t3d.markerA3d); t3d.markerA3d = null; }
    if (t3d.markerB3d) { t3d.scene.remove(t3d.markerB3d); t3d.markerB3d = null; }
    if (!route || !t3d.scene || !iso3dShowRidesInput.checked) return;
    var ia = selLo === null ? 0 : selLo;
    var ib = selHi === null ? route.rows.length - 1 : selHi;
    var rowA = route.rows[ia], rowB = route.rows[ib];
    if (!rowA || !rowB) return;
    function makeMarker(row, color) {
      var xz = toLocalXZ(row[1], row[2]);
      var eM = sampleGridElevM(row[1], row[2]) + 6;
      // Capped so it stays a sane size even when the camera is framing the whole
      // park (huge camDist) rather than just this route -- otherwise the marker,
      // sized as a fraction of camDist, balloons into a giant sphere.
      var radius = Math.min(Math.max(3, t3d.camDist*0.006), 15);
      var geo = new THREE.SphereGeometry(radius, 12, 12);
      var mat = new THREE.MeshBasicMaterial({ color: color });
      var m = new THREE.Mesh(geo, mat);
      m.position.set(xz.x, eM*t3d.exagg, xz.z);
      return m;
    }
    t3d.markerA3d = makeMarker(rowA, 0x16a34a);
    t3d.markerB3d = makeMarker(rowB, 0xdc2626);
    t3d.scene.add(t3d.markerA3d);
    t3d.scene.add(t3d.markerB3d);
  }

  // ---- GPS "you are here" marker + traveled-path line, mirrored into the 3D scene ----
  function updateT3DLocateMarker(lat, lon) {
    if (!t3d.scene || !t3d.grid) return;
    var xz = toLocalXZ(lat, lon);
    var groundY = sampleGridElevM(lat, lon) * t3d.exagg;
    var beaconTopY = groundY + Math.min(Math.max(25, t3d.camDist * 0.12), 60);
    if (!t3d.meMarker3d) {
      var radius = Math.min(Math.max(4, t3d.camDist*0.008), 18);
      var geo = new THREE.SphereGeometry(radius, 14, 14);
      var mat = new THREE.MeshBasicMaterial({ color: 0x2563eb });
      t3d.meMarker3d = new THREE.Mesh(geo, mat);
      t3d.scene.add(t3d.meMarker3d);
    }
    t3d.meMarker3d.position.set(xz.x, groundY + 4, xz.z);

    var beaconPositions = new Float32Array([xz.x, groundY, xz.z, xz.x, beaconTopY, xz.z]);
    if (!t3d.meBeacon3d) {
      var bgeom = new THREE.BufferGeometry();
      bgeom.setAttribute('position', new THREE.BufferAttribute(beaconPositions, 3));
      var bmat = new THREE.LineBasicMaterial({ color: 0x2563eb, transparent: true, opacity: 0.5 });
      t3d.meBeacon3d = new THREE.Line(bgeom, bmat);
      t3d.scene.add(t3d.meBeacon3d);
    } else {
      t3d.meBeacon3d.geometry.setAttribute('position', new THREE.BufferAttribute(beaconPositions, 3));
      t3d.meBeacon3d.geometry.attributes.position.needsUpdate = true;
    }
  }

  function removeT3DLocateMarker() {
    if (t3d.meMarker3d) { if (t3d.scene) t3d.scene.remove(t3d.meMarker3d); t3d.meMarker3d = null; }
    if (t3d.meBeacon3d) { if (t3d.scene) t3d.scene.remove(t3d.meBeacon3d); t3d.meBeacon3d = null; }
  }

  function updateCamera3d() {
    var x = t3d.camDist * Math.sin(t3d.camPhi) * Math.cos(t3d.camTheta);
    var y = t3d.camDist * Math.cos(t3d.camPhi);
    var z = t3d.camDist * Math.sin(t3d.camPhi) * Math.sin(t3d.camTheta);
    t3d.camera.position.set(x + t3d.camTarget.x, y + t3d.camTarget.y, z + t3d.camTarget.z);
    t3d.camera.lookAt(t3d.camTarget);
  }

  function ensureRenderer() {
    if (t3d.renderer) return;
    t3d.scene = new THREE.Scene();
    t3d.scene.background = new THREE.Color(0x0a0e14);
    var w = iso3dContainer.clientWidth, h = iso3dContainer.clientHeight;
    t3d.camera = new THREE.PerspectiveCamera(50, w/h, 1, 50000);
    t3d.renderer = new THREE.WebGLRenderer({ antialias: true });
    t3d.renderer.setSize(w, h);
    t3d.renderer.setPixelRatio(window.devicePixelRatio || 1);
    iso3dContainer.appendChild(t3d.renderer.domElement);

    var ambient = new THREE.AmbientLight(0x8899aa, 0.7);
    t3d.scene.add(ambient);
    var sun = new THREE.DirectionalLight(0xfff2dd, 1.1);
    sun.position.set(-1500, 2200, -800);
    t3d.scene.add(sun);

    t3d.raycaster = new THREE.Raycaster();
    t3d.mouseNDC = new THREE.Vector2(-10, -10);
    t3d.lineResolution = new THREE.Vector2(w, h);

    // mouse controls
    var dragging = false, panning = false, lastX = 0, lastY = 0;
    t3d.renderer.domElement.addEventListener('mousedown', function(e){
      if (e.button === 2) panning = true; else dragging = true;
      lastX = e.clientX; lastY = e.clientY;
    });
    window.addEventListener('mouseup', function(){ dragging = false; panning = false; });
    window.addEventListener('mousemove', function(e){
      var rect = iso3dContainer.getBoundingClientRect();
      t3d.mouseNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      t3d.mouseNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      t3d.hoverActive = true;
      var dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      if (dragging) {
        t3d.camTheta -= dx * 0.006;
        t3d.camPhi -= dy * 0.006;
        t3d.camPhi = Math.max(0.08, Math.min(Math.PI/2 - 0.02, t3d.camPhi));
        updateCamera3d();
      } else if (panning) {
        var panScale = t3d.camDist * 0.0009;
        var forward = new THREE.Vector3().subVectors(t3d.camTarget, t3d.camera.position).setY(0).normalize();
        var right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0,1,0)).normalize();
        t3d.camTarget.addScaledVector(right, -dx*panScale);
        t3d.camTarget.addScaledVector(forward, dy*panScale);
        updateCamera3d();
      }
    });
    t3d.renderer.domElement.addEventListener('contextmenu', function(e){ e.preventDefault(); });
    t3d.renderer.domElement.addEventListener('wheel', function(e){
      e.preventDefault();
      t3d.camDist *= (1 + e.deltaY*0.001);
      t3d.camDist = Math.max(30, Math.min(20000, t3d.camDist));
      updateCamera3d();
      scheduleRibbonRescale();
    }, { passive:false });

    var touchLastX=0, touchLastY=0, touching=false;
    var touchStartX=0, touchStartY=0, touchStartTime=0, touchMoved=false;
    t3d.renderer.domElement.addEventListener('touchstart', function(e){
      if (e.touches.length===1) {
        touching=true;
        touchLastX=touchStartX=e.touches[0].clientX;
        touchLastY=touchStartY=e.touches[0].clientY;
        touchStartTime=Date.now();
        touchMoved=false;
      }
    });
    t3d.renderer.domElement.addEventListener('touchmove', function(e){
      if (!touching || e.touches.length!==1) return;
      var dx = e.touches[0].clientX - touchLastX, dy = e.touches[0].clientY - touchLastY;
      if (Math.abs(e.touches[0].clientX-touchStartX) > 8 || Math.abs(e.touches[0].clientY-touchStartY) > 8) {
        touchMoved = true;
        t3d.hoverActive = false; // rotating, not pointing at anything -- don't chase a stale tap target
        iso3dTooltip.style.display = 'none';
      }
      touchLastX = e.touches[0].clientX; touchLastY = e.touches[0].clientY;
      t3d.camTheta -= dx*0.006; t3d.camPhi -= dy*0.006;
      t3d.camPhi = Math.max(0.08, Math.min(Math.PI/2-0.02, t3d.camPhi));
      updateCamera3d();
      e.preventDefault();
    }, { passive:false });
    t3d.renderer.domElement.addEventListener('touchend', function(){
      touching=false;
      // A short tap that didn't turn into a drag is the touch equivalent of
      // hover -- there's no mousemove on a touchscreen to identify a trail
      // with otherwise. Feeding the tap position into the same mouseNDC the
      // desktop hover path already uses means the existing per-frame
      // raycast+tooltip logic in animate() picks it up with no duplicated
      // logic; it keeps showing that trail's name until the next tap or drag,
      // same as hover keeps showing a name until the mouse moves off it.
      if (!touchMoved && (Date.now() - touchStartTime) < 500) {
        var rect = iso3dContainer.getBoundingClientRect();
        t3d.mouseNDC.x = ((touchStartX - rect.left) / rect.width) * 2 - 1;
        t3d.mouseNDC.y = -((touchStartY - rect.top) / rect.height) * 2 + 1;
        t3d.hoverActive = true;
        lastX = touchStartX; lastY = touchStartY;
      }
    });

    window.addEventListener('resize', function(){ sizePanel3dForMobile(); resizeIso3DRenderer(); });

    function animate() {
      t3d.animFrame = requestAnimationFrame(animate);
      var allLines = t3d.routeLines.concat(t3d.networkLines);
      if (t3d.raycaster && allLines.length && t3d.hoverActive) {
        t3d.raycaster.params.Line.threshold = t3d.camDist * 0.01;
        t3d.raycaster.setFromCamera(t3d.mouseNDC, t3d.camera);
        var hits = t3d.raycaster.intersectObjects(allLines.map(function(r){ return r.line; }));
        if (hits.length) {
          var found = allLines.find(function(r){ return r.line === hits[0].object; });
          if (found) {
            var hoverName = found.resolveName ? found.resolveName(hits[0].faceIndex) : found.name;
            if (hoverName) {
              iso3dTooltip.style.display = 'block';
              iso3dTooltip.textContent = hoverName;
              iso3dTooltip.style.left = (lastX - iso3dContainer.getBoundingClientRect().left + 12) + 'px';
              iso3dTooltip.style.top = (lastY - iso3dContainer.getBoundingClientRect().top + 12) + 'px';
            } else {
              iso3dTooltip.style.display = 'none';
            }
          }
        } else {
          iso3dTooltip.style.display = 'none';
        }
      }
      t3d.renderer.render(t3d.scene, t3d.camera);
    }
    animate();
  }

  function syncPanel3dDisplayMode() {
    if (!panel3d || panel3d.style.display === 'none') return; // fully closed -- leave alone
    // Inline style always wins over stylesheet rules, so "display:flex" in CSS for the
    // flex-column layout (3D canvas stretching to fill available height) can never take
    // effect on its own -- it has to be set here in JS, in every place panel3d becomes
    // visible, or the whole "stretch to fill" layout silently does nothing for that path
    // (width filled fine because it's a separate width:100% rule; height never did).
    panel3d.style.display = 'flex';
  }

  function resizeIso3DRenderer() {
    if (!panel3d || panel3d.style.display === 'none' || !t3d.renderer) return;
    var w2 = iso3dContainer.clientWidth, h2 = iso3dContainer.clientHeight;
    if (!w2 || !h2) return;
    t3d.camera.aspect = w2/h2;
    t3d.camera.updateProjectionMatrix();
    t3d.renderer.setSize(w2, h2);
    if (t3d.lineResolution) {
      t3d.lineResolution.set(w2, h2);
      t3d.lineMaterials.forEach(function(m){ m.resolution.set(w2, h2); });
    }
  }

  // On phone-width layouts the 3D controls (park dropdown, checkboxes, hill
  // slider, save/load/location/fullscreen buttons) stack above the canvas
  // instead of sitting beside it, so a fixed vh guess for the canvas height
  // either overflows the screen (if the control stack is taller than assumed)
  // or wastes space (if shorter). Read the control stack's actual height and
  // give the canvas exactly what's left, the same way #mapWrap already fits
  // in one screen on mobile without needing to scroll to it.
  function sizePanel3dForMobile() {
    if (!panel3d || window.innerWidth > 720) { if (panel3d) panel3d.style.height = ''; return; }
    if (panel3d.style.display === 'none') return;
    // While maximized/fullscreen, the stylesheet already gives panel3d the
    // entire viewport (height:100vh) -- computing and setting an inline px
    // height here would only fight that, and inline always wins. That fight
    // is exactly what made "Fullscreen" cap out at the embedded view's height
    // on iPhone instead of actually filling the screen. Leave it alone; the
    // exit branch of toggleFullscreen() clears this same inline height and
    // this function runs again on the way out to size the embedded view.
    var nativeFull = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement;
    if (panel3d.classList.contains('js-maximized') || nativeFull === panel3d) return;
    var top = panel3d.getBoundingClientRect().top;
    // The legend strip (#bottomLegend) sits below #panel3d inside .map-card and
    // stays visible in 3D mode (mode-aware, see updateLegend). Its height has to
    // come out of the budget here too, or the canvas claims that space and pushes
    // the legend below the fold -- same failure mode this function was written to
    // fix in the first place, just one element further down.
    var legendEl = document.getElementById('bottomLegend');
    var legendHeight = (legendEl && legendEl.offsetParent !== null) ? legendEl.getBoundingClientRect().height : 0;
    var available = window.innerHeight - top - legendHeight - 12; // small bottom margin
    panel3d.style.height = Math.max(200, available) + 'px';
  }

  function on3DFullscreenToggle() {
    syncPanel3dDisplayMode();
    // No-op while entering fullscreen (sizePanel3dForMobile bails out and
    // leaves the stylesheet's height:100vh in control); this is what restores
    // the embedded view's inline height on the way back out, since exiting
    // js-maximized fullscreen on iPhone is a pure CSS-class toggle -- no real
    // viewport resize, so the window 'resize' listener that normally calls
    // this never fires on its own.
    sizePanel3dForMobile();
    resizeIso3DRenderer();
  }

  function open3DPanel(preserveCamera) {
    var route = routes[activeIndex] || null;
    if (!route && !currentTrailData()) {
      // Not loaded yet -- most likely this is a fast click right after page
      // load, before the active park's data (now fetched lazily, not as a
      // blocking script tag) has arrived. Same wait-and-retry shape as the
      // Three.js load just below, rather than silently doing nothing.
      if (NETWORKS[currentNetworkId]) {
        panel3d.style.display = 'flex';
        mapWrapEl.style.display = 'none';
        iso3dStatus.style.display = 'flex';
        iso3dStatus.textContent = 'Loading ' + NETWORKS[currentNetworkId].label + '…';
        ensureParkLoaded(currentNetworkId).then(function(){ open3DPanel(); }).catch(function(err){
          iso3dStatus.textContent = err.message;
        });
      }
      return;
    }
    panel3d.style.display = 'flex';
    mapWrapEl.style.display = 'none';
    viewModeMap3dBtn.classList.add('active');
    viewModeMapBtn.classList.remove('active');
    document.body.classList.add('showing3d');
    setTimeout(function(){ sizePanel3dForMobile(); resizeIso3DRenderer(); }, 260); // after the mobile layout/CSS transition settles

    if (networkSelect) networkSelect.value = currentNetworkId;

    if (!window.THREE) {
      iso3dStatus.style.display = 'flex';
      iso3dStatus.textContent = 'Loading 3D library…';
      ensureThree().then(function(){ open3DPanel(); }).catch(function(err){
        iso3dStatus.textContent = err.message;
      });
      return;
    }

    // No route loaded (e.g. opened straight from mobile with nothing dropped in yet) —
    // just show the selected park's trail network itself; "show my route(s)" has nothing to draw.
    iso3dShowRidesInput.disabled = !route;
    iso3dAllRoutesInput.disabled = !route;
    var showRides = route ? iso3dShowRidesInput.checked : false;
    var showNetwork = route ? (iso3dShowNetworkInput.checked && !!currentTrailData()) : !!currentTrailData();
    var routeList = showRides ? (iso3dAllRoutesInput.checked ? routes : [route]) : [];
    var bboxRouteBasis = showRides ? routeList : (route ? [route] : []);

    // If the named-trail overlay is on, always frame the SELECTED park's own footprint as
    // ONE fixed, stable tile -- this is what makes the precomputed/bundled terrain match
    // instantly, and what keeps switching rides, routes, and parks from each computing a
    // slightly different box that misses the cache. Critically, this must NOT depend on
    // whether the loaded route happens to be near that park: if you have a UCSC route
    // loaded but pick Annadel from the dropdown, framing must still be Annadel-only --
    // trying to fit a box around both an unrelated route hundreds of miles away and the
    // park produces a giant, meaningless bounding box and a blank result.
    // The selected park (dropdown) is the sole source of truth for WHICH AREA to show --
    // that must not change based on the "show all named trails" checkbox, which only
    // controls whether the trail-name line overlay draws on top of that same terrain.
    // Previously this also fell back to framing around the loaded route when the overlay
    // was off, which -- since virtually every saved route happens to be in the Santa Cruz
    // area -- silently snapped back to showing UCSC regardless of which park was selected.
    var usingStableNetworkTile = !!currentTrailData();
    var bbox = usingStableNetworkTile ? networkOnlyBBox() : computeBBox(bboxRouteBasis, showNetwork);
    // adapt point density to tile size (target ~55m spacing), capped so fetch time stays reasonable
    var tileWidthM = (bbox.lonMax-bbox.lonMin) * 111320 * Math.cos((bbox.latMin+bbox.latMax)/2*Math.PI/180);
    var tileHeightM = (bbox.latMax-bbox.latMin) * 110540;
    var gridN = Math.max(16, Math.min(48, Math.round(Math.max(tileWidthM, tileHeightM) / 55)));
    var cacheKey = bbox.latMin.toFixed(3)+','+bbox.latMax.toFixed(3)+','+bbox.lonMin.toFixed(3)+','+bbox.lonMax.toFixed(3)+'@'+gridN;
    var routeKey = routeList.map(function(r){ return r.name; }).join('|') + (showNetwork ? '+network:'+currentNetworkId : '');

    ensureRenderer();

    t3d.gridLatMin = bbox.latMin; t3d.gridLatMax = bbox.latMax;
    t3d.gridLonMin = bbox.lonMin; t3d.gridLonMax = bbox.lonMax;
    t3d.lat0 = (bbox.latMin+bbox.latMax)/2;
    t3d.lon0 = (bbox.lonMin+bbox.lonMax)/2;
    t3d.mLon = 111320 * Math.cos(t3d.lat0*Math.PI/180);
    t3d.exagg = parseFloat(iso3dExaggInput.value);

    function applyOverlays() {
      // fitCameraToScene has to run first, not last -- trail ribbon width is
      // computed from the current t3d.camDist so trails stay visible at any
      // zoom level (a true-to-life 1-3m-wide ribbon is invisible at the
      // multi-km distance the initial "fit whole park" view sits at). Building
      // the ribbons before the camera distance for this view was even known
      // meant they were always sized for a stale distance from whatever the
      // previous view happened to be.
      //
      // Skipped entirely when preserveCamera is true (a display-option toggle,
      // not a new route/park) -- t3d.camDist already holds whatever distance
      // the user last actually zoomed/rotated to (only fitCameraToScene and
      // the wheel-zoom handler ever write it), so it's not stale, and calling
      // fitCameraToScene here was resetting the camera to the default
      // "fit whole park" framing on every single checkbox click, making it
      // impossible to compare before/after without losing your place. Real
      // bug, reported directly and reproduced (camera position measured
      // before/after a toggle, completely different) before this fix -- see
      // mtbike-explorer/README.txt, "3D line improvements".
      if (!preserveCamera) fitCameraToScene(routeList);
      if (showRides) buildRouteLines(routeList); else { clearRouteLines(); updateLegend([]); }
      if (showNetwork) buildNetworkLines(); else clearNetworkLines();
      updateAB3DMarkers();
      if (locateWatchId !== null && lastLocateLatLng) updateT3DLocateMarker(lastLocateLatLng[0], lastLocateLatLng[1]);
      iso3dStatus.style.display = 'none';
      // Cached so rescaleRibbonsForZoom() (wired to the wheel handler below,
      // debounced) can rebuild just the ribbons at the new camera distance
      // after the user manually zooms, without needing this whole closure --
      // see that function's own comment for why this exists at all.
      t3d.lastShowRides = showRides;
      t3d.lastShowNetwork = showNetwork;
      t3d.lastRouteList = routeList;
    }

    if (t3d.cacheKey === cacheKey && t3d.lastRouteKey === routeKey && t3d.grid) {
      // already built for this exact area+content — just refresh lines/markers
      applyOverlays();
      return;
    }

    var cachedGrid = loadGridFromLocalStorage(cacheKey);
    if (cachedGrid) {
      t3d.grid = cachedGrid;
      t3d.gridN = gridN;
      t3d.cacheKey = cacheKey;
      t3d.lastRouteKey = routeKey;
      buildTerrainMesh();
      applyOverlays();
      return;
    }

    // The whole-network tile is a fixed, known area (not an arbitrary user route), so its
    // elevation grid is precomputed and bundled with the site — this is the case that used
    // to mean ~2,300 individual live requests to USGS. Use the bundled copy when it matches
    // exactly, and fall back to a live fetch only if it's missing or doesn't match.
    var bundledTerrain = currentTerrainData();
    if (bundledTerrain && bundledTerrain.cacheKey === cacheKey && bundledTerrain.gridN === gridN) {
      t3d.grid = bundledTerrain.grid;
      t3d.gridN = gridN;
      t3d.cacheKey = cacheKey;
      t3d.lastRouteKey = routeKey;
      saveGridToLocalStorage(cacheKey, t3d.grid); // also warm the normal cache so future edits/toggles stay instant
      buildTerrainMesh();
      applyOverlays();
      return;
    }

    iso3dStatus.style.display = 'flex';
    var partial = loadPartialTerrain(cacheKey, gridN);
    if (partial) {
      var alreadyDone = 0;
      for (var pi=0; pi<gridN; pi++) for (var pj=0; pj<gridN; pj++) if (partial.filled[pi][pj]) alreadyDone++;
      iso3dStatus.textContent = 'Resuming a previous load of this area (' + alreadyDone + '/' + (gridN*gridN) + ' already saved)…';
    } else {
      iso3dStatus.textContent = showNetwork
        ? 'Loading real ground elevation for the whole trail network from USGS (one-time, this covers a big area so it can take a couple minutes — cached after this)…'
        : 'Loading real ground elevation for this area from USGS (one-time, ~15-30s — cached after this)…';
    }

    fetchElevGrid(bbox, gridN, function(done, total){
      iso3dStatus.textContent = 'Loading real ground elevation from USGS… (' + done + '/' + total + ') — safe to leave this open, progress is saved as it goes.';
    }, function(grid, filled){
      savePartialTerrain(cacheKey, gridN, grid, filled);
    }, partial).then(function(grid){
      t3d.grid = grid;
      t3d.gridN = gridN;
      t3d.cacheKey = cacheKey;
      t3d.lastRouteKey = routeKey;
      saveGridToLocalStorage(cacheKey, grid);
      clearPartialTerrain(cacheKey);
      buildTerrainMesh();
      applyOverlays();
    }).catch(function(err){
      iso3dStatus.style.display = 'flex';
      iso3dStatus.textContent = 'Could not load elevation data: ' + (err && err.message ? err.message : 'check your internet connection') + ' — click "Show 3D terrain view" again to retry.';
    });
  }

  // ---- Terrain grid cache (localStorage, keyed by area) ----
  var TERRAIN_CACHE_KEY = 'gpxExplorerTerrainCache';
  var TERRAIN_CACHE_MAX_ENTRIES = 8;

  function loadTerrainCacheStore() {
    try {
      var raw = localStorage.getItem(TERRAIN_CACHE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }
  function loadGridFromLocalStorage(key) {
    var store = loadTerrainCacheStore();
    return store[key] || null;
  }
  function saveGridToLocalStorage(key, grid) {
    try {
      var store = loadTerrainCacheStore();
      store[key] = grid;
      var keys = Object.keys(store);
      if (keys.length > TERRAIN_CACHE_MAX_ENTRIES) {
        delete store[keys[0]]; // drop oldest-inserted (approx)
      }
      localStorage.setItem(TERRAIN_CACHE_KEY, JSON.stringify(store));
    } catch (e) { /* storage full or unavailable — fine, just won't cache */ }
  }

  // ---- In-progress terrain load (one at a time) — so a load interrupted by iOS backgrounding
  // the tab, losing signal, or leaving the page resumes from where it left off instead of
  // starting the whole tile over from zero. ----
  var TERRAIN_PARTIAL_KEY = 'gpxExplorerTerrainPartial';

  function loadPartialTerrain(key, gridN) {
    try {
      var raw = localStorage.getItem(TERRAIN_PARTIAL_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || data.cacheKey !== key || data.gridN !== gridN || !data.grid || !data.filled) return null;
      return data;
    } catch (e) { return null; }
  }
  function savePartialTerrain(key, gridN, grid, filled) {
    try {
      localStorage.setItem(TERRAIN_PARTIAL_KEY, JSON.stringify({ cacheKey: key, gridN: gridN, grid: grid, filled: filled, savedAt: Date.now() }));
    } catch (e) { /* storage full — this attempt just won't be resumable, not fatal */ }
  }
  function clearPartialTerrain(key) {
    try {
      var raw = localStorage.getItem(TERRAIN_PARTIAL_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      if (data && data.cacheKey === key) localStorage.removeItem(TERRAIN_PARTIAL_KEY);
    } catch (e) { /* ignore */ }
  }

  function fitCameraToScene(routeList) {
    // base the frame on the full terrain grid extent (includes padding beyond the route),
    // not just the route points, so the whole surface is visible on open.
    var maxExtent = 1, maxElevM = 0, minElevM = Infinity;
    var corners = [
      [t3d.gridLatMin, t3d.gridLonMin], [t3d.gridLatMin, t3d.gridLonMax],
      [t3d.gridLatMax, t3d.gridLonMin], [t3d.gridLatMax, t3d.gridLonMax]
    ];
    corners.forEach(function(c){
      var xz = toLocalXZ(c[0], c[1]);
      maxExtent = Math.max(maxExtent, Math.abs(xz.x), Math.abs(xz.z));
    });
    if (t3d.grid) {
      for (var i=0;i<t3d.gridN;i++) for (var j=0;j<t3d.gridN;j++) {
        var eM = t3d.grid[i][j]/3.28084;
        if (eM > maxElevM) maxElevM = eM;
        if (eM < minElevM) minElevM = eM;
      }
    } else { minElevM = 0; }

    // account for vertical extent too (exaggerated), so tall terrain isn't clipped
    var vertExtent = (maxElevM - minElevM) * t3d.exagg;
    t3d.camDist = Math.max(maxExtent * 1.9, vertExtent * 1.8, 150);
    t3d.camTheta = Math.PI*0.62;
    t3d.camPhi = Math.PI*0.38;
    var midElevM = (maxElevM + minElevM) / 2;
    t3d.camTarget = new THREE.Vector3(0, midElevM*t3d.exagg, 0);
    updateCamera3d();
  }

  var viewModeMapBtn = document.getElementById('viewModeMapBtn');
  var viewModeMap3dBtn = document.getElementById('viewModeMap3dBtn');
  var map2dControlsEl = document.getElementById('map2dControls');
  var mapWrapEl = document.getElementById('mapWrap');

  function showMapMode() {
    panel3d.style.display = 'none';
    panel3d.style.height = '';
    mapWrapEl.style.display = '';
    if (map2dControlsEl) map2dControlsEl.style.display = 'flex';
    draw2DTrailNetwork(); // in case the park changed while in 3D, or its data just finished loading
    viewModeMapBtn.classList.add('active');
    viewModeMap3dBtn.classList.remove('active');
    document.body.classList.remove('showing3d');
    updateLegend([]); // switch the shared legend bar back to describing the 2D map
    if (panel3d.classList.contains('js-maximized')) {
      panel3d.classList.remove('js-maximized');
      document.body.classList.remove('has-js-maximized');
    }
    var nativeFull = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement;
    if (nativeFull === panel3d) {
      var exit = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
      if (exit) exit.call(document);
    }
    setTimeout(function(){ if (map) map.invalidateSize(); }, 50);
  }
  function showMap3dMode() {
    mapWrapEl.style.display = 'none';
    if (map2dControlsEl) map2dControlsEl.style.display = 'none';
    viewModeMap3dBtn.classList.add('active');
    viewModeMapBtn.classList.remove('active');
    open3DPanel();
  }
  viewModeMapBtn.addEventListener('click', showMapMode);
  viewModeMap3dBtn.addEventListener('click', showMap3dMode);

  document.getElementById('recenterBtn').addEventListener('click', reengageFollow);
  // This icon stack lives inside #panel3d itself and is shown whenever
  // panel3d is (see the CSS comment above #panel3dFsControls) -- one set of
  // controls for both normal embedded 3D and fullscreen/maximized 3D,
  // instead of the old split where fullscreen buried the toolbar these used
  // to depend on. fs3dBackBtn goes straight to the 2D map (matching the
  // toolbar's "Map" button) and also exits fullscreen if it's active, rather
  // than leaving you in a windowed 3D view with no visible way to get
  // further back. fs3dFullscreenBtn toggles fullscreen on its own, staying
  // in 3D, using the same glyph as the 2D map's own fullscreen control.
  if (fs3dBackBtn) fs3dBackBtn.addEventListener('click', showMapMode);
  if (fs3dFullscreenBtn) {
    fs3dFullscreenBtn.addEventListener('click', function(){
      toggleFullscreen(panel3d, on3DFullscreenToggle);
    });
  }
  if (fs3dLocateBtn) {
    fs3dLocateBtn.addEventListener('click', function(){
      if (locateWatchId !== null) stopLocate(); else startLocate();
    });
  }
  // Layers menu: everything that used to be a spread-out row of
  // checkboxes/select/slider in the toolbar (network picker, show-routes,
  // show-trails, satellite, hill exaggeration) now lives in one dropdown
  // opened from this button, matching how the 2D map's own layers control
  // works (click the icon, a panel opens with the actual options in it).
  // The moved elements keep their original ids, so every existing change
  // handler for them (iso3dShowRidesInput.addEventListener('change', ...),
  // etc.) still works unmodified -- only their position in the DOM changed.
  if (fs3dLayersBtn && panel3dLayersMenu) {
    fs3dLayersBtn.addEventListener('click', function(e){
      e.stopPropagation();
      panel3dLayersMenu.hidden = !panel3dLayersMenu.hidden;
      fs3dLayersBtn.classList.toggle('active', !panel3dLayersMenu.hidden);
    });
    document.addEventListener('click', function(e){
      if (panel3dLayersMenu.hidden) return;
      if (panel3dLayersMenu.contains(e.target) || e.target === fs3dLayersBtn || fs3dLayersBtn.contains(e.target)) return;
      panel3dLayersMenu.hidden = true;
      fs3dLayersBtn.classList.remove('active');
    });
  }
  if (networkSelect) {
    networkSelect.addEventListener('change', function(){
      var id = networkSelect.value;
      setCurrentNetwork(id, true);
      if (panel3d.style.display === 'none') return;
      iso3dStatus.textContent = 'Loading ' + NETWORKS[id].label + '…';
      iso3dStatus.style.display = 'block';
      ensureParkLoaded(id).then(function(){
        open3DPanel(); // rebuild for the newly selected park
      }).catch(function(err){
        iso3dStatus.textContent = 'Could not load ' + NETWORKS[id].label + ' — check your connection.';
      });
    });
  }
  document.addEventListener('fullscreenchange', on3DFullscreenToggle);
  document.addEventListener('webkitfullscreenchange', on3DFullscreenToggle);
  document.addEventListener('mozfullscreenchange', on3DFullscreenToggle);
  // All four of these are display-option toggles on an already-open view, not
  // a new route/park -- pass preserveCamera=true so open3DPanel doesn't reset
  // the camera to the default "fit whole park" framing on every checkbox
  // click, which made it impossible to compare before/after a toggle without
  // losing whatever custom angle/zoom you'd set up. See mtbike-explorer/
  // README.txt, "3D line improvements" for how this was found and confirmed
  // (measured camera position before/after a toggle -- completely different).
  iso3dExaggInput.addEventListener('change', function(){
    t3d.cacheKey = null; // force rebuild with new exaggeration
    open3DPanel(true);
  });
  iso3dAllRoutesInput.addEventListener('change', function(){
    t3d.cacheKey = null;
    open3DPanel(true);
  });
  iso3dShowRidesInput.addEventListener('change', function(){
    t3d.cacheKey = null;
    open3DPanel(true);
  });
  iso3dShowNetworkInput.addEventListener('change', function(){
    t3d.cacheKey = null;
    open3DPanel(true);
  });
  iso3dSatelliteInput.addEventListener('change', function(){
    // Toggling this never needs to touch the USGS elevation data -- just rebuild the
    // mesh's material from what's already loaded (and cached imagery, if we have it).
    if (t3d.grid) buildTerrainMesh();
  });

  // ---- Compare trails ----
  // Ranks named trails by length/grade/steepness so you can size up a trail you
  // haven't ridden against one you know well, instead of guessing from someone
  // else's video. Two elevation sources: the precomputed terrain grid already
  // bundled for the 3D view (instant, offline, coarser resolution), or a live
  // per-point Open-Elevation lookup (same method the standalone trail-compare
  // tool used -- slower and needs internet, but truer to the actual tread).
