// Serves the static site, plus a small API for star ranks and passes on Coast Land Scout (/coast)
// and RV Scout (/rv). Ranks can be saved by a request that came through Cloudflare Access (it adds the
// Cf-Access-Authenticated-User-Email header) or by the page itself (the browser marks those same-origin).
// Neither page is behind Access yet, so anyone who finds a page can see it.

// RV Scout's listings. The MacBook Pro that runs the daily search has no GitHub login, so instead of
// pushing rv/data.json it uploads it here (POST /rv/api/data with its key), and /rv/data.json is served
// from KV. Only the SHA-256 of the upload key is here; the key itself is in ~/RVScout/upload.key on that Mac.
const RV_DATA_KEY = "rv-data";
// The /rv page itself can be updated the same way (POST /rv/api/page with the same key), so a fix to the
// page doesn't need a push from the Mac with the website folder. Without an upload, rv/index.html is served.
const RV_PAGE_KEY = "rv-page";
// "Search now": the page asks (POST /rv/api/search), the MacBook Pro checks every 2 minutes
// (POST /rv/api/search/claim with its key) and runs the search; its upload marks the search done.
const RV_SEARCH_KEY = "rv-search";
const SEARCH_GAP_MIN = 15;   // no new request within 15 minutes of the last search
const SEARCH_STUCK_MIN = 45; // a search that started this long ago and never uploaded is given up on
const RV_UPLOAD_KEY_SHA256 = "cdc801a32ca7d81858f5341927d545fe06a9b8460a45c2544d9bb0df6c328632";

// Each page keeps its ranks under its own key in the COAST KV namespace.
const APPS = {
  coast: { key: "ratings", seed: "/coast/seed-ratings.json", id: /^\d{1,12}$/, page: "/coast" },
  rv: { key: "rv-ratings", seed: "/rv/seed-ratings.json", id: /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/, page: "/rv" },
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/coast/api/ratings") return ratings(request, env, url, APPS.coast);
    if (url.pathname === "/rv/api/ratings") return ratings(request, env, url, APPS.rv);
    if (url.pathname === "/rv/api/data") return uploadRvData(request, env);
    if (url.pathname === "/rv/api/page") return uploadRvPage(request, env);
    if (url.pathname === "/rv/api/search") return searchNow(request, env, url);
    if (url.pathname === "/rv/api/search/claim") return claimSearch(request, env);
    if (url.pathname === "/rv/" || url.pathname === "/rv/index.html") {
      const page = await env.COAST.get(RV_PAGE_KEY);
      if (page) return new Response(page, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
    }
    if (url.pathname === "/rv/data.json") {
      const data = await env.COAST.get(RV_DATA_KEY);
      if (data) return new Response(data, { headers: { "content-type": "application/json", "cache-control": "no-cache" } });
    }
    return env.ASSETS.fetch(request);
  },
};

// Through Cloudflare Access, or from the page's own scripts (browsers send Sec-Fetch-Site and, on a POST,
// Origin; another site's page can't make them say same-origin).
const allowed = (request, url) =>
  !!request.headers.get("cf-access-authenticated-user-email") ||
  (request.headers.get("sec-fetch-site") === "same-origin" &&
    (request.method === "GET" || request.headers.get("origin") === url.origin));

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function loadRatings(env, url, app) {
  const saved = await env.COAST.get(app.key, "json");
  if (saved) return saved;
  // First run: start from the ranks carried over from the old claude.ai page.
  const seed = await env.ASSETS.fetch(new URL(app.seed, url));
  return seed.ok ? await seed.json() : {};
}

async function ratings(request, env, url, app) {
  if (!allowed(request, url)) {
    return json({ error: `Open ${app.page} on schaeferwerks.com to save ranks.` }, 403);
  }
  if (request.method === "GET") return json(await loadRatings(env, url, app));
  if (request.method !== "POST") return json({ error: "Use GET or POST." }, 405);

  // POST {id, stars, pass}: one listing's rank. Stars 0 and no pass clears it.
  let body;
  try { body = await request.json(); } catch { return json({ error: "Bad JSON." }, 400); }
  const id = String(body.id || "");
  if (!app.id.test(id)) return json({ error: "Bad listing id." }, 400);
  const stars = Math.max(0, Math.min(5, Math.round(Number(body.stars) || 0)));
  const pass = !!body.pass;

  const all = await loadRatings(env, url, app);
  if (!stars && !pass) delete all[id];
  else all[id] = { stars, pass, t: new Date().toISOString() };
  await env.COAST.put(app.key, JSON.stringify(all));
  return json(all);
}

