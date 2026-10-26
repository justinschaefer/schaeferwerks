// Serves the static site, plus a small API for star ranks and passes on Coast Land Scout (/coast)
// and RV Scout (/rv). Both pages are meant to sit behind Cloudflare Access, which adds the
// Cf-Access-Authenticated-User-Email header; requests without it are refused.

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
    // /rv runs through this worker first (see run_worker_first in wrangler.jsonc), so the page and
    // its data stay private even if the Access rule for /rv is missing.
    if ((url.pathname === "/rv" || url.pathname.startsWith("/rv/")) && !signedIn(request)) {
      return new Response("RV Scout is private. Add the rv path to the Cloudflare Access app that protects /coast.", {
        status: 403, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
      });
    }
    return env.ASSETS.fetch(request);
  },
};

const signedIn = (request) => !!request.headers.get("cf-access-authenticated-user-email");

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
  if (!signedIn(request)) {
    return json({ error: `Turn on Cloudflare Access for ${app.page} to save ranks.` }, 403);
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
