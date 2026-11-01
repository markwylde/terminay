#!/usr/bin/env python3
"""Gate item 7 alternative: reach the desktop through an `exec -i` stdio tunnel to the
container's own loopback, so no port is published. Measures handshake and throughput.

Usage: spike_exec_tunnel.py <engine> <bot-container>
"""
import json, subprocess, sys, time

ENGINE, BOT = sys.argv[1:3]
RELAY = r'''
import os, socket, sys, threading
s = socket.create_connection(("127.0.0.1", 5901))
def up():
    while True:
        b = os.read(0, 65536)
        if not b:
            s.shutdown(socket.SHUT_WR); return
        s.sendall(b)
threading.Thread(target=up, daemon=True).start()
while True:
    b = s.recv(65536)
    if not b:
        break
    os.write(1, b)
'''

t0 = time.monotonic()
p = subprocess.Popen([ENGINE, "exec", "-i", "-u", "root", BOT, "python3", "-c", RELAY],
                     stdin=subprocess.PIPE, stdout=subprocess.PIPE)
banner = p.stdout.read(12)
t_banner = time.monotonic() - t0
p.stdin.write(b"RFB 003.008\n"); p.stdin.flush()
n = p.stdout.read(1)[0]
types = list(p.stdout.read(n))
p.stdin.close()
p.kill()
print(json.dumps({"banner": banner.decode().strip(), "security_types": types,
                  "seconds_to_banner": round(t_banner, 2)}, indent=1))
