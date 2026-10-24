#!/bin/zsh
# Puts today's listings on schaeferwerks.com/coast: updates coast/data.json in a
# separate copy of the site repo (~/LandScout/site) and pushes; Cloudflare deploys it.
cd ~/LandScout || exit 1
SITE=~/LandScout/site
[ -d $SITE/.git ] || { echo "$(date) no site copy at $SITE; run install.sh"; exit 1; }

git -C $SITE pull --rebase --quiet || { echo "$(date) git pull failed"; exit 1; }
/usr/bin/python3 publish.py $SITE || exit 1
git -C $SITE add coast/data.json
if git -C $SITE diff --cached --quiet; then echo "$(date) site already up to date"; exit 0; fi
git -C $SITE commit --quiet -m "Coast Land Scout listings $(date +%Y-%m-%d)"

# Someone else (a Claude research session, deploy.command) may have pushed meanwhile.
for i in 1 2 3; do
  git -C $SITE push --quiet && { echo "$(date) published to schaeferwerks.com/coast"; exit 0; }
  sleep 10; git -C $SITE pull --rebase --quiet
done
echo "$(date) git push failed"; exit 1
