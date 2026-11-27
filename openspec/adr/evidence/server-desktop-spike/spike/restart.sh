#!/bin/bash
# Root: restart the holder in the given mode (systemd configuration).
S=/var/lib/terminay/desktop-spike
systemctl stop terminay-server 2>/dev/null
pkill -u terminay 2>/dev/null; sleep 1; pkill -9 -u terminay 2>/dev/null
rm -rf /tmp/.X11-unix/X765 /tmp/.X765-lock "$S"
sudo -u terminay mkdir -p "$S"
echo "$1" | sudo -u terminay tee "$S/mode" >/dev/null
systemctl start terminay-server
for _ in $(seq 1 40); do [ -S /tmp/.X11-unix/X765 ] && break; sleep 0.25; done
sleep 4
