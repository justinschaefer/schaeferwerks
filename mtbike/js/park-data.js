/*
 * park-data.js
 * Which parks exist, their bounds, and lazy-loading each park's
// trail/terrain data files only when it's actually the active park.
 *
 * Split out of index.html's single inline script into its own file
 * for navigability -- same global scope as before (classic scripts,
 * not modules), same execution order, no behavior change. See
 * mtbike-explorer/README.txt for why this split happened and how it
 * was verified.
 */

  // Three.js (~600KB) is only needed for the 3D terrain view, so it's loaded
  // on demand the first time that panel is opened, not on initial page load.
  var threeLoadPromise = null;
  function ensureThree() {
    if (window.THREE && window.THREE.Line2) return Promise.resolve();
    if (threeLoadPromise) return threeLoadPromise;
    threeLoadPromise = new Promise(function(resolve, reject){
      var s = document.createElement('script');
      s.src = 'three.min.js';
      s.onload = function(){
        var s2 = document.createElement('script');
        s2.src = 'three-lines.js';
        s2.onload = resolve;
        s2.onerror = function(){ threeLoadPromise = null; reject(new Error('Could not load the 3D line-rendering library.')); };
        document.head.appendChild(s2);
      };
      s.onerror = function(){ threeLoadPromise = null; reject(new Error('Could not load the 3D library. If this is the first time opening the map on this device, it needs one successful load with a connection before it works offline.')); };
      document.head.appendChild(s);
    });
    return threeLoadPromise;
  }

  // ---- Which park's trail network + precomputed terrain is active ----
  var NETWORKS = {
    ucsc: { id: 'ucsc', label: 'UCSC / Twin Gates', trailVar: 'UCSC_TRAIL_NETWORK', terrainVar: 'UCSC_TERRAIN_DATA' },
    // West of Empire Grade from the UCSC network above -- Wilder Ranch plus
    // the closer cluster right across the road (Mailboxes, Wally World,
    // Broncos, Red Mailbox, and friends). Split into its own park, same as
    // Fall Creek below, rather than drawn as an overlay on the UCSC map,
    // because a real 3D view needs its own elevation grid to render
    // correctly -- see wilder_terrain_data.js and mtbike-explorer/README.txt,
    // "Empire Grade / Highway 9 data split".
    wilder: { id: 'wilder', label: 'Wilder Ranch (west of Empire Grade)', trailVar: 'WILDER_TRAIL_NETWORK', terrainVar: 'WILDER_TERRAIN_DATA' },
    annadel: { id: 'annadel', label: 'Trione-Annadel State Park', trailVar: 'ANNADEL_TRAIL_NETWORK', terrainVar: 'ANNADEL_TERRAIN_DATA' },
    lacamas: { id: 'lacamas', label: 'Lacamas Park, Camas WA', trailVar: 'LACAMAS_TRAIL_NETWORK', terrainVar: 'LACAMAS_TERRAIN_DATA' },
    fallcreek: { id: 'fallcreek', label: 'Fall Creek / Bear Mountain, Felton', trailVar: 'FALLCREEK_TRAIL_NETWORK', terrainVar: 'FALLCREEK_TERRAIN_DATA' },
    art: { id: 'art', label: 'Arnold Rim Trail (ART), Arnold CA', trailVar: 'ART_TRAIL_NETWORK', terrainVar: 'ART_TERRAIN_DATA' }
  };
  var NETWORK_KEY = 'gpxExplorerNetwork';
  var currentNetworkId = (function(){
    try {
      var saved = localStorage.getItem(NETWORK_KEY);
      return (saved && NETWORKS[saved]) ? saved : 'ucsc';
    } catch (e) { return 'ucsc'; }
  })();
  function currentNetworkDef() { return NETWORKS[currentNetworkId]; }
  function currentTrailData() { return window[currentNetworkDef().trailVar] || null; }
  function currentTerrainData() { return window[currentNetworkDef().terrainVar] || null; }

  // Loads one park's trail+terrain data on demand instead of all five up
  // front. Caches the in-flight/completed promise per park so switching to
  // the same park twice (or two things needing it at once) doesn't fire a
  // second pair of requests.
  var parkLoadPromises = {};
  function loadScript(src) {
    return new Promise(function(resolve, reject){
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function(){ reject(new Error('Could not load ' + src)); };
      document.head.appendChild(s);
    });
  }
  function ensureParkLoaded(id) {
    var def = NETWORKS[id];
    if (!def) return Promise.reject(new Error('Unknown park: ' + id));
    if (window[def.trailVar] && window[def.terrainVar]) return Promise.resolve();
    if (parkLoadPromises[id]) return parkLoadPromises[id];
    parkLoadPromises[id] = Promise.all([
      loadScript(id + '_trails_data.js'),
      loadScript(id + '_terrain_data.js')
    ]).catch(function(err){
      parkLoadPromises[id] = null; // let a retry happen later instead of caching a permanent failure
      throw err;
    });
    return parkLoadPromises[id];
  }
  var networkManuallyChosen = false;
  function setCurrentNetwork(id, manual) {
    if (!NETWORKS[id] || id === currentNetworkId) {
      if (manual) networkManuallyChosen = true; // still record intent even if it's already selected
      return;
    }
    if (networkManuallyChosen && !manual) return; // GPS auto-detect never overrides an explicit choice
    currentNetworkId = id;
    if (manual) networkManuallyChosen = true;
    try { localStorage.setItem(NETWORK_KEY, id); } catch (e) {}
  }

