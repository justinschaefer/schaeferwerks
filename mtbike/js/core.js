/*
 * core.js
 * Foundational shared utilities: API keys/config, distance math, date/time formatting, bearing/compass. No dependency on any other
// split file here -- loads first.
 *
 * Split out of index.html's single inline script into its own file
 * for navigability -- same global scope as before (classic scripts,
 * not modules), same execution order, no behavior change. See
 * mtbike-explorer/README.txt for why this split happened and how it
 * was verified.
 */
  // Thunderforest key is a free-tier public map-styling key, not a secret —
  // it's meant to sit in client code. Usage is capped by referrer restriction
  // set on the Thunderforest account, not by hiding this string. If you haven't
  // already, set an HTTP referrer restriction to schaeferwerks.com on the
  // Thunderforest dashboard so the key can't be lifted and used elsewhere.
  var THUNDERFOREST_API_KEY = 'f64e322d1be545349e84974ddd223ccd';
  var CARTO_API_KEY = 'cb1_2jx2_1_b486a89cdf3e8a5b55bb9f71';
  function haversineM(lat1, lon1, lat2, lon2) {
    var R = 6371000;
    var p1 = lat1 * Math.PI/180, p2 = lat2 * Math.PI/180;
    var dphi = (lat2 - lat1) * Math.PI/180;
    var dlmb = (lon2 - lon1) * Math.PI/180;
    var a = Math.sin(dphi/2)*Math.sin(dphi/2) + Math.cos(p1)*Math.cos(p2)*Math.sin(dlmb/2)*Math.sin(dlmb/2);
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function fmtElapsed(sec) {
    var m = Math.floor(sec/60), s = Math.round(sec%60);
    return m + ':' + (s<10?'0':'') + s;
  }

  function fmtDuration(sec) {
    var h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = Math.round(sec%60);
    return (h>0 ? h+':' : '') + (h>0 && m<10 ? '0':'') + m + ':' + (s<10?'0':'') + s;
  }

  function haversineMi(lat1,lon1,lat2,lon2){ return haversineM(lat1,lon1,lat2,lon2) * 0.000621371; }
  var COMPASS_POINTS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  function bearingDeg(lat1, lon1, lat2, lon2) {
    // Standard initial-bearing formula (great-circle), degrees clockwise from
    // north. This is the direction of travel *at the start point*, not a
    // constant heading -- fine for a straight-ish A-to-B stat, and it's
    // exactly what "which way was I initially headed" means for a ride.
    var p1 = lat1 * Math.PI/180, p2 = lat2 * Math.PI/180;
    var dl = (lon2 - lon1) * Math.PI/180;
    var y = Math.sin(dl) * Math.cos(p2);
    var x = Math.cos(p1)*Math.sin(p2) - Math.sin(p1)*Math.cos(p2)*Math.cos(dl);
    return (Math.atan2(y, x) * 180/Math.PI + 360) % 360;
  }
  function compassLabel(deg) { return COMPASS_POINTS[Math.round(deg/22.5) % 16]; }
  function haversineFt(lat1, lon1, lat2, lon2) { return haversineM(lat1, lon1, lat2, lon2) * 3.28084; }
