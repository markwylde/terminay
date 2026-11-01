#!/usr/bin/env python3
"""Gate item 6: the terminay-files helper refuses link escapes (including links swapped in
mid-operation), protects declared paths, writes as `bot`, and runs with its limits.

Usage: spike_files.py <engine> <image> <bot-container> <home-volume>
The bot container plants links and runs the swapper; the helper mounts the same volume.
"""
import base64, json, subprocess, sys, threading, time, queue

ENGINE, IMAGE, BOT, VOL = sys.argv[1:5]
HELPER = "tb-files-helper"


def bot_sh(script):
    return subprocess.run([ENGINE, "exec", "-u", "bot", BOT, "sh", "-c", script], capture_output=True, text=True)


class Helper:
    def __init__(self):
        subprocess.run([ENGINE, "rm", "-f", HELPER], capture_output=True)
        self.p = subprocess.Popen([ENGINE, "run", "--rm", "-i", "--name", HELPER, "--network", "none", "--read-only",
                                   "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--memory", "256m",
                                   "--pids-limit", "64", "--cpus", "0.5", "--user", "bot",
                                   "--label", "terminay.managed=1", "-v", f"{VOL}:/home/bot",
                                   "--entrypoint", "terminay-files", IMAGE, "--protect", ".codex/auth.json"],
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        self.q = {}
        self.nid = 0
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        for line in self.p.stdout:
            m = json.loads(line)
            self.q.setdefault(m.get("id"), queue.Queue()).put(m)

    def req(self, **kw):
        self.nid += 1
        rid = self.nid
        self.q.setdefault(rid, queue.Queue())
        self.p.stdin.write(json.dumps(dict(kw, id=rid)) + "\n")
        self.p.stdin.flush()
        return rid

    def get(self, rid, timeout=20):
        return self.q[rid].get(timeout=timeout)

    def call(self, **kw):
        return self.get(self.req(**kw))

    def send(self, rid, **kw):
        self.p.stdin.write(json.dumps(dict(kw, id=rid)) + "\n")
        self.p.stdin.flush()
        return self.get(rid)

    def upload(self, path, data):
        rid = self.req(op="write-begin", path=path, size=len(data))
        r = self.get(rid)
        if refused(r):
            return r
        self.send(rid, op="write-chunk", data=base64.b64encode(data).decode())
        return self.send(rid, op="write-commit")

    def read_all(self, path):
        rid = self.req(op="read", path=path)
        data = b""
        while True:
            m = self.get(rid)
            if "chunk" in m:
                data += base64.b64decode(m["chunk"])
                self.p.stdin.write(json.dumps({"id": rid, "op": "credit", "n": 1}) + "\n")
                self.p.stdin.flush()
            elif m.get("done"):
                return data
            else:
                return m


def refused(m):
    return isinstance(m, dict) and ("error" in m or m.get("ok") is False)


def main():
    out = {}
    bot_sh("cd /home/bot && rm -rf spike-files && mkdir -p spike-files/real/sub && echo hello > spike-files/real/a.txt"
           " && ln -s /etc spike-files/esc && ln -s /etc/passwd spike-files/lnk && ln -s real spike-files/inside-link"
           " && echo keep > spike-files/real/keep && mkdir -p .codex && ln -sfn /run/terminay/host-auth/codex/auth.json .codex/auth.json")
    h = Helper()
    lst = h.call(op="list", path="spike-files")
    out["list"] = lst.get("entries", [])
    out["read_regular"] = h.read_all("spike-files/real/a.txt") == b"hello\n"
    out["read_through_dir_link_refused"] = refused(h.read_all("spike-files/esc/passwd"))
    out["read_file_link_refused"] = refused(h.read_all("spike-files/lnk"))
    out["read_inside_home_link_refused"] = refused(h.read_all("spike-files/inside-link/a.txt"))
    out["list_through_link_refused"] = refused(h.call(op="list", path="spike-files/esc"))
    out["write_through_link_refused"] = refused(h.upload("spike-files/esc/evil", b"xx\n"))
    out["write_over_link_refused"] = refused(h.upload("spike-files/lnk", b"xx\n"))
    out["etc_passwd_untouched"] = "xx" not in bot_sh("head -c 2 /etc/passwd").stdout
    out["write_regular"] = h.upload("spike-files/new.txt", b"new")
    out["written_owner"] = bot_sh("stat -c '%U %a' /home/bot/spike-files/new.txt").stdout.strip()
    out["rename_onto_existing_refused"] = refused(h.call(op="rename", **{"from": "spike-files/new.txt", "to": "spike-files/real/a.txt"}))
    out["delete_dir_link_deletes_link_only"] = (h.call(op="delete", path="spike-files/esc"),
                                                bot_sh("test -d /etc && echo etc-ok").stdout.strip())
    out["protected_read_refused"] = refused(h.read_all(".codex/auth.json"))
    out["protected_delete_refused"] = refused(h.call(op="delete", path=".codex"))
    out["protected_rename_refused"] = refused(h.call(op="rename", **{"from": ".codex", "to": "x"}))
    out["delete_parent_of_protected_refused"] = refused(h.call(op="delete", path="."))

    # Race: swap spike-files/race between a real directory and a link to /etc while reading race/passwd.
    bot_sh("cd /home/bot/spike-files && mkdir -p race && echo safe > race/passwd && ln -s /etc race-alt")
    stop = threading.Event()

    def swapper():
        script = ("cd /home/bot/spike-files; end=$(( $(date +%s) + 25 )); while [ $(date +%s) -lt $end ]; do "
                  "mv -T --exchange race race-alt; done")  # atomically swap the real directory and a link to /etc
        bot_sh(script)
        stop.set()

    t = threading.Thread(target=swapper)
    t.start()
    leaked = ok = ref = 0
    n = 0
    while not stop.is_set() and n < 3000:
        n += 1
        d = h.read_all("spike-files/race/passwd")
        if isinstance(d, bytes):
            if b"root:" in d:
                leaked += 1
            else:
                ok += 1
        else:
            ref += 1
    t.join()
    out["race"] = {"attempts": n, "leaked_etc_passwd": leaked, "refused": ref, "read_safe": ok}

    insp = json.loads(subprocess.run([ENGINE, "inspect", HELPER], capture_output=True, text=True).stdout)[0]
    hc = insp["HostConfig"]
    out["helper_limits"] = {"network": hc.get("NetworkMode"), "read_only": hc.get("ReadonlyRootfs"),
                            "cap_drop_all": "ALL" in (hc.get("CapDrop") or []) or len(hc.get("CapDrop") or []) > 10,
                            "memory": hc.get("Memory"), "pids": hc.get("PidsLimit"), "nano_cpus": hc.get("NanoCpus"),
                            "user": insp["Config"].get("User")}
    h.p.stdin.close()
    h.p.wait(timeout=20)
    bot_sh("rm -rf /home/bot/spike-files")
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
