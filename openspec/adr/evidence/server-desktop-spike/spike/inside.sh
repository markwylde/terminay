#!/bin/bash
# Runs as root inside the container. Usage: inside.sh systemd|plain|image
KIND=$1
PKGS="tigervnc-standalone-server tigervnc-tools xfwm4 xfce4-panel xfce4-settings xfce4-terminal xfdesktop4 x11-xserver-utils dbus-x11 xauth fonts-dejavu-core fonts-noto-color-emoji adwaita-icon-theme"
echo "== os: $(. /etc/os-release; echo "$PRETTY_NAME") kind=$KIND kernel=$(uname -r)"
if [ "$KIND" = systemd ]; then
  for _ in $(seq 1 60); do systemctl is-system-running 2>/dev/null | grep -qE "running|degraded" && break; sleep 1; done
  systemctl list-unit-files --state=enabled --no-legend | awk '{print $1}' | sort > /tmp/enabled.before
  systemctl list-units --type=service,socket --state=running,listening --no-legend | awk '{print $1}' | sort > /tmp/running.before
fi
ss -H -lntup | sort > /tmp/listen.before
apt-get update -qq >/dev/null 2>&1
if apt-get install -y -qq --no-install-recommends $PKGS >/tmp/apt.log 2>&1; then echo "RESULT [install] j INFO package set installed ($(grep -c '^Setting up' /tmp/apt.log) packages configured)"; else echo "RESULT [install] j FAIL apt: $(tail -3 /tmp/apt.log | tr '\n' ' ')"; exit 1; fi
if [ "$KIND" = systemd ]; then
  sleep 3
  systemctl list-unit-files --state=enabled --no-legend | awk '{print $1}' | sort > /tmp/enabled.after
  systemctl list-units --type=service,socket --state=running,listening --no-legend | awk '{print $1}' | sort > /tmp/running.after
  NEWE=$(comm -13 /tmp/enabled.before /tmp/enabled.after | tr '\n' ' ')
  NEWR=$(comm -13 /tmp/running.before /tmp/running.after | tr '\n' ' ')
  [ -z "$NEWE$NEWR" ] && echo "RESULT [install] j PASS no unit newly enabled or running" || echo "RESULT [install] j FAIL newly enabled: [$NEWE] newly running: [$NEWR]"
else
  echo "RESULT [install] j INFO no systemd in this configuration; checked listeners only"
fi
ss -H -lntup | sort > /tmp/listen.after
NEWL=$(comm -13 /tmp/listen.before /tmp/listen.after | tr '\n' ' ')
[ -z "$NEWL" ] && echo "RESULT [install] j PASS no new TCP/UDP listener after install" || echo "RESULT [install] j FAIL new listeners: $NEWL"

STATE=/var/lib/terminay/desktop-spike
reset() {
  [ "$KIND" = systemd ] && systemctl stop terminay-server 2>/dev/null
  if [ "$KIND" = image ]; then
    # The real server and entrypoint run as this account; end only the desktop.
    for n in holder.sh Xtigervnc xfwm4 xfce4-panel xfdesktop xfsettingsd xterm dbus-run-session; do pkill -9 -u terminay -f "$n" 2>/dev/null; done; sleep 1
  else
    pkill -u terminay 2>/dev/null; sleep 1; pkill -9 -u terminay 2>/dev/null
  fi
  rm -rf /tmp/.X11-unix/X765 /tmp/.X765-lock "$STATE"
  sudo -u terminay mkdir -p "$STATE"; echo "$1" | sudo -u terminay tee "$STATE/mode" >/dev/null
}
start() {
  if [ "$KIND" = systemd ]; then systemctl start terminay-server; else sudo -u terminay bash -c 'setsid nohup /spike/holder.sh >/dev/null 2>&1 &'; fi
  for _ in $(seq 1 40); do [ -S /tmp/.X11-unix/X765 ] && break; sleep 0.25; done; sleep 4
}
if [ "$KIND" = systemd ]; then
  # The unit is the installer's own rendering, byte for byte. Only what it
  # names is a stand-in: an empty environment file and a script at ExecStart.
  cp /spike/terminay-server.service /etc/systemd/system/terminay-server.service
  mkdir -p /etc/terminay /opt/terminay/current/bin
  : > /etc/terminay/server.env
  cp /spike/fake-server.sh /opt/terminay/current/bin/terminay-server
  chmod 755 /opt/terminay/current/bin/terminay-server
  systemctl daemon-reload
