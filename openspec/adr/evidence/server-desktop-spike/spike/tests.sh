#!/bin/bash
# Runs as the server account against a running holder. Usage: tests.sh <mode> [full|reverse]
MODE=$1; SCOPE=${2:-full}
STATE=/var/lib/terminay/desktop-spike
S=$STATE/run/rfb.sock
export DISPLAY=:765 XAUTHORITY=$STATE/Xauthority
R() { echo "RESULT [$MODE] $*"; }
XPID=$(pgrep -u "$(id -u)" -x Xtigervnc | head -1)
[ -n "$XPID" ] || { R "start FAIL display server not running: $(tail -3 $STATE/xvnc.log 2>/dev/null | tr '\n' ' ')"; exit 1; }
R "start PASS Xtigervnc pid=$XPID version: $(dpkg-query -W -f='${Version}' tigervnc-standalone-server)"
R "start INFO process state: $(grep -E '^(Seccomp|NoNewPrivs):' /proc/$XPID/status | tr '\n\t' '  ') netns=$(readlink /proc/$XPID/ns/net) self=$(readlink /proc/self/ns/net)"
NS=""; [ "$MODE" = netns ] && NS="sudo nsenter -t $XPID -n"

# (a) no TCP/UDP listener
L=$($NS ss -H -lntup 2>/dev/null)
if echo "$L" | grep -q "pid=$XPID,"; then R "a FAIL listener: $(echo "$L" | grep "pid=$XPID,")"; else R "a PASS no TCP/UDP listener for pid $XPID (all listeners in its netns: $(echo "$L" | wc -l | tr -d ' ') lines: $(echo "$L" | awk '{print $1":"$5}' | tr '\n' ' '))"; fi

# (c) reverse connection
python3 /spike/rev.py 5 > /tmp/rev.out 2>&1 &
sleep 1
VC=$(command -v tigervncconfig || command -v vncconfig)
OUT=$("$VC" -display :765 -connect 127.0.0.1::5599 2>&1 | tr '\n' ' ')
wait
REV=$(cat /tmp/rev.out)
if [ "$MODE" = none ]; then
  [ "$REV" = CONNECTED ] && R "c INFO baseline: reverse connection reached the listener (test detects it) [$OUT]" || R "c FAIL baseline did not connect, test cannot detect: $REV [$OUT]"
else
  [ "$REV" = NONE ] && R "c PASS reverse connection refused [$OUT]" || R "c FAIL reverse connection reached listener: $REV"
fi
xdpyinfo >/dev/null 2>&1 && R "c PASS cookie-holding X client connects" || R "c FAIL cookie-holding X client cannot connect"
python3 /spike/rev.py 3 > /tmp/rev2.out 2>&1 & sleep 1
python3 -c "import socket; socket.create_connection(('127.0.0.1',5599),2)" 2>/dev/null; wait
[ "$(cat /tmp/rev2.out)" = CONNECTED ] && R "c PASS an ordinary program of the account still has network" || R "c FAIL ordinary program has no network"
[ "$SCOPE" = reverse ] && exit 0

# (b) other account refused
if sudo -u other env DISPLAY=:765 xdpyinfo >/dev/null 2>&1; then R "b FAIL other account opened the display"; else R "b PASS other account refused on X display"; fi
if sudo -u other python3 /spike/rfb.py "$S" fullpass >/dev/null 2>&1; then R "b FAIL other account opened RFB socket"; else R "b PASS other account refused on RFB socket ($(stat -c '%a %U' "$S") in $(stat -c '%a' "$(dirname "$S")") dir)"; fi
R "b INFO X sockets: path=$(ls /tmp/.X11-unix/ | tr '\n' ' ') lock=$(ls /tmp/.X765-lock 2>/dev/null) abstract=$($NS ss -H -xl 2>/dev/null | grep -c '@/tmp/.X11-unix/X765')"

# (d) viewer input refused
python3 /spike/rfb.py "$S" fullpass pointer 50 60 0 sleep 0.5 >/dev/null
python3 /spike/rfb.py "$S" viewpass pointer 111 222 0 sleep 0.5 >/dev/null
AFTER_VIEW=$(xdotool getmouselocation 2>/dev/null)
python3 /spike/rfb.py "$S" fullpass pointer 333 444 0 sleep 0.5 >/dev/null
AFTER_CTL=$(xdotool getmouselocation 2>/dev/null)
case "$AFTER_VIEW" in "x:50 y:60"*) V=ok;; *) V=bad;; esac
case "$AFTER_CTL" in "x:333 y:444"*) C=ok;; *) C=bad;; esac
[ $V = ok ] && [ $C = ok ] && R "d PASS viewer pointer refused, controller pointer applied" || R "d FAIL after viewer: $AFTER_VIEW; after controller: $AFTER_CTL"
# (d) clipboard per connection
for who in view full; do for kind in legacy ext; do
  python3 /spike/rfb.py "$S" ${who}pass enc $kind listen 5 $([ $kind = ext ] && echo "request listen 2") > /tmp/clip.$who.$kind 2>&1 &
