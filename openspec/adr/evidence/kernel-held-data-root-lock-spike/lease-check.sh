#!/bin/sh
# The built FileDataRootLease in two containers of the official image on one
# named volume. Expects /tmp/dataRootLease.js and /tmp/lease-check.mjs.
set -u
IMG=markwylde/terminay:5.15.0-beta.54
N=/opt/terminay/bin/node
MOUNTS="-v leasecheck:/data -v /tmp/dataRootLease.js:/l/dataRootLease.js:ro -v /tmp/lease-check.mjs:/l/check.mjs:ro"
try() {
	docker run --rm -e TERMINAY_MANAGED_BY=container $MOUNTS --entrypoint $N $IMG /l/check.mjs /data try
	echo "exit=$?"
}
docker volume create leasecheck >/dev/null
docker run --rm --user 0 -v leasecheck:/data --entrypoint chown $IMG terminay /data
echo "== 1 holder up"
docker run -d --name leasehold $MOUNTS --entrypoint $N $IMG /l/check.mjs /data hold >/dev/null
sleep 2
docker logs leasehold
echo "== 2 second container while held"
try
echo "== 3 second container while holder is paused"
docker pause leasehold >/dev/null
try
docker unpause leasehold >/dev/null
echo "== 4 after docker kill (SIGKILL)"
docker kill leasehold >/dev/null
sleep 1
docker run --rm -v leasecheck:/data --entrypoint ls $IMG -la /data
try
echo "== files after a clean release"
docker run --rm -v leasecheck:/data --entrypoint ls $IMG -la /data
docker rm -f leasehold >/dev/null
docker volume rm leasecheck >/dev/null
