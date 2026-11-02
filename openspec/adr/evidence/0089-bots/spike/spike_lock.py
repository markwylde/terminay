#!/usr/bin/env python3
"""Gate item 1: do advisory locks taken on the host exclude locks taken inside a bot container
on the same file through the engine's file sharing, and the other way round?

Usage (host side): spike_lock.py <engine> <container> <host-dir> <container-dir>
The container must bind-mount <host-dir> at <container-dir>. Runs flock(2) and fcntl(F_SETLK)
both ways and between two containers' views when a second container is given via SPIKE_LOCK_C2.
"""
import fcntl, json, os, subprocess, sys, time

PROBE = r'''
import fcntl, sys
kind, path = sys.argv[1], sys.argv[2]
f = open(path, "a")
try:
    if kind == "flock":
        fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
    else:
        fcntl.lockf(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
    print("acquired")
except OSError as e:
    print("blocked", e.errno)
'''

HOLD = r'''
import fcntl, sys, time
kind, path = sys.argv[1], sys.argv[2]
f = open(path, "a")
(fcntl.flock(f, fcntl.LOCK_EX) if kind == "flock" else fcntl.lockf(f, fcntl.LOCK_EX))
print("held", flush=True)
time.sleep(4)
'''


def in_ctr(engine, c, script, *args, bg=False):
    argv = [engine, "exec", "-i", "-u", "bot", c, "python3", "-c", script, *args]
    if bg:
        return subprocess.Popen(argv, stdout=subprocess.PIPE, text=True)
    return subprocess.run(argv, capture_output=True, text=True).stdout.strip()


def host_probe(kind, path):
    return subprocess.run([sys.executable, "-I", "-c", PROBE, kind, path], capture_output=True, text=True).stdout.strip()


def main():
    engine, c, hdir, cdir = sys.argv[1:5]
    c2 = os.environ.get("SPIKE_LOCK_C2")
    name = "auth.json.lock"
    hp, cp = os.path.join(hdir, name), os.path.join(cdir, name)
    open(hp, "a").close()
    out = {}
    for kind in ("flock", "fcntl"):
        # host holds, container probes
        h = subprocess.Popen([sys.executable, "-I", "-c", HOLD, kind, hp], stdout=subprocess.PIPE, text=True)
        h.stdout.readline()
        out[f"{kind}: host holds, container probes"] = in_ctr(engine, c, PROBE, kind, cp)
        if c2:
            out[f"{kind}: host holds, container 2 probes"] = in_ctr(engine, c2, PROBE, kind, cp)
        h.kill(); h.wait()
        # container holds, host probes
        p = in_ctr(engine, c, HOLD, kind, cp, bg=True)
        p.stdout.readline()
        out[f"{kind}: container holds, host probes"] = host_probe(kind, hp)
        if c2:
            out[f"{kind}: container holds, container 2 probes"] = in_ctr(engine, c2, PROBE, kind, cp)
        p.kill(); p.wait()
        time.sleep(4.5)
        # same-container sanity check
        p = in_ctr(engine, c, HOLD, kind, cp, bg=True)
        p.stdout.readline()
        out[f"{kind}: container holds, same container probes (control)"] = in_ctr(engine, c, PROBE, kind, cp)
        p.kill(); p.wait()
        time.sleep(4.5)
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
