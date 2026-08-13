#!/bin/sh
set -eu

export DEBIAN_FRONTEND=noninteractive
export TERMINAY_HOSTED_SERVER_REPO=/work/terminay-hosted-service

apt-get update
apt-get install --yes --no-install-recommends ca-certificates file

mkdir -p /work/terminay /work/terminay-hosted-service
tar --directory /source \
  --exclude=.git \
  --exclude=node_modules \
  --exclude=playwright-report \
  --exclude=release \
  --exclude=test-results \
  -cf - . |
  tar --directory /work/terminay -xf -
tar --directory /hosted-source \
  --exclude=.git \
  --exclude=node_modules \
  -cf - . |
  tar --directory /work/terminay-hosted-service -xf -

cd /work/terminay
npm ci --ignore-scripts
npm ci --prefix "$TERMINAY_HOSTED_SERVER_REPO"
npm run build:app
if [ "$TERMINAY_PROOF_RUNTIME" != "secure-werift" ] || [ "$TERMINAY_RUNTIME_ONLY" != "1" ]; then
  npx playwright install --with-deps --only-shell chromium
fi
env -u DISPLAY -u WAYLAND_DISPLAY node scripts/support/webrtc-linux-proof-preflight.mjs
case "$TERMINAY_PROOF_RUNTIME" in
  node-datachannel)
    env -u DISPLAY -u WAYLAND_DISPLAY npm run test:spike-production-headless-webrtc
    ;;
  secure-werift)
    env -u DISPLAY -u WAYLAND_DISPLAY \
      node --test scripts/production-headless-webrtc-secure-werift.test.mjs
    ;;
esac
