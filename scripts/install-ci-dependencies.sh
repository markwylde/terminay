#!/bin/sh
# Linux PR jobs mount this daemon-owned cache; npm still verifies every tarball
# against the lockfile. Only derived downloads are shared, never node_modules.
set -eu
export npm_config_cache=${npm_config_cache:-/var/cache/terminay-npm}
mkdir -p "$npm_config_cache"
if [ "$(npm --version)" != '12.2.1' ]; then
  timeout --signal=TERM --kill-after=10s 60s npm install --global npm@12.2.1 \
    --prefer-offline --no-audit --no-fund --loglevel=http \
    --fetch-timeout=30000 --fetch-retries=1
fi
# npm ci's opportunistic advisory lookup does not affect its exit status.
# Avoid that extra request; required security and boundary tests stay unchanged.
# Keep lifecycle scripts visible: native compilation and downloads must report
# progress rather than consume the whole CI timeout without output.
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
header_prefix=$(node "$script_dir/node-build-header-prefix.mjs")
set -- timeout --signal=TERM --kill-after=10s 180s npm ci \
  --prefer-offline --foreground-scripts --timing --loglevel=http \
  --fetch-timeout=30000 --fetch-retries=1 --no-audit --no-fund
if [ -n "$header_prefix" ]; then
  echo "Using verified Node headers for $(node --version)"
  env npm_config_nodedir="$header_prefix" "$@"
else
  echo "Matching local Node headers unavailable; node-gyp will fetch its pinned headers"
  "$@"
fi
