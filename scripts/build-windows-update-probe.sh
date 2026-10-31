#!/bin/sh
# Build N+1 for the Windows update probe (native-windows-desktop, task 6.3):
# the app already built for this run, repackaged one patch version higher with
# a Beta `beta.yml` beside it. It is a feed for the probe only and is never
# published.
#
#   build-windows-update-probe.sh <version of build N> <output directory>
#
# Prints the update's version.
set -eu

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <version> <output directory>" >&2
  exit 64
fi
next=$(node -e '
const [major, minor, patch] = process.argv[1].split(/[.-]/u).map(Number);
if (![major, minor, patch].every(Number.isInteger)) process.exit(65);
console.log(`${major}.${minor}.${patch + 1}-update-probe`);
' "$1")
node_modules/.bin/electron-builder --win nsis --x64 --publish never \
  "-c.directories.output=$2" \
  -c.publish.channel=beta \
  "-c.extraMetadata.version=$next" \
  "-c.win.artifactName=terminay-update-probe-Setup.exe" >&2
test -f "$2/beta.yml"
test -f "$2/terminay-update-probe-Setup.exe"
echo "$next"
