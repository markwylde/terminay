#!/bin/sh
set -eu

target=${1:-}
case "$target" in
  linux-x64|linux-arm64) ;;
  *)
    echo "Usage: $0 <linux-x64|linux-arm64>" >&2
    exit 64
    ;;
esac

temporary=$(mktemp -d "${TMPDIR:-/tmp}/terminay-packaged-built-ins.XXXXXX")
cleanup() {
  rm -rf "$temporary"
}
trap cleanup EXIT HUP INT TERM

if [ "$target" = linux-x64 ]; then
  npm run build:app
  attempt=0
  until CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --dir --linux --x64 --publish never; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 3 ]; then
      exit 1
    fi
    sleep $((attempt * 8))
  done
else
  # A clean arm64 runner has no compiled workspace declarations. Build the
  # server dependency graph before staging its packaged extension payload.
  npm run build:application-graph
  npm run build:server-postcompile
fi

npm pack --workspace @terminay/server --json --pack-destination "$temporary" > "$temporary/pack.json"
archive_name=$(node scripts/npm-pack-result.mjs "$temporary/pack.json")
archive="$temporary/$archive_name"
test -f "$archive"
mkdir "$temporary/extracted"
tar -xzf "$archive" -C "$temporary/extracted"
standalone="$temporary/extracted/package/dist/built-in-extensions"
test -f "$standalone/inventory.v1.json"

if [ "$target" = linux-x64 ]; then
  electron='release/0.0.0/linux-unpacked/resources/built-in-extensions'
  test -f "$electron/inventory.v1.json"
  TERMINAY_ELECTRON_BUILT_INS="$electron" \
    TERMINAY_STANDALONE_BUILT_INS="$standalone" \
    npm run test:packaged-built-in-extension-runtime
else
  TERMINAY_PACKAGED_LIFECYCLE_TARGET=standalone \
    TERMINAY_STANDALONE_BUILT_INS="$standalone" \
    npm run test:packaged-built-in-extension-runtime
fi
