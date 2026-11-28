#!/usr/bin/env python3
"""Minimal RFB client for the spike. Usage: rfb.py <socket> <password> <command...>

Commands (run in order on one connection):
  pointer X Y MASK     send a PointerEvent
  key SYM DOWN         send a KeyEvent (SYM hex keysym, DOWN 0/1)
  enc legacy|ext|size  SetEncodings: Raw only | Raw+ExtendedClipboard | Raw+ExtendedDesktopSize
  resize W H           SetDesktopSize, one screen
  request              (ext clipboard) ask the server for text
  listen SECS          read and describe every server message for SECS seconds
  sleep SECS
  hold                 keep the connection open until stdin closes
"""
import socket
import struct
import sys
import time

try:
    from Cryptodome.Cipher import DES
except ImportError:
    from Crypto.Cipher import DES

EXT_CLIP = -1063131698
EXT_SIZE = -308


def rev(b):
    return int(f"{b:08b}"[::-1], 2)


def recvn(s, n):
    buf = b""
    while len(buf) < n:
        chunk = s.recv(n - len(buf))
        if not chunk:
            raise EOFError("closed")
        buf += chunk
    return buf


def connect(path, password):
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.connect(path)
    ver = recvn(s, 12)
    s.sendall(b"RFB 003.008\n")
    n = recvn(s, 1)[0]
    types = recvn(s, n)
    if 2 not in types:
        raise SystemExit(f"no VncAuth offered: {list(types)} (server {ver!r})")
    s.sendall(b"\x02")
    challenge = recvn(s, 16)
    key = bytes(rev(b) for b in password.encode().ljust(8, b"\0")[:8])
    s.sendall(DES.new(key, DES.MODE_ECB).encrypt(challenge))
    (result,) = struct.unpack(">I", recvn(s, 4))
    if result != 0:
        raise SystemExit("AUTH FAILED")
    s.sendall(b"\x01")
    w, h = struct.unpack(">HH", recvn(s, 4))
    recvn(s, 16)
    (namelen,) = struct.unpack(">I", recvn(s, 4))
    recvn(s, namelen)
    print(f"connected {w}x{h}", flush=True)
    return s


def listen(s, secs):
    s.settimeout(0.3)
    end = time.time() + secs
    got = []
    while time.time() < end:
        try:
            t = s.recv(1)
        except socket.timeout:
            continue
        if not t:
            got.append("CLOSED")
            break
        t = t[0]
        s.settimeout(2)
        if t == 3:
            recvn(s, 3)
            (length,) = struct.unpack(">i", recvn(s, 4))
            if length >= 0:
                data = recvn(s, length)
                got.append(f"ServerCutText legacy len={length} data={data[:40]!r}")
            else:
                body = recvn(s, -length)
                (flags,) = struct.unpack(">I", body[:4])
                names = [n for bit, n in ((24, "caps"), (25, "request"), (26, "peek"), (27, "notify"), (28, "provide")) if flags & (1 << bit)]
                got.append(f"ServerCutText ext actions={names} formats=0x{flags & 0xffff:x} bytes={len(body) - 4}")
        elif t == 2:
            got.append("Bell")
        elif t == 0:
            recvn(s, 1)
            (nrects,) = struct.unpack(">H", recvn(s, 2))
            got.append(f"FramebufferUpdate rects={nrects} (not parsed; stopping)")
            break
        else:
            got.append(f"type {t} (not parsed; stopping)")
            break
        s.settimeout(0.3)
    for g in got:
        print("  server:", g)
    if not got:
        print("  server: (nothing)")
    sys.stdout.flush()


def main():
    path, password, *cmds = sys.argv[1:]
    s = connect(path, password)
    i = 0
    while i < len(cmds):
        c = cmds[i]
        if c == "pointer":
            x, y, mask = int(cmds[i + 1]), int(cmds[i + 2]), int(cmds[i + 3])
            s.sendall(struct.pack(">BBHH", 5, mask, x, y)); i += 4
        elif c == "key":
            sym, down = int(cmds[i + 1], 16), int(cmds[i + 2])
            s.sendall(struct.pack(">BBHI", 4, down, 0, sym)); i += 3
        elif c == "enc":
            kind = cmds[i + 1]
            encs = [0] + ([EXT_CLIP] if kind == "ext" else []) + ([EXT_SIZE] if kind == "size" else [])
            s.sendall(struct.pack(">BBH", 2, 0, len(encs)) + b"".join(struct.pack(">i", e) for e in encs)); i += 2
        elif c == "resize":
            w, h = int(cmds[i + 1]), int(cmds[i + 2])
            s.sendall(struct.pack(">BBHHBB", 251, 0, w, h, 1, 0) + struct.pack(">IHHHHI", 1, 0, 0, w, h, 0)); i += 3
        elif c == "request":
            s.sendall(struct.pack(">BBBBi", 6, 0, 0, 0, -4) + struct.pack(">I", (1 << 25) | 1)); i += 1
        elif c == "listen":
            listen(s, float(cmds[i + 1])); i += 2
        elif c == "sleep":
            time.sleep(float(cmds[i + 1])); i += 2
        elif c == "hold":
            sys.stdin.read(); i += 1
        else:
            raise SystemExit(f"unknown command {c}")
    s.close()


main()
