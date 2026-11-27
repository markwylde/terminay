#!/bin/bash
# The official image, started with its own entrypoint and default confinement.
D=$(cd "$(dirname "$0")" && pwd)
docker rm -f tds-image >/dev/null 2>&1
docker run -d --name tds-image terminay-server:desktop-spike >/dev/null || exit 1
sleep 15
docker cp "$D/spike" tds-image:/spike
{
  echo "== image: terminay-server built from this worktree's Dockerfile; entrypoint: $(docker inspect -f '{{json .Config.Entrypoint}}' tds-image); user: $(docker exec tds-image id)"
  echo "== confinement: privileged=$(docker inspect -f '{{.HostConfig.Privileged}}' tds-image) seccomp(pid1)=$(docker exec tds-image grep Seccomp: /proc/1/status | tr '\t' ' ')"
} > "$D/out-image.txt"
# Test tooling only; installed before the measured install of the desktop package set.
timeout 300 docker exec -u root -e DEBIAN_FRONTEND=noninteractive tds-image bash -c 'apt-get update -qq >/dev/null 2>&1 && apt-get install -y -qq --no-install-recommends procps iproute2 util-linux python3 python3-pycryptodome python3-seccomp xdotool xinput xclip x11-utils xterm x11-apps >/dev/null 2>&1; echo tools=$?; useradd -m -s /bin/bash other; chmod -R a+rX /spike; chmod 755 /spike/*'
echo "== main processes: $(docker exec tds-image ps -o pid,user,args -e 2>/dev/null | head -6 | tr '\n' ';' | cut -c1-400)" >> "$D/out-image.txt"
timeout 420 docker exec -u root -e DEBIAN_FRONTEND=noninteractive tds-image bash -c '/spike/inside.sh image > /root/full.out 2>&1; cat /root/full.out' >> "$D/out-image.txt" 2>&1
echo "exit=$?"
echo "== server after the run: $(docker inspect -f '{{.State.Status}} {{.State.Health.Status}}' tds-image)" >> "$D/out-image.txt"
docker rm -f tds-image >/dev/null
grep -cE "RESULT .* PASS" "$D/out-image.txt"
grep -E "FAIL|== |start |\] (j|e|i) " "$D/out-image.txt" | cut -c1-330
