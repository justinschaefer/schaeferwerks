/*
 * ui-shell.js
 * Drawer open/close chrome (sidebar, right panel) and viewport-resize
// handling -- generic UI plumbing, not specific to any one feature.
 *
 * Split out of index.html's single inline script into its own file
 * for navigability -- same global scope as before (classic scripts,
 * not modules), same execution order, no behavior change. See
 * mtbike-explorer/README.txt for why this split happened and how it
 * was verified.
 */
  var sidebarEl = document.getElementById('sidebar');
  var panelEl = document.querySelector('.panel');
  var routesToggleBtn = document.getElementById('routesToggleBtn');
  var detailsToggleBtn = document.getElementById('detailsToggleBtn');
  var panelBackdrop = document.getElementById('panelBackdrop');
  var topBarEl = document.getElementById('topBar');

  // On mobile (<1024px, see the CSS media query) the drawers are
  // position:fixed overlays starting at top:0 -- which, since their
  // z-index has to sit above the page content to overlay it, also sits
  // above #topBar itself, physically covering the very toggle buttons
  // (Routes / Compare trails / Details) meant to switch between them.
  // openRightPanelTab() above is explicitly written to let tapping a
  // different tab's button switch directly without closing first --
  // that only works if those buttons are actually reachable, which they
  // weren't: on a real phone-width screen, Compare trails and Details
  // were both entirely hidden under whichever drawer was already open,
  // and even Routes was only reachable via a sliver a few px wide.
  // Fix: measure the toolbar's real height (it isn't fixed -- it wraps
  // differently at different widths) and keep the drawer's top edge
  // (and backdrop's) below it instead of covering it, rather than
  // trying to out-z-index the toolbar and hope nothing visually breaks.
  function positionMobileDrawers() {
    if (window.innerWidth > 1023) {
      sidebarEl.style.top = ''; sidebarEl.style.height = '';
      panelEl.style.top = ''; panelEl.style.height = '';
      panelBackdrop.style.top = ''; panelBackdrop.style.height = '';
      return;
    }
    var barBottom = Math.ceil(topBarEl.getBoundingClientRect().bottom);
    var heightExpr = 'calc(100vh - ' + barBottom + 'px)';
    sidebarEl.style.top = barBottom + 'px'; sidebarEl.style.height = heightExpr;
    panelEl.style.top = barBottom + 'px'; panelEl.style.height = heightExpr;
    // The backdrop needs the SAME top-offset treatment, not just the drawer
    // itself -- position:fixed + a high z-index blocks clicks under it
    // whether or not it's visually opaque there, so leaving it full-screen
    // (as an earlier version of this fix did) meant the toolbar was still
    // unclickable, just via an invisible dimming layer instead of the
    // visible panel. Caught by actually re-running the QA script's mobile
    // pass against this fix rather than trusting the first pass verification
    // -- that only checked the panel's own position, not the backdrop's.
    panelBackdrop.style.top = barBottom + 'px'; panelBackdrop.style.height = heightExpr;
  }

  function closeDrawers() {
    sidebarEl.classList.remove('open');
    panelEl.classList.remove('open');
    routesToggleBtn.classList.remove('open');
    detailsToggleBtn.classList.remove('open');
    if (compareToggleBtn) compareToggleBtn.classList.remove('open');
    panelBackdrop.classList.remove('visible');
    onViewportResize();
  }
  function openDrawer(el, btn) {
    var alreadyOpen = el.classList.contains('open');
    closeDrawers();
    if (!alreadyOpen) {
      positionMobileDrawers();
      el.classList.add('open');
      btn.classList.add('open');
      panelBackdrop.classList.add('visible');
      onViewportResize();
    }
  }
  // The right panel has two tabs (Details / Compare) sharing one open/closed state.
  // Clicking a tab's top-bar button: if the panel's closed, open it on that tab: if
  // it's open already showing that SAME tab, close it (normal toggle-button feel):
  // if it's open showing the OTHER tab, just switch tabs without closing anything.
  function openRightPanelTab(showTabFn, btn) {
    var isOpen = panelEl.classList.contains('open');
    var isThisTabActive = btn.classList.contains('open');
    if (isOpen && isThisTabActive) { closeDrawers(); return; }
    positionMobileDrawers();
    sidebarEl.classList.remove('open');
    routesToggleBtn.classList.remove('open');
    panelEl.classList.add('open');
    detailsToggleBtn.classList.remove('open');
    if (compareToggleBtn) compareToggleBtn.classList.remove('open');
    btn.classList.add('open');
    panelBackdrop.classList.add('visible');
    showTabFn();
    onViewportResize();
  }
  // Opening/closing a side panel changes the map/3D viewport's available width via a
  // CSS transition, not an actual window resize -- so the browser never fires its own
  // 'resize' event and Leaflet/Three.js would otherwise keep stale tile/canvas sizing.
  // Fire right away and again after the transition finishes to catch the final size.
  function onViewportResize() {
    positionMobileDrawers();
    if (map) map.invalidateSize();
    if (typeof resizeIso3DRenderer === 'function') resizeIso3DRenderer();
    setTimeout(function(){
      if (map) map.invalidateSize();
      if (typeof resizeIso3DRenderer === 'function') resizeIso3DRenderer();
    }, 220);
  }
  routesToggleBtn.addEventListener('click', function(){ openDrawer(sidebarEl, routesToggleBtn); });
  detailsToggleBtn.addEventListener('click', function(){ openRightPanelTab(showDetailsTab, detailsToggleBtn); });
  panelBackdrop.addEventListener('click', closeDrawers);

  document.getElementById('exportAllBtn').addEventListener('click', function(){
    if (!routes.length) {
      showError('Nothing to export yet — load a GPX file first.');
      return;
    }
    var backup = { savedAt: new Date().toISOString(), routes: routes };
    var blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'gpx-explorer-backup-' + new Date().toISOString().slice(0,10) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  document.getElementById('importAllBtn').addEventListener('click', function(){
    document.getElementById('importAllInput').click();
  });
  document.getElementById('importAllInput').addEventListener('change', function(e){
    var file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(ev){
      try {
        var data = JSON.parse(ev.target.result);
        if (!data || !Array.isArray(data.routes)) throw new Error('not a recognized backup file');
        var addRoutes = data.routes.length;
        if (!confirm('Import ' + addRoutes + ' route(s)? This adds to what\'s already loaded — it won\'t remove anything.')) return;
        routes = routes.concat(data.routes);
        saveRoutes();
        renderSidebar();
        activate(routes.length - 1);
      } catch (err) {
        showError('Couldn\'t read that backup file: ' + err.message);
      }
    };
    reader.onerror = function(){ showError('Failed to read the file.'); };
    reader.readAsText(file);
  });

  document.getElementById('openBtn').addEventListener('click', function(){
    document.getElementById('fileInput').click();
  });
  document.getElementById('fileInput').addEventListener('change', function(e){
    loadFiles(e.target.files);
    e.target.value = '';
  });

  // ---- Cache/version diagnostics + force-refresh ----
  // The offline service worker (sw.js) precaches the app's JS under a
  // versioned cache name (CACHE_NAME = 'gpx-explorer-' + CACHE_VERSION --
  // see sw.js's own comment on CACHE_VERSION for why that versioning
  // exists). The failure mode this exists to fix: if a deploy touches
  // index.html or the JS files WITHOUT bumping CACHE_VERSION, sw.js
  // itself is byte-identical to what's already registered, so the
  // browser's service worker update check finds nothing to install -- the
  // already-installed worker just keeps serving its old cached files
  // forever, no matter how many times the underlying files get re-
  // uploaded to the server. Reported directly as a repeated real problem,
  // not a one-off, so this is two things, not one:
  //   1. A visible readout of which cache version is ACTUALLY active
  //      right now, read live from Cache Storage rather than a second
  //      hardcoded constant that could itself drift out of sync with
  //      sw.js -- trustworthy by construction, not by discipline.
  //   2. A manual escape hatch (forceRefreshBtn) that doesn't depend on
  //      CACHE_VERSION having been bumped at all: unregisters the service
  //      worker and deletes every cache this app owns, then reloads with
  //      a cache-busting query string so even a stale HTTP-level cache
  //      (not just the SW's Cache Storage) can't serve an old copy.
  //      Deliberately does NOT touch localStorage -- loaded routes (see
  //      ROUTES_KEY in routes-data.js) live there, completely separate
  //      from Cache Storage, and are untouched by this.
  var cacheVersionTextEl = document.getElementById('cacheVersionText');
  function refreshCacheVersionText() {
    if (!cacheVersionTextEl) return;
    if (!('caches' in window)) { cacheVersionTextEl.textContent = 'Offline cache not supported in this browser'; return; }
    caches.keys().then(function(names){
      var appCache = names.find(function(n){ return /^gpx-explorer-v\d+$/.test(n); });
      cacheVersionTextEl.textContent = appCache ? ('Cached app version: ' + appCache.replace('gpx-explorer-', '')) : 'Not cached yet (offline mode not active)';
    }).catch(function(){ cacheVersionTextEl.textContent = ''; });
  }
  refreshCacheVersionText();

  var forceRefreshBtn = document.getElementById('forceRefreshBtn');
  if (forceRefreshBtn) forceRefreshBtn.addEventListener('click', function(){
    forceRefreshBtn.classList.add('working');
    forceRefreshBtn.textContent = 'Refreshing…';
    var unregisterAll = ('serviceWorker' in navigator)
      ? navigator.serviceWorker.getRegistrations().then(function(regs){ return Promise.all(regs.map(function(r){ return r.unregister(); })); })
      : Promise.resolve();
    var deleteAllCaches = ('caches' in window)
      ? caches.keys().then(function(names){ return Promise.all(names.map(function(n){ return caches.delete(n); })); })
      : Promise.resolve();
    Promise.all([unregisterAll, deleteAllCaches]).then(function(){
      location.href = location.pathname + '?_forceRefresh=' + Date.now();
    }).catch(function(err){
      forceRefreshBtn.classList.remove('working');
      forceRefreshBtn.textContent = 'Force refresh from server';
      showError('Refresh failed: ' + err.message + ' \u2014 try closing all tabs of this app and reopening.');
    });
  });

