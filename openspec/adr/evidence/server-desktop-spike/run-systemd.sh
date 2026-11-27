#!/bin/bash
# Usage: run-systemd.sh trixie|bookworm
# Fresh privileged systemd container; runs the whole spike; writes out-<name>-systemd.txt.
D=$(cd "$(dirname "$0")" && pwd)
N=$1
docker rm -f "tds-$N" >/dev/null 2>&1
docker run -d --privileged --name "tds-$N" --tmpfs /run --tmpfs /run/lock "terminay-desktop-spike:$N" >/dev/null || exit 1
sleep 10
timeout 420 docker exec "tds-$N" bash -c '/spike/inside.sh systemd > /root/full.out 2>&1; cat /root/full.out' > "$D/out-$N-systemd.txt" 2>&1
echo "exit=$?"
docker exec "tds-$N" systemctl cat terminay-server > "$D/unit-$N.txt" 2>&1
docker rm -f "tds-$N" >/dev/null
grep -cE "RESULT .* PASS" "$D/out-$N-systemd.txt"
grep -E "FAIL|== |\] (j|e) " "$D/out-$N-systemd.txt" | cut -c1-260
