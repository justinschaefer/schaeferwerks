/*
 * app-init.js
 * Startup sequence and service worker registration. Loads LAST --
// this is the only file that calls functions from every other file
// immediately (not from inside an event handler), so everything else
// must already be loaded first.
 *
 * Split out of index.html's single inline script into its own file
 * for navigability -- same global scope as before (classic scripts,
 * not modules), same execution order, no behavior change. See
 * mtbike-explorer/README.txt for why this split happened and how it
 * was verified.
 */


  // ---- Startup ----
  ensureParkLoaded(currentNetworkId).then(function(){ if (map) { draw2DTrailNetwork(); updateLegend([]); } }).catch(function(){}); // kick off eagerly; consumers already tolerate it not being ready yet
  loadRoutes();
  ensureMap();
  renderSidebar();
  if (routes.length) {
    activate(routes.length - 1);
  } else {
    showNoRouteInfo();
  }

  // Register after 'load' (not blocking initial render) so the very first
  // visit is never slowed down by this -- the offline-cache benefit only
  // matters from the *second* visit onward anyway.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function(){
      // Whether a SW is *already* controlling this page before we register
      // distinguishes "this device's first-ever install" (nothing to
      // announce -- there was nothing older to update from) from "a new
      // version just took over an already-running tab" (worth telling the
      // person about, since their currently-loaded page is still the old
      // code until they refresh).
      var hadController = !!navigator.serviceWorker.controller;
      var refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', function(){
        if (typeof refreshCacheVersionText === 'function') refreshCacheVersionText();
        if (refreshing) return;
        if (hadController) showUpdateBanner();
        hadController = true; // only announce once per genuine version change
      });

      navigator.serviceWorker.register('sw.js').then(function(reg){
        // A tab that's kept open for a while (or a PWA left running) won't
        // otherwise notice a new deploy until something else triggers a
        // fetch of sw.js -- checking again whenever the tab regains focus
        // catches "came back from a ride and it's still open" without
        // needing to poll constantly in the background.
        document.addEventListener('visibilitychange', function(){
          if (document.visibilityState === 'visible') reg.update().catch(function(){});
        });
      }).catch(function(err){
        console.warn('Service worker registration failed (offline mode will not be available):', err);
      });

      var updateBannerEl = document.getElementById('updateBanner');
      function showUpdateBanner() {
        if (updateBannerEl) updateBannerEl.classList.add('show');
      }
      var refreshBtn = document.getElementById('updateBannerRefreshBtn');
      if (refreshBtn) refreshBtn.addEventListener('click', function(){
        refreshing = true;
        location.reload();
      });
      var dismissBtn = document.getElementById('updateBannerDismissBtn');
      if (dismissBtn) dismissBtn.addEventListener('click', function(){
        if (updateBannerEl) updateBannerEl.classList.remove('show');
      });
    });
  }
