#!/bin/bash
cd "/Users/justinschaefer/Desktop/Claude/schaeferwerks" || { echo "Could not find the schaeferwerks folder."; read -p "Press enter to close..."; exit 1; }

echo "Checking for changes..."
git add -A

if git diff --cached --quiet; then
  echo "Nothing to deploy — no changes found."
  read -p "Press enter to close..."
  exit 0
fi

TIMESTAMP=$(date "+%Y-%m-%d %H:%M")
git commit -m "Update site - $TIMESTAMP"

echo "Pushing to GitHub (this triggers the Cloudflare deploy)..."
git push

echo ""
echo "Done. Cloudflare will finish deploying within about 20-30 seconds."
read -p "Press enter to close..."
