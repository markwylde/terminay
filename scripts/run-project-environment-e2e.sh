#!/bin/sh
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ssh_repo=${TERMINAY_SSH_PLUGIN_REPO:-}
puzed_repo=${TERMINAY_PUZED_PLUGIN_REPO:-}

if [ -z "$ssh_repo" ] && [ -z "$puzed_repo" ]; then
  echo "Skipping external project-environment preflight; set both TERMINAY_SSH_PLUGIN_REPO and TERMINAY_PUZED_PLUGIN_REPO to stage official plugin checkouts."
  exit 0
fi
if [ -z "$ssh_repo" ] || [ -z "$puzed_repo" ] || [ ! -f "$ssh_repo/package.json" ] || [ ! -f "$puzed_repo/package.json" ]; then
  echo "Both official plugin checkout paths must be valid when project-environment preflight is enabled." >&2
  exit 69
fi

(cd "$ssh_repo" && npm run compile && node --test test/e2e/ssh-docker.test.mjs)
TERMINAY_SSH_PLUGIN_REPO="$ssh_repo" \
TERMINAY_PUZED_PLUGIN_REPO="$puzed_repo" \
npm run test:e2e:puzed-ssh