async function sha256Hex(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function keyOk(request) {
  const key = request.headers.get("x-rvscout-key") || "";
  return !!key && (await sha256Hex(key)) === RV_UPLOAD_KEY_SHA256;
}

// POST the whole rv/data.json with header X-RVScout-Key: the daily search on the MacBook Pro does this.
async function uploadRvData(request, env) {
  if (request.method !== "POST") return json({ error: "Use POST." }, 405);
  if (!(await keyOk(request))) return json({ error: "Wrong upload key." }, 403);
  const text = await request.text();
  let data;
  try { data = JSON.parse(text); } catch { return json({ error: "Bad JSON." }, 400); }
  if (!Array.isArray(data.rows) || !data.updated) return json({ error: "Expected {updated, rows: [...]}." }, 400);
  await env.COAST.put(RV_DATA_KEY, text);
  const st = await searchState(env);
  st.finished = new Date().toISOString();  // any upload (daily or "Search now") ends a search
  await env.COAST.put(RV_SEARCH_KEY, JSON.stringify(st));
  return json({ ok: true, rows: data.rows.length, updated: data.updated });
}

// POST a new /rv page (HTML) with header X-RVScout-Key; an RV Scout update file on the MacBook Pro does this.
async function uploadRvPage(request, env) {
  if (request.method !== "POST") return json({ error: "Use POST." }, 405);
  if (!(await keyOk(request))) return json({ error: "Wrong upload key." }, 403);
  const html = await request.text();
  if (!/<title>RV Deal Tracker<\/title>/.test(html) || html.length > 500000) return json({ error: "That isn't the RV page." }, 400);
  await env.COAST.put(RV_PAGE_KEY, html);
  return json({ ok: true, bytes: html.length });
}

// {requested, started, finished}: ISO times of the last "Search now" press, when the Mac picked it up,
// and the last upload. status is what the page shows.
async function searchState(env) {
  return (await env.COAST.get(RV_SEARCH_KEY, "json")) || {};
}
const minsSince = (t) => (t ? (Date.now() - Date.parse(t)) / 60000 : Infinity);
function searchStatus(st) {
  const after = (a, b) => a && (!b || Date.parse(a) > Date.parse(b));
  if (after(st.started, st.finished) && minsSince(st.started) < SEARCH_STUCK_MIN) return "searching";
  if (after(st.requested, st.finished) && !after(st.started, st.requested)) return "requested";
  return "idle";
}

// GET: the page asks for the status. POST: the page's Search now button.
async function searchNow(request, env, url) {
  if (!allowed(request, url)) return json({ error: "Open /rv on schaeferwerks.com to search." }, 403);
  const st = await searchState(env);
  if (request.method === "POST") {
    const status = searchStatus(st);
    if (status === "idle" && minsSince(st.finished) < SEARCH_GAP_MIN) {
      return json({ ...st, status, error: `The last search finished less than ${SEARCH_GAP_MIN} minutes ago.` }, 429);
    }
    if (status === "idle") {
      st.requested = new Date().toISOString();
      await env.COAST.put(RV_SEARCH_KEY, JSON.stringify(st));
    }
  } else if (request.method !== "GET") {
    return json({ error: "Use GET or POST." }, 405);
  }
  return json({ ...st, status: searchStatus(st) });
}

// The MacBook Pro, every 2 minutes, with its key: {run: true} once per request.
async function claimSearch(request, env) {
  if (request.method !== "POST") return json({ error: "Use POST." }, 405);
  if (!(await keyOk(request))) return json({ error: "Wrong upload key." }, 403);
  const st = await searchState(env);
  if (searchStatus(st) !== "requested") return json({ run: false });
  st.started = new Date().toISOString();
  await env.COAST.put(RV_SEARCH_KEY, JSON.stringify(st));
  return json({ run: true });
}
