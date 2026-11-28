#!/bin/bash
# Stand-in for the server's main process: starts the holder detached if no
# display server of this account is running, then stays up.
if ! pgrep -u "$(id -u)" -x Xtigervnc >/dev/null; then
  setsid nohup /spike/holder.sh >/dev/null 2>&1 &
fi
exec sleep infinity