fi
for MODE in none netns seccomp; do
  reset $MODE; start
  if [ "$MODE" = none ]; then SCOPE=reverse; else SCOPE=full; fi
  sudo -u terminay /spike/tests.sh $MODE $SCOPE
  if [ "$KIND" = systemd ] && [ "$MODE" != none ]; then
    P1=$(pgrep -u terminay -x Xtigervnc | head -1); T1=$(pgrep -u terminay -x xterm | head -1); W1=$(pgrep -u terminay -x xfwm4 | head -1)
    systemctl restart terminay-server; sleep 3
    P2=$(pgrep -u terminay -x Xtigervnc | head -1); T2=$(pgrep -u terminay -x xterm | head -1); W2=$(pgrep -u terminay -x xfwm4 | head -1)
    N=$(pgrep -u terminay -x Xtigervnc | wc -l)
    if [ -n "$P1" ] && [ "$P1" = "$P2" ] && [ "$T1" = "$T2" ] && [ "$W1" = "$W2" ] && [ "$N" = 1 ] && [ -S /tmp/.X11-unix/X765 ] && [ -e /tmp/.X765-lock ] && sudo -u terminay env DISPLAY=:765 XAUTHORITY=$STATE/Xauthority xdpyinfo >/dev/null 2>&1; then
      echo "RESULT [$MODE] i PASS after unit restart: same display pid $P2, same xterm $T2, same xfwm4 $W2, one display, socket and lock present, display answers"
    else
      echo "RESULT [$MODE] i FAIL display $P1->$P2 xterm $T1->$T2 xfwm4 $W1->$W2 count=$N socket=$(ls /tmp/.X11-unix 2>/dev/null) lock=$(ls /tmp/.X765-lock 2>/dev/null)"
    fi
  elif [ "$KIND" = image ] && [ "$MODE" = seccomp ]; then
    # The image's own restart path: the marker the entrypoint consumes, then
    # the real server is ended and the entrypoint starts it again.
    R=/var/lib/terminay/releases
    S1=$(cat $R/server.pid); P1=$(pgrep -u terminay -x Xtigervnc | head -1); T1=$(pgrep -u terminay -x xterm | head -1); W1=$(pgrep -u terminay -x xfwm4 | head -1)
    sudo -u terminay touch $R/restart-requested
    kill -TERM "$S1"
    for _ in $(seq 1 40); do S2=$(cat $R/server.pid 2>/dev/null); [ -n "$S2" ] && [ "$S2" != "$S1" ] && break; sleep 0.5; done
    sleep 3
    P2=$(pgrep -u terminay -x Xtigervnc | head -1); T2=$(pgrep -u terminay -x xterm | head -1); W2=$(pgrep -u terminay -x xfwm4 | head -1)
    if [ -n "$S2" ] && [ "$S2" != "$S1" ] && kill -0 "$S2" 2>/dev/null && [ -n "$P1" ] && [ "$P1" = "$P2" ] && [ "$T1" = "$T2" ] && [ "$W1" = "$W2" ] && sudo -u terminay env DISPLAY=:765 XAUTHORITY=$STATE/Xauthority xdpyinfo >/dev/null 2>&1; then
      echo "RESULT [$MODE] i PASS after the entrypoint restarted the real server (pid $S1 -> $S2): same display pid $P2, same xterm $T2, same xfwm4 $W2, display answers"
    else
      echo "RESULT [$MODE] i FAIL server $S1->$S2 display $P1->$P2 xterm $T1->$T2 xfwm4 $W1->$W2"
    fi
  elif [ "$MODE" != none ]; then
    echo "RESULT [$MODE] i INFO no service unit in this configuration"
  fi
done
reset none
echo "== done"
