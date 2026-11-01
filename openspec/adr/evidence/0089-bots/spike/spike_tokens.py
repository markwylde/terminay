#!/usr/bin/env python3
"""Gate item 3: each token kind starts its adapter signed in, and the value never leaks.

Usage: spike_tokens.py <engine> <container> <env-file>
The token value is the OpenRouter key, routed through OpenRouter's Anthropic- and
OpenAI-compatible endpoints, so the adapter's own token variable is what signs it in.
CLAUDE_CODE_OAUTH_TOKEN needs a real `claude setup-token` value and is an owner check.
"""
import json, os, secrets, subprocess, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import spike_acp  # noqa: E402
from acp_client import Agent, summarize  # noqa: E402

KEY = spike_acp.KEY
CLAUDE_MODEL = spike_acp.CLAUDE_MODEL
CODEX_MODEL = spike_acp.CODEX_MODEL


def variants():
    common_claude = {"ANTHROPIC_BASE_URL": "https://openrouter.ai/api", "ANTHROPIC_MODEL": CLAUDE_MODEL,
                     "ANTHROPIC_DEFAULT_HAIKU_MODEL": CLAUDE_MODEL, "ANTHROPIC_SMALL_FAST_MODEL": CLAUDE_MODEL,
                     "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1", "CLAUDE_CODE_MAX_RETRIES": "0"}
    yield "claude/ANTHROPIC_API_KEY", ["claude-agent-acp"], dict(common_claude, ANTHROPIC_API_KEY=KEY), None
    # Codex: the bot's config points the built-in openai provider at OpenRouter; CODEX_API_KEY signs in.
    toml = 'model = "%s"\nopenai_base_url = "https://openrouter.ai/api/v1"\n' % CODEX_MODEL
    yield "codex/CODEX_API_KEY", ["codex-acp"], {"CODEX_API_KEY": KEY}, toml


def leaks(engine, c, values):
    secrets_ = [v for v in values.values() if v == KEY]
    host_ps = subprocess.run(["ps", "-axww", "-o", "args"], capture_output=True, text=True).stdout
    vm_ps = spike_acp.sh(engine, "machine", "ssh", "--", "ps", "-eww", "-o", "args", check=False) \
        if engine == "podman" else ""
    insp = spike_acp.sh(engine, "inspect", c)
    in_ctr = spike_acp.sh(engine, "exec", "-u", "root", c, "ps", "-eww", "-o", "args", check=False)
    return {"host_process_args": any(s in host_ps for s in secrets_),
            "engine_vm_process_args": any(s in vm_ps for s in secrets_),
            "container_inspect": any(s in insp for s in secrets_),
            "container_process_args": any(s in in_ctr for s in secrets_)}


def main():
    engine, c = sys.argv[1], sys.argv[2]
    out = {}
    for label, cmd, values, toml in variants():
        r = out[label] = {}
        if toml is not None:
            spike_acp.sh(engine, "exec", "-i", "-u", "bot", c, "sh", "-c",
                         "mkdir -p /home/bot/.codex && cat > /home/bot/.codex/config.toml", input=toml)
        sid = "s-" + secrets.token_hex(4)
        a = Agent(engine, c, sid, cmd, list(values), values)
        try:
            init = a.initialize()
            r["authMethods"] = [m.get("id") for m in init.get("authMethods", [])]
            n = a.call("session/new", {"cwd": "/home/bot", "mcpServers": []}, timeout=120)
            res = a.call("session/prompt", {"sessionId": n["sessionId"],
                                            "prompt": [{"type": "text", "text": "Reply with the word ok."}]}, timeout=180)
            time.sleep(0.5)
            r["stopReason"] = res.get("stopReason")
            r["reply"] = summarize(a.drain_updates())["text"][-100:]
            r["leaks_while_running"] = leaks(engine, c, values)
        except Exception as e:  # noqa: BLE001
            r["error"] = str(e)[:400]
        spike_acp.sh(engine, "exec", "-u", "root", c, "terminay-run", "--kill", sid, check=False)
        a.close()
        r["stderr_contains_key"] = KEY in "".join(a.stderr)
    text = json.dumps(out, indent=1).replace(KEY, "[KEY]")
    print(text)


if __name__ == "__main__":
    main()
