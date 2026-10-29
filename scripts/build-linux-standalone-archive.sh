#!/bin/sh
# Build one self-contained standalone server archive (ADR-0016). Linux lanes
# run this inside the GNU/Linux floor image through run-in-linux-floor.sh
# (ADR-0077), so the native code it stages is linked against the floor.
#
#   build-linux-standalone-archive.sh <linux-x64|linux-arm64> <tag|main> <revision> <output-file>
set -eu

if [ "$#" -ne 4 ]; then
  echo "Usage: $0 <linux-x64|linux-arm64> <tag|main> <revision> <output-file>" >&2
  exit 64
fi
target=$1
channel=$2
revision=$3
output=$4
case "$target" in
  linux-x64|linux-arm64) ;;
  *) echo "Unsupported target: $target" >&2; exit 64 ;;
esac
if [ -e "$output" ]; then
  echo "Output already exists: $output" >&2
  exit 73
fi

temporary=$(mktemp -d "${TMPDIR:-/tmp}/terminay-standalone.XXXXXX")
trap 'rm -rf "$temporary"' EXIT HUP INT TERM

# The archive carries the compiled server, its workspace packages, and the UI
# bundle it serves, so the whole application graph is built here rather than
# compiling the server in isolation.
npm run build:app
npm run verify:built-in-extensions
node scripts/stage-selected-secure-werift-runtime.mjs
node_archive_url=$(node -e 'import("./scripts/pty-runtime-platforms.mjs").then((module) => process.stdout.write(module.getPtyRuntimePlatform(process.argv[1]).nodeArchive))' "$target")
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  --output "$temporary/node-runtime.tar.xz" "$node_archive_url"
# The builder re-verifies the pinned Node archive digest and the ELF machine of
# every native binary it stages, so a wrong download or a wrong architecture
# fails here rather than on an operator's box.
node scripts/build-standalone-server-artifact.mjs \
  --target "$target" \
  --channel "$channel" \
  --revision "$revision" \
  --node-archive "$temporary/node-runtime.tar.xz" \
  --runtime-modules node_modules \
  --webrtc-runtime build/webrtc-runtime \
  --output-dir "$temporary/standalone" > "$temporary/standalone-build.json"
built=$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).archivePath)' "$temporary/standalone-build.json")
test -f "$built"
test ! -L "$built"
mkdir -p "$(dirname -- "$output")"
mv "$built" "$output"
