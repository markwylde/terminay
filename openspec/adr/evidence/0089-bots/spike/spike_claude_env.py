#!/usr/bin/env python3
"""Gate item 3, Claude Code: does a token reach tool processes or the bot's disk?
Also: can a tool read the agent's own environment through /proc (same uid)?

Usage: spike_claude_env.py <engine> <container> <env-file> unused
"""
import json, os, secrets, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import spike_acp  # noqa: E402
from acp_client import Agent, summarize  # noqa: E402

KEY = spike_acp.KEY
PROMPT = ("Use your shell tool to run exactly this one command: "
          "env | grep -c -E 'ANTHROPIC_(API_KEY|AUTH_TOKEN)=.' ; "
          "for p in /proc/[0-9]*; do tr '\\0' '\\n' < $p/environ 2>/dev/null | grep -q -E 'ANTHROPIC_(API_KEY|AUTH_TOKEN)=.' && echo readable; done | sort -u "
          "; then reply with the exact output only.")


def main():
    engine, c = sys.argv[1], sys.argv[2]
    sh = spike_acp.sh
    sh(engine, "exec", "-u", "root", c, "rm", "-rf", "/home/bot/.claude", check=False)
    cmd, names, values, _ = spike_acp.agent_spec("claude")
    names = names + ["CLAUDE_CODE_MAX_RETRIES"]
    values = dict(values, CLAUDE_CODE_MAX_RETRIES="0")
    sid = "s-" + secrets.token_hex(4)
    a = Agent(engine, c, sid, cmd, names, values)
    r = {}
    try:
        a.initialize()
        n = a.call("session/new", {"cwd": "/home/bot", "mcpServers": []}, timeout=120)
        res = a.call("session/prompt", {"sessionId": n["sessionId"],
                                        "prompt": [{"type": "text", "text": PROMPT}]}, timeout=180)
        time.sleep(0.5)
        r["stopReason"] = res.get("stopReason")
        r["reply"] = summarize(a.drain_updates())["text"][-200:]
    except Exception as e:  # noqa: BLE001
        r["error"] = str(e)[:400]
    found = sh(engine, "exec", "-u", "root", c, "grep", "-rlF", KEY, "/home/bot", check=False).strip()
    r["key_on_bot_disk"] = [p for p in found.splitlines() if p]
    sh(engine, "exec", "-u", "root", c, "terminay-run", "--kill", sid, check=False)
    a.close()
    print(json.dumps(r, indent=1).replace(KEY, "[KEY]"))


if __name__ == "__main__":
    main()