done; done
sleep 1.5
printf 'spike-secret' | xclip -selection clipboard >/dev/null 2>&1
wait
for who in view full; do for kind in legacy ext; do
  R "d INFO clipboard $who/$kind: $(grep server: /tmp/clip.$who.$kind | sed 's/ *server: //' | tr '\n' ';')"
done; done
if grep -q "spike-secret\|actions=\['provide'\]" /tmp/clip.view.legacy /tmp/clip.view.ext; then R "d FAIL view-only connection RECEIVED clipboard content"; else R "d PASS view-only connection received no clipboard content (legacy and extended, including after an explicit request)"; fi
if grep -q "spike-secret" /tmp/clip.full.legacy && grep -q "actions=\['provide'\]" /tmp/clip.full.ext; then R "d INFO full connection received clipboard content (test detects it)"; else R "d INFO full connection received no clipboard content (test may not detect)"; fi

# (e) held input released on close
KB=$(xinput list | grep -i 'keyboard' | grep -iv 'virtual core' | sed -n 's/.*id=\([0-9]*\).*/\1/p' | head -1)
PT=$(xinput list | grep -i 'pointer' | grep -iv 'virtual core' | sed -n 's/.*id=\([0-9]*\).*/\1/p' | head -1)
state() { { xinput query-state "$KB"; xinput query-state "$PT"; } 2>/dev/null | grep -c '=down'; }
(sleep 2) | python3 /spike/rfb.py "$S" fullpass key ffe1 1 pointer 400 400 1 hold >/dev/null &
sleep 1; DURING=$(state); wait; sleep 0.5; AFTER=$(state)
R "e INFO held key+button during=$DURING, after its connection closed=$AFTER"
# The design's release step: one no-buttons pointer event through a full-rights connection.
python3 /spike/rfb.py "$S" fullpass pointer 400 400 0 sleep 0.3 >/dev/null
FINAL=$(state)
[ "$DURING" -ge 2 ] && [ "$FINAL" = 0 ] && R "e PASS nothing held after close plus the release step (during=$DURING after-close=$AFTER after-release=$FINAL)" || R "e FAIL during=$DURING after-close=$AFTER after-release=$FINAL (devices kb=$KB pt=$PT)"

# (f) resize
python3 /spike/rfb.py "$S" fullpass enc size sleep 0.5 resize 1600 900 sleep 1 >/dev/null
DIM=$(xdpyinfo | awk '/dimensions/{print $2}')
[ "$DIM" = 1600x900 ] && R "f PASS desktop is $DIM" || R "f FAIL desktop is $DIM"
python3 /spike/rfb.py "$S" viewpass enc size sleep 0.5 resize 1024 768 sleep 1 >/dev/null
DIM2=$(xdpyinfo | awk '/dimensions/{print $2}')
R "f INFO after view-only resize request desktop is $DIM2"

# (g) session
MISSING=""; for p in xfwm4 xfce4-panel xfsettingsd xfdesktop dbus-daemon; do pgrep -u "$(id -u)" -x "$p" >/dev/null || MISSING="$MISSING $p"; done
UL=$(ss -H -lntup 2>/dev/null | grep -c "users:")
[ -z "$MISSING" ] && R "g PASS session processes running; TCP/UDP listeners owned by any visible process: $UL" || R "g FAIL missing:$MISSING ($(tail -2 $STATE/session.log 2>/dev/null | tr '\n' ' '))"

# (h) fixture renders and takes input through RFB
rm -f $STATE/typed
xterm -geometry 80x24+100+100 -e bash -c "read x; echo \"\$x\" > $STATE/typed; sleep 600" &
sleep 2
WID=$(xdotool search --class xterm 2>/dev/null | tail -1)
MAP=$(xwininfo -id "$WID" 2>/dev/null | awk -F: '/Map State/{print $2}' | tr -d ' ')
python3 /spike/rfb.py "$S" fullpass pointer 300 250 0 pointer 300 250 1 pointer 300 250 0 sleep 0.5 key 68 1 key 68 0 key 69 1 key 69 0 key ff0d 1 key ff0d 0 sleep 1 >/dev/null
[ "$MAP" = IsViewable ] && [ "$(cat $STATE/typed 2>/dev/null)" = hi ] && R "h PASS xterm viewable and received typed input through RFB" || R "h FAIL map=$MAP typed='$(cat $STATE/typed 2>/dev/null)'"
