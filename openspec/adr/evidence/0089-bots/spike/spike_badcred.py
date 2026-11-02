#!/usr/bin/env python3
"""Gate item 4 (failed sign-in): how long until a bad credential surfaces, and what it looks like.

Usage: spike_badcred.py <engine> <container> <env-file> <claude|codex> [max_retries]
Reuses the container set up by spike_acp.py. The bad credential is random; the real key is
used only to check that the agent recovers once a valid credential is supplied.
"""
import json, os, secrets, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import spike_acp  # noqa: E402  (reads argv[1:5]; we pass compatible values)
from acp_client import Agent, summarize  # noqa: E402


def run(engine, c, name, bad, retries):
    cmd, names, values, key = spike_acp.agent_spec(name, bad_key=bad)
    if retries is not None and name == "claude":
        names = names + ["CLAUDE_CODE_MAX_RETRIES"]
        values = dict(values, CLAUDE_CODE_MAX_RETRIES=str(retries))
    sid = "s-" + secrets.token_hex(4)
    a = Agent(engine, c, sid, cmd, names, values)
    out = {"bad": bad, "max_retries": retries}
    t0 = time.monotonic()
    try:
        a.initialize()
        n = a.call("session/new", {"cwd": "/home/bot", "mcpServers": []}, timeout=120)
        res = a.call("session/prompt", {"sessionId": n["sessionId"],
                                        "prompt": [{"type": "text", "text": "Reply with the word ok."}]}, timeout=900)
        time.sleep(0.5)
        s = summarize(a.drain_updates())
        out.update(stopReason=res.get("stopReason"), reply=s["text"][-300:])
    except Exception as e:  # noqa: BLE001
        out["error"] = str(e)[:400]
    out["seconds"] = round(time.monotonic() - t0, 1)
    spike_acp.sh(engine, "exec", "-u", "root", c, "terminay-run", "--kill", sid, check=False)
    a.close()
    return json.loads(json.dumps(out).replace(spike_acp.KEY, "[KEY]"))


if __name__ == "__main__":
    engine, c, name = sys.argv[1], sys.argv[2], sys.argv[4]
    retries = int(sys.argv[5]) if len(sys.argv) > 5 else None
    print(json.dumps({"agent": name, "bad_credential": run(engine, c, name, True, retries),
                      "recovered_with_valid": run(engine, c, name, False, retries)}, indent=1))
