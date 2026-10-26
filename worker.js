// Serves the static site, plus a small API for star ranks and passes on Coast Land Scout (/coast)
// and RV Scout (/rv). Ranks can be saved by a request that came through Cloudflare Access (it adds the
// Cf-Access-Authenticated-User-Email header) or by the page itself (the browser marks those same-origin).
// Neither page is behind Access yet, so anyone who finds a page can see it.

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
