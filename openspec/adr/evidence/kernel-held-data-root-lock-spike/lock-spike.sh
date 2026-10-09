#!/bin/sh
# Two containers of the official image on one named volume; does a lock held
# through node:sqlite refuse the second, survive a pause, and die with SIGKILL?
set -u
IMG=markwylde/terminay:5.15.0-beta.54
N=/opt/terminay/bin/node
try() {
	docker run --rm -v lockspike:/data -v /tmp/lock-spike.mjs:/s.mjs:ro --entrypoint $N $IMG /s.mjs /data try
	echo "exit=$?"
}
docker volume create lockspike >/dev/null
docker run --rm --user 0 -v lockspike:/data --entrypoint chown $IMG terminay /data
echo "node $(docker run --rm --entrypoint $N $IMG -v)"
echo "== 1 holder up"
docker run -d --name spikehold -v lockspike:/data -v /tmp/lock-spike.mjs:/s.mjs:ro --entrypoint $N $IMG /s.mjs /data hold >/dev/null
sleep 2
docker logs spikehold
echo "== 2 second container while held"
try
echo "== 3 second container while holder is paused"
docker pause spikehold >/dev/null
try
docker unpause spikehold >/dev/null
echo "== 4 after docker kill (SIGKILL)"
docker kill spikehold >/dev/null
sleep 1
try
echo "== files left"
docker run --rm -v lockspike:/data --entrypoint ls $IMG -la /data
docker rm -f spikehold >/dev/null
docker volume rm lockspike >/dev/null
docker info --format 'docker {{.ServerVersion}} driver={{.Driver}} kernel={{.KernelVersion}}'
docker ps --filter name=terminay --format '{{.Names}} {{.Status}}'
