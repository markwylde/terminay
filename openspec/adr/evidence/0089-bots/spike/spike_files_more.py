#!/usr/bin/env python3
"""Gate item 6, remaining checks: a fresh volume first opened by the helper has its root owned by
`bot`; the helper works while the bot is stopped; inotify reports changes the bot makes.

Usage: spike_files_more.py <engine> <image> <bot-container> <home-volume>
"""
import json, subprocess, sys, time, os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import spike_files  # noqa: E402  (argv layout matches)
from spike_files import Helper, ENGINE, IMAGE, BOT, VOL  # noqa: E402


def helper_on(volume):
    spike_files.VOL = volume
    return Helper()


def main():
    out = {}
    fresh = "tb-fresh-home"
    subprocess.run([ENGINE, "volume", "rm", "-f", fresh], capture_output=True)
    subprocess.run([ENGINE, "volume", "create", "--label", "terminay.managed=1", fresh], capture_output=True)
    h = helper_on(fresh)
    out["fresh_volume_list"] = h.call(op="list", path=".")
    out["fresh_volume_upload"] = h.upload("first.txt", b"x")
    h.p.stdin.close(); h.p.wait(timeout=20)
    r = subprocess.run([ENGINE, "run", "--rm", "-v", f"{fresh}:/v", "--entrypoint", "stat", IMAGE, "-c", "%U %a", "/v"],
                       capture_output=True, text=True)
    out["fresh_volume_root_owner"] = r.stdout.strip() or r.stderr.strip()[:200]
    subprocess.run([ENGINE, "volume", "rm", "-f", fresh], capture_output=True)

    # Watch: the bot makes changes while the helper watches.
    h = helper_on(VOL)
    rid = h.req(op="watch", paths=["."])
    first = h.get(rid)
    subprocess.run([ENGINE, "exec", "-u", "bot", BOT, "sh", "-c",
                    "cd /home/bot && echo a > watched.txt && mv watched.txt watched2.txt && rm watched2.txt"])
    events = []
    t0 = time.monotonic()
    while time.monotonic() - t0 < 5:
        try:
            events.append(h.get(rid, timeout=1))
        except Exception:  # noqa: BLE001
            break
    out["watch_first_reply"] = first
    out["watch_events"] = events[:8]
    h.p.stdin.close(); h.p.wait(timeout=20)

    # Stopped bot: the helper still works on its volume.
    subprocess.run([ENGINE, "stop", "-t", "5", BOT], capture_output=True)
    h = helper_on(VOL)
    out["stopped_bot_upload"] = h.upload("while-stopped.txt", b"ok")
    out["stopped_bot_read"] = h.read_all("while-stopped.txt") == b"ok"
    out["stopped_bot_delete"] = h.call(op="delete", path="while-stopped.txt")
    h.p.stdin.close(); h.p.wait(timeout=20)
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
