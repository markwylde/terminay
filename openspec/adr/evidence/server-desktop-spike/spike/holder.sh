#!/bin/bash
# Stand-in for the desktop holder: starts the display server (optionally with
# network access denied) and a minimal XFCE session, then waits.
# MODE: none | netns | seccomp   (read from $STATE/mode)
set -u
STATE=/var/lib/terminay/desktop-spike
RUN=$STATE/run
mkdir -p "$RUN"; chmod 700 "$STATE" "$RUN"
MODE=$(cat "$STATE/mode" 2>/dev/null || echo none)
N=765
COOKIE=$STATE/Xauthority
PW=$STATE/passwd
if [ ! -s "$COOKIE" ]; then
  (umask 077; : > "$COOKIE"; xauth -f "$COOKIE" add ":$N" . "$(head -c16 /dev/urandom | od -An -tx1 | tr -d ' \n')" 2>/dev/null)
fi
if [ ! -s "$PW" ]; then
  (umask 077; printf 'fullpass\nviewpass\n' | vncpasswd -f > "$PW")
fi
XVNC=$(command -v Xtigervnc || command -v Xvnc)
ARGS=(":$N" -rfbport -1 -rfbunixpath "$RUN/rfb.sock" -rfbunixmode 0600 -nolisten tcp
      -auth "$COOKIE" -SecurityTypes VncAuth -PasswordFile "$PW"
      -geometry 1280x800 -depth 24 -AlwaysShared -SendPrimary=0 -MaxCutText=1048576)
case "$MODE" in
  none)    "$XVNC" "${ARGS[@]}" >"$STATE/xvnc.log" 2>&1 & ;;
  netns)   unshare -rn "$XVNC" "${ARGS[@]}" >"$STATE/xvnc.log" 2>&1 & ;;
  seccomp) python3 /spike/noip.py "$XVNC" "${ARGS[@]}" >"$STATE/xvnc.log" 2>&1 & ;;
esac
echo $! > "$STATE/launcher.pid"
for _ in $(seq 1 50); do [ -S "/tmp/.X11-unix/X$N" ] && break; sleep 0.2; done
export DISPLAY=":$N" XAUTHORITY="$COOKIE"
export XDG_RUNTIME_DIR="$RUN/xdg" XDG_CONFIG_HOME="$STATE/config" XDG_CACHE_HOME="$STATE/cache" XDG_CURRENT_DESKTOP=XFCE
mkdir -p "$XDG_RUNTIME_DIR" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME"; chmod 700 "$XDG_RUNTIME_DIR"
if [ "${SESSION:-1}" = 1 ] && command -v xfwm4 >/dev/null; then
  dbus-run-session -- bash -c 'xfsettingsd --no-daemon & xfwm4 & xfce4-panel & xfdesktop & wait' >"$STATE/session.log" 2>&1 &
  echo $! > "$STATE/session.pid"
fi
wait
