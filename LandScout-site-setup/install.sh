#!/bin/zsh
# Sets up the daily Coast Land Scout run on this Mac. Run it from the unzipped folder:
#   zsh install.sh
HERE=${0:A:h}
LS=~/LandScout
[ -d $LS ] || { echo "Couldn't find $LS"; exit 1; }

echo "Updating scripts in $LS (old run.sh saved as run.before-site.sh)..."
[ -f $LS/run.before-site.sh ] || cp $LS/run.sh $LS/run.before-site.sh
cp $HERE/run.sh $HERE/publish.sh $HERE/publish.py $LS/
chmod +x $LS/run.sh $LS/publish.sh
mkdir -p $LS/logs

if [ ! -d $LS/site/.git ]; then
  # Same GitHub address (and saved login) as the copy deploy.command uses.
  URL=$(git -C ~/Desktop/Claude/schaeferwerks remote get-url origin 2>/dev/null || echo https://github.com/justinschaefer/schaeferwerks.git)
  echo "Making a separate copy of the site for the daily job: $URL"
  git clone --quiet $URL $LS/site || { echo "Clone failed"; exit 1; }
fi

echo "Scheduling the daily run (6:07 AM)..."
PL=~/Library/LaunchAgents/com.schaeferwerks.landscout.plist
mkdir -p ~/Library/LaunchAgents
cp $HERE/com.schaeferwerks.landscout.plist $PL
launchctl bootout gui/$(id -u) $PL 2>/dev/null
launchctl bootstrap gui/$(id -u) $PL && echo "Scheduled."

if crontab -l 2>/dev/null | grep -qi landscout; then
  echo; echo "Note: your crontab also runs LandScout. Remove that line with 'crontab -e' so it doesn't run twice:"
  crontab -l | grep -i landscout
fi

echo; echo "Publishing the latest listings now..."
$LS/publish.sh
