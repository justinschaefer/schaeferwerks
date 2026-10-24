// Serves the static site, plus a small API for Coast Land Scout star ranks and passes.
// Everything under /coast is meant to sit behind Cloudflare Access, which adds the
// Cf-Access-Authenticated-User-Email header; requests without it are refused.

const RATINGS_KEY = "ratings";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/coast/api/ratings") return ratings(request, env, url);
    return env.ASSETS.fetch(request);
  },
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function loadRatings(env, url) {
  const saved = await env.COAST.get(RATINGS_KEY, "json");
  if (saved) return saved;
  // First run: start from the ranks carried over from the old claude.ai page.
  const seed = await env.ASSETS.fetch(new URL("/coast/seed-ratings.json", url));
  return seed.ok ? await seed.json() : {};
}

async function ratings(request, env, url) {
  if (!request.headers.get("cf-access-authenticated-user-email")) {
    return json({ error: "Turn on Cloudflare Access for /coast to save ranks." }, 403);
  }
  if (request.method === "GET") return json(await loadRatings(env, url));
  if (request.method !== "POST") return json({ error: "Use GET or POST." }, 405);

  // POST {id, stars, pass}: one listing's rank. Stars 0 and no pass clears it.
  let body;
  try { body = await request.json(); } catch { return json({ error: "Bad JSON." }, 400); }
  const id = String(body.id || "");
  if (!/^\d{1,12}$/.test(id)) return json({ error: "Bad listing id." }, 400);
  const stars = Math.max(0, Math.min(5, Math.round(Number(body.stars) || 0)));
  const pass = !!body.pass;

  const all = await loadRatings(env, url);
  if (!stars && !pass) delete all[id];
  else all[id] = { stars, pass, t: new Date().toISOString() };
  await env.COAST.put(RATINGS_KEY, JSON.stringify(all));
  return json(all);
}
