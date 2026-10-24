# Writes the listings for schaeferwerks.com/coast (coast/data.json) from rows.json + seen.json.
#   python3 publish.py [site_folder]   (default ~/LandScout/site)
import json, os, sys, datetime
D = os.path.expanduser(os.environ.get("LANDSCOUT_DIR", "~/LandScout"))
site = sys.argv[1] if len(sys.argv) > 1 else os.path.join(D, "site")
rows = json.load(open(os.path.join(D, "rows.json"))); seen = json.load(open(os.path.join(D, "seen.json")))
today = datetime.date.today()
week = (today - datetime.timedelta(days=6)).isoformat()
first_ever = min(v["first"] for v in seen.values())
for x in rows:
    s0 = seen.get(x["id"], {"first": today.isoformat()})
    x["first"] = s0["first"]; x["isNew"] = x["first"] >= week and x["first"] != first_ever
    x["dropFrom"] = s0["was"] if s0.get("changed", "") >= week and s0.get("was", 0) > x["price"] else None
out = os.path.join(site, "coast", "data.json")
os.makedirs(os.path.dirname(out), exist_ok=True)
json.dump({"asof": today.isoformat(), "rows": rows}, open(out, "w"), separators=(",", ":"))
print(sum(x["isNew"] for x in rows), "new of", len(rows), "->", out)
