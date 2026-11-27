#!/usr/bin/env python3
"""Listen on 127.0.0.1:5599 for N seconds; print CONNECTED or NONE."""
import socket
import sys

s = socket.socket()
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(("127.0.0.1", 5599))
s.listen(1)
s.settimeout(float(sys.argv[1]))
try:
    s.accept()
    print("CONNECTED")
except socket.timeout:
    print("NONE")
