#!/bin/bash
# Which held input survives a closed connection, and what releases it?
S=/var/lib/terminay/desktop-spike
export DISPLAY=:765 XAUTHORITY=$S/Xauthority
R=$S/run/rfb.sock
KB=$(xinput list | grep -i 'keyboard' | grep -iv 'virtual core' | sed -n 's/.*id=\([0-9]*\).*/\1/p' | head -1)
PT=$(xinput list | grep -i 'pointer' | grep -iv 'virtual core' | sed -n 's/.*id=\([0-9]*\).*/\1/p' | head -1)
st() { { xinput query-state "$KB"; xinput query-state "$PT"; } 2>/dev/null | grep '=down' | tr '\n' ' '; }
(sleep 2) | python3 /spike/rfb.py $R fullpass key ffe1 1 pointer 400 400 1 hold >/dev/null &
sleep 1; echo "HELD during: [$(st)]"; wait; sleep 0.5; echo "HELD after close: [$(st)]"
python3 /spike/rfb.py $R viewpass pointer 400 400 0 sleep 0.3 >/dev/null; echo "HELD after view-only mask 0: [$(st)]"
python3 /spike/rfb.py $R fullpass pointer 400 400 0 sleep 0.3 >/dev/null; echo "HELD after new full connection mask 0: [$(st)]"
(sleep 2) | python3 /spike/rfb.py $R fullpass key ffe1 1 hold >/dev/null &
sleep 1; echo "HELD key only during: [$(st)]"; wait; sleep 0.5; echo "HELD key only after close: [$(st)]"
(sleep 2) | python3 /spike/rfb.py $R fullpass pointer 400 400 1 hold >/dev/null &
sleep 1; echo "HELD button only during: [$(st)]"; wait; sleep 0.5; echo "HELD button only after close: [$(st)]"
python3 /spike/rfb.py $R fullpass pointer 400 400 0 sleep 0.3 >/dev/null; echo "HELD after cleanup mask 0: [$(st)]"
