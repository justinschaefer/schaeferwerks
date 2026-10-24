# Coast Land Scout research notes

`coast/notes.json` holds what Claude learns while researching properties. The page at
schaeferwerks.com/coast reads it, so a note shows up once it is committed and pushed
(Cloudflare deploys in about 30 seconds). This file is not published (see `.assetsignore`).

The listings themselves (`coast/data.json`) are rewritten every morning by the daily job on
Justin's Mac (`~/LandScout/run.sh`). Don't edit `data.json` by hand; put findings here instead.

## Format

```json
{
  "listings": {
    "134333814": {
      "rv": "yes",
      "tags": ["Septic approved", "Power at road"],
      "note": "What was learned, in plain words. Blank lines split paragraphs.",
      "sources": [{"title": "Lincoln County RV rules", "url": "https://..."}],
      "updated": "2026-10-24"
    }
  },
  "areas": [
    {"city": "Rockaway Beach", "state": "OR", "rv": "limited", "note": "...", "sources": [], "updated": "2026-10-24"}
  ]
}
```

- **Listing key**: the listing's `id` in `data.json` (the Redfin property id, the number at the end of its Redfin link).
- **`rv`**: `yes` (living in or parking an RV on the lot is allowed), `limited` (allowed with limits, such as a time cap,
  a permit or only while building), or `no`. Leave it out when unknown. A listing's own `rv` wins over an area's.
- **`tags`**: short labels shown on the listing's row, up to four.
- **Areas** match listings by `city` + `state` (as spelled in `data.json`). Use them for rules that apply to a whole town.
- Keep JSON valid: the page shows no research at all if `notes.json` fails to parse. Check with
  `python3 -m json.tool coast/notes.json`.
