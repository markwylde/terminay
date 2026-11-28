#!/bin/sh
# Run the browser acceptance test against a disposable official server image.
# Supply a locally built image with TERMINAY_DESKTOP_E2E_SERVER_IMAGE to reuse it.
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_dir"
container=terminay-desktop-e2e-$(date -u +%Y%m%dT%H%M%SZ)-$$
image=${TERMINAY_DESKTOP_E2E_SERVER_IMAGE:-terminay-server:desktop-e2e}

cleanup() {
  docker rm --force --volumes "$container" >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' HUP TERM

if [ -z "${TERMINAY_DESKTOP_E2E_SERVER_IMAGE:-}" ]; then
  docker build --tag "$image" .
fi
# Finish a cold E2E image build before starting the pairing URL's lifetime.
if [ "${TERMINAY_E2E_IMAGE_IS_PRELOADED:-}" != 1 ]; then
  npm run test:e2e -- e2e/server-desktop-real.spec.ts --list
fi

start_server() {
  docker run --detach --init --name "$container" \
    --env TERMINAY_EXPOSE=off \
    --env TERMINAY_REMOTE_ORIGIN=http://127.0.0.1:8443 \
    --env TERMINAY_PUBLIC_ORIGIN=http://127.0.0.1:8443 \
    --env TERMINAY_WEB_ORIGIN=http://127.0.0.1:43719 \
    "$image" >/dev/null

  pairing_url=
  for attempt in $(seq 1 30); do
    pairing_url=$(docker logs "$container" 2>/dev/null | node -e '
      const lines = require("node:fs").readFileSync(0, "utf8").split("\n");
      for (const line of lines) {
        if (!line.startsWith("{")) continue;
        let result;
        try { result = JSON.parse(line); } catch { continue; }
        if (result.ready === true && typeof result.pairing?.pairingUrl === "string")
          process.stdout.write(result.pairing.pairingUrl);
      }
    ')
    if [ -n "$pairing_url" ]; then break; fi
    sleep 1
  done
  if [ -z "$pairing_url" ]; then
    echo "The standalone server did not publish a pairing URL." >&2
    exit 1
  fi
}

run_case() {
  TERMINAY_E2E_IMAGE_IS_PRELOADED=1 \
  TERMINAY_E2E_NETWORK=container:"$container" \
  TERMINAY_E2E_DESKTOP_PAIRING_URL="$pairing_url" \
  npm run test:e2e -- e2e/server-desktop-real.spec.ts --retries=0 "$@"
}

start_server
run_case "$@" --grep 'two browsers see a real server desktop'
docker rm --force --volumes "$container" >/dev/null
start_server
run_case "$@" --grep 'a recreated server container'
