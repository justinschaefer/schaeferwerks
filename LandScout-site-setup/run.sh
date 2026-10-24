#!/bin/zsh
# Daily coastal land pull: Redfin map data -> filtered rows.json -> spreadsheet -> schaeferwerks.com/coast.
cd ~/LandScout || exit 1
echo "--- $(date)"
# Two pulls, merged: the map API drops different homes at different tile sizes.
/usr/bin/python3 pull3.py raw/coarse.json || exit 1
/usr/bin/python3 pull5.py raw/fine.json || exit 1
/usr/bin/python3 -c "import json;a={x['propertyId']:x for f in ('raw/coarse.json','raw/fine.json') for x in json.load(open(f))};json.dump(list(a.values()),open('raw/latest.json','w'))" || exit 1
/usr/bin/python3 -c "import json,sys;n=len(json.load(open('raw/latest.json')));sys.exit(0 if n>5000 else 1)" || { echo "$(date) pull looked incomplete; kept old data"; exit 1; }
/usr/bin/python3 process.py raw/latest.json rows.json | head -1
/usr/bin/python3 enrich.py rows.json
/usr/bin/python3 build_xlsx.py
./publish.sh
