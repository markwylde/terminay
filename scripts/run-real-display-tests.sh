#!/bin/sh
# Run the tests that need a real display server, in a container, once per
# Debian release (or only the releases named as arguments). The repository is
# mounted read-only, so build the workspaces first:
#
#   npx turbo run build --filter=@terminay/server-core...
#   sh scripts/run-real-display-tests.sh            # bookworm and trixie
#   sh scripts/run-real-display-tests.sh trixie
#
# Nothing is installed on the machine that runs this.
set -eu

if ! docker info >/dev/null 2>&1; then
  echo "The Docker service is not available." >&2
  exit 69
fi

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
releases=${*:-bookworm trixie}
hub=${DOCKER_HUB:-docker.io/library}
status=0

for release in $releases; do
  image=terminay-real-display:$release
  # The Dockerfile copies nothing in, so it is built without a context.
  docker build --quiet \
    --build-arg "DOCKER_HUB=$hub" \
    --build-arg "DEBIAN_RELEASE=$release" \
    --tag "$image" \
    - < "$repo_dir/Dockerfile.real-display" >/dev/null
  echo "== real display tests on Debian $release"
  # A fifteen-minute bound: a stalled display server fails the run instead
  # of holding it.
  # The tests run as an account with the caller's ids, so the read-only
  # checkout is readable whatever its mode, and the account is a real one:
  # a session bus refuses to start for a uid with no passwd entry.
  if ! timeout 900 docker run --rm --init \
    --env "RUN_UID=$(id -u)" \
    --env "RUN_GID=$(id -g)" \
    --volume "$repo_dir:/workspace:ro" \
    --tmpfs /tmp:exec,mode=1777 \
    "$image" \
    sh -c 'set -eu
      if [ "$RUN_UID" != 0 ]; then
        groupadd --non-unique --gid "$RUN_GID" runner
        useradd --non-unique --uid "$RUN_UID" --gid "$RUN_GID" --create-home runner
        exec setpriv --reuid "$RUN_UID" --regid "$RUN_GID" --init-groups \
          env HOME=/home/runner USER=runner sh -c "$0"
      fi
      exec sh -c "$0"' \
      'node --test --test-force-exit --test-timeout=120000 --test-concurrency=1 \
        packages/remote-desktop/test/real/*.test.mjs \
        packages/server-core/test/real-display/*.test.mjs \
        apps/terminay-server/test/real-display/*.test.mjs'; then
    status=1
  fi
done
exit "$status"
