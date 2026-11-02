#!/usr/bin/env python3
"""Gate item 3, Codex API key: sign in with CODEX_API_KEY via ACP `authenticate`, and check
whether the key is written to the bot's disk under each credential-store setting.

Usage: spike_codex_apikey.py <engine> <container> <env-file> unused
"""
import json, os, secrets, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import spike_acp  # noqa: E402
from acp_client import Agent, summarize  # noqa: E402

KEY = spike_acp.KEY


def attempt(engine, c, store):
    sh = spike_acp.sh
    sh(engine, "exec", "-u", "root", c, "rm", "-f", "/home/bot/.codex/auth.json", check=False)
    sh(engine, "exec", "-u", "root", c, "rm", "-rf", "/home/bot/.codex/shell_snapshots", check=False)
    lines =['model = "%s"' % spike_acp.CODEX_MODEL, 'openai_base_url = "https://openrouter.ai/api/v1"']
    if store:
        lines.insert(0, 'cli_auth_credentials_store = "%s"' % store)
    if os.environ.get("SPIKE_EXCLUDE_ENV"):
        lines += ["", "[shell_environment_policy]", 'exclude = ["CODEX_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY"]']
    sh(engine, "exec", "-i", "-u", "bot", c, "sh", "-c",
       "mkdir -p /home/bot/.codex && cat > /home/bot/.codex/config.toml", input="\n".join(lines) + "\n")
    sid = "s-" + secrets.token_hex(4)
    a = Agent(engine, c, sid, ["codex-acp"], ["CODEX_API_KEY"], {"CODEX_API_KEY": KEY})
    r = {"store": store or "(default)"}
    try:
        a.initialize()
        r["authenticate"] = a.call("authenticate", {"methodId": "api-key"}, timeout=60)
        n = a.call("session/new", {"cwd": "/home/bot", "mcpServers": []}, timeout=120)
        res = a.call("session/prompt", {"sessionId": n["sessionId"],
                                        "prompt": [{"type": "text", "text":
            "Use your shell tool to run exactly: env | grep -c _API_KEY ; then reply with its output only."}]}, timeout=180)
        time.sleep(0.5)
        r["stopReason"] = res.get("stopReason")
        r["reply"] = summarize(a.drain_updates())["text"][-100:]
    except Exception as e:  # noqa: BLE001
        r["error"] = str(e)[:400]
    found = sh(engine, "exec", "-u", "root", c, "grep", "-rlF", KEY, "/home/bot", check=False).strip()
    r["key_on_bot_disk"] = [p for p in found.splitlines() if p]
    sh(engine, "exec", "-u", "root", c, "terminay-run", "--kill", sid, check=False)
    a.close()
    sh(engine, "exec", "-u", "root", c, "rm", "-f", "/home/bot/.codex/auth.json", check=False)
    return r


if __name__ == "__main__":
    engine, c = sys.argv[1], sys.argv[2]
    out = [attempt(engine, c, s) for s in (os.environ.get("SPIKE_STORES", ",ephemeral").split(","))]
    print(json.dumps(out, indent=1).replace(KEY, "[KEY]"))
