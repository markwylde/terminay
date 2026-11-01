#!/usr/bin/env python3
"""Gate items 0.5, 0.6, 0.7: tokens, ACP behaviour, cancellation and process ownership.

Usage: spike_acp.py <engine> <image> <env-file> <out.json> [codex|claude ...]
Models are routed through OpenRouter, cheap models only.
"""
import json, os, secrets, subprocess, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from acp_client import Agent, summarize  # noqa: E402

ENGINE, IMAGE, ENV_FILE, OUT = sys.argv[1:5]
AGENTS = sys.argv[5:] or ["codex", "claude"]
CODEX_MODEL = "openai/gpt-6-luna"
CLAUDE_MODEL = "anthropic/claude-haiku-5.5"


def read_key():
    if ENV_FILE == "-":  # passed by name into this process's environment, never written to disk
        return os.environ["OPENROUTER_API_KEY"]
    for line in open(ENV_FILE):
        if line.startswith("OPENROUTER_API_KEY="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("no OPENROUTER_API_KEY")


KEY = read_key()


def sh(*argv, check=True, input=None):
    r = subprocess.run(argv, capture_output=True, text=True, input=input)
    if check and r.returncode != 0:
        raise RuntimeError(f"{argv[:4]} failed: {r.stderr.strip()[:400]}")
    return r.stdout


def agent_spec(name, bad_key=False):
    key = "sk-or-invalid-" + secrets.token_hex(8) if bad_key else KEY
    if name == "codex":
        cfg = {"model": CODEX_MODEL, "model_provider": "openrouter",
               "model_providers": {"openrouter": {"name": "OpenRouter", "base_url": "https://openrouter.ai/api/v1",
                                                  "env_key": "OPENROUTER_API_KEY", "wire_api": "responses"}}}
        del cfg  # the provider lives in the bot's ~/.codex/config.toml; CODEX_CONFIG applies per session only
        return (["codex-acp"], ["OPENROUTER_API_KEY"], {"OPENROUTER_API_KEY": key}, key)
    return (["claude-agent-acp"],
            ["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL",
             "ANTHROPIC_DEFAULT_HAIKU_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL",
             "ANTHROPIC_SMALL_FAST_MODEL", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"],
            {"ANTHROPIC_AUTH_TOKEN": key, "ANTHROPIC_BASE_URL": "https://openrouter.ai/api", "ANTHROPIC_API_KEY": "",
             "ANTHROPIC_MODEL": CLAUDE_MODEL, "ANTHROPIC_DEFAULT_HAIKU_MODEL": CLAUDE_MODEL,
             "ANTHROPIC_DEFAULT_SONNET_MODEL": CLAUDE_MODEL, "ANTHROPIC_DEFAULT_OPUS_MODEL": CLAUDE_MODEL,
             "ANTHROPIC_SMALL_FAST_MODEL": CLAUDE_MODEL, "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1"}, key)


def prompt(agent, sid, text, timeout=240):
    t0 = time.monotonic()
    res = agent.call("session/prompt", {"sessionId": sid, "prompt": [{"type": "text", "text": text}]}, timeout=timeout)
    time.sleep(0.5)
    return res, summarize(agent.drain_updates()), round(time.monotonic() - t0, 1)


def container_ps(c):
    return sh(ENGINE, "exec", "-u", "root", c, "ps", "-eo", "pid,pgid,user,args", check=False)


def setup_container(name):
    sh(ENGINE, "rm", "-f", name, check=False)
    sh(ENGINE, "network", "rm", "-f", name + "-net", check=False)
    sh(ENGINE, "volume", "rm", "-f", name + "-home", check=False)
    sh(ENGINE, "network", "create", "--label", "terminay.managed=1", name + "-net")
    sh(ENGINE, "volume", "create", "--label", "terminay.managed=1", name + "-home")
    sh(ENGINE, "run", "-d", "--name", name, "--network", name + "-net", "-p", "127.0.0.1::5901",
       "--label", "terminay.managed=1", "--label", "terminay.bot=spike", "--label", "terminay.server=spike",
       "--cpus", "2", "--memory", "4g", "--pids-limit", "1024",
       "-v", name + "-home:/home/bot", IMAGE)
    vnc = secrets.token_urlsafe(6)[:8]
    out = sh(ENGINE, "exec", "-i", "-u", "root", name, "terminay-init", "--bootstrap",
             input=json.dumps({"botId": "spike", "vncPassword": vnc, "authLinks": []}))
    assert out.strip() == "ready", out
    # The bot's own Codex config (per bot, never shared) routes the model through OpenRouter.
    toml = "\n".join(['model = "%s"' % CODEX_MODEL, 'model_provider = "openrouter"', "",
                      "[model_providers.openrouter]", 'name = "OpenRouter"',
                      'base_url = "https://openrouter.ai/api/v1"', 'env_key = "OPENROUTER_API_KEY"',
                      'wire_api = "responses"', ""])
    extra = os.environ.get("SPIKE_CODEX_TOML", "")  # top-level keys, e.g. sandbox_mode / approval_policy
    if extra:
        toml = extra.replace(";", "\n") + "\n" + toml
    sh(ENGINE, "exec", "-i", "-u", "bot", name, "sh", "-c",
       "mkdir -p /home/bot/.codex && cat > /home/bot/.codex/config.toml", input=toml)
    return vnc


def key_exposure(c, key):
    """Where could the key be seen? Host ps, container inspect, exec inspect (via API)."""
    found = {}
    host_ps = subprocess.run(["ps", "-axww", "-o", "args"], capture_output=True, text=True).stdout
    found["host_process_args"] = key in host_ps
    found["container_inspect"] = key in sh(ENGINE, "inspect", c)
    vm_ps = sh(ENGINE, "machine", "ssh", "--", "ps", "-eww", "-o", "args", check=False) if ENGINE == "podman" else ""
    found["engine_vm_process_args"] = key in vm_ps
    try:
        insp = json.loads(sh(ENGINE, "inspect", c))[0]
        ids = insp.get("ExecIDs") or []
        sock = sh("podman", "machine", "inspect", "--format", "{{.ConnectionInfo.PodmanSocket.Path}}").strip() \
            if ENGINE == "podman" else "/var/run/docker.sock"
        leaks = []
        for eid in ids:
            path = f"/v4.0.0/libpod/exec/{eid}/json" if ENGINE == "podman" else f"/exec/{eid}/json"
            j = subprocess.run(["curl", "-s", "--unix-socket", sock, "http://d" + path],
                               capture_output=True, text=True).stdout
            leaks.append(key in j)
        found["exec_inspect_checked"] = len(ids)
        found["exec_inspect"] = any(leaks)
    except Exception as e:  # noqa: BLE001
        found["exec_inspect_error"] = str(e)
    return found


def run_agent(c, name, results):
    cmd, names, values, key = agent_spec(name)
    r = results.setdefault(name, {})
    sid = "s-" + secrets.token_hex(4)
    a = Agent(ENGINE, c, sid, cmd, names, values)
    init = a.initialize()
    r["initialize"] = {"protocolVersion": init.get("protocolVersion"),
                       "agentCapabilities": init.get("agentCapabilities"),
                       "authMethods": [m.get("id") for m in init.get("authMethods", [])]}
    new = a.call("session/new", {"cwd": "/home/bot", "mcpServers": []}, timeout=120)
    acp_sid = new["sessionId"]
    mode = os.environ.get("SPIKE_CODEX_MODE")
    if name == "codex" and mode:
        # Codex's bubblewrap sandbox cannot nest in an unprivileged container; the container is the boundary.
        r["set_mode"] = mode
        a.call("session/set_config_option", {"sessionId": acp_sid, "configId": "mode", "value": mode})
    r["session_new_keys"] = sorted(new.keys())
    opts = new.get("configOptions") or []
    r["config_options"] = [{"id": o.get("id"), "category": o.get("category"),
                            "current": o.get("currentValue"),
                            "values": [v.get("value") for v in (o.get("options") or [])][:12]} for o in opts]
    r["models_field"] = (new.get("models") or {}).get("currentModelId") if isinstance(new.get("models"), dict) else None
    r["exposure_after_start"] = key_exposure(c, key)

    res, summ, secs = prompt(a, acp_sid,
        "Use your shell tool to run exactly: echo spike-ok > /home/bot/spike-" + name +
        ".txt && whoami . Then reply with just the command output.")
    r["tool_prompt"] = {"stopReason": res.get("stopReason"), "seconds": secs, "reply": summ["text"][-200:],
                        "tools": summ["tools"][:6], "update_kinds": summ["kinds"]}
    r["permission_requests"] = list(a.permission_log)
    r["file_created"] = sh(ENGINE, "exec", c, "cat", f"/home/bot/spike-{name}.txt", check=False).strip()
    r["client_requests_refused"] = [m["method"] for m in list(a.requests.queue)]

    # Cancellation
    q = a.call_async("session/prompt", {"sessionId": acp_sid, "prompt": [{"type": "text", "text":
        "Use your shell tool to run exactly: sleep 300 ; and wait for it to finish before replying."}]})
    started = time.monotonic()
    saw_sleep = False
    while time.monotonic() - started < 90:
        if "sleep 300" in container_ps(c):
            saw_sleep = True
            break
        time.sleep(1)
    t_cancel = time.monotonic()
    a.notify("session/cancel", {"sessionId": acp_sid})
    try:
        msg = q.get(timeout=30)
        stop = msg.get("result", {}).get("stopReason") if "result" in msg else msg.get("error")
    except Exception:  # noqa: BLE001
        stop = "no-response-30s"
    r["cancel"] = {"sleep_started": saw_sleep, "ack_seconds": round(time.monotonic() - t_cancel, 1),
                   "stopReason": stop}
    time.sleep(2)
    ps_after = container_ps(c)
    r["cancel"]["sleep_still_running_after_cancel"] = "sleep 300" in ps_after
    a.drain_updates()

    # Close (kill the session group) and confirm nothing from the session remains.
    sh(ENGINE, "exec", "-u", "root", c, "terminay-run", "--kill", sid)
    a.close()
    for _ in range(20):
        if sh(ENGINE, "exec", "-u", "root", c, "ls", "/run/terminay/sessions").strip() == "":
            break
        time.sleep(0.5)
    ps_after_kill = container_ps(c)
    r["kill"] = {"sleep_after_kill": "sleep 300" in ps_after_kill,
                 "agent_after_kill": cmd[0] in ps_after_kill,
                 "record_retired": sh(ENGINE, "exec", "-u", "root", c, "ls", "/run/terminay/sessions").strip() == ""}

    # Load after process restart
    caps = (init.get("agentCapabilities") or {})
    if caps.get("loadSession"):
        sid2 = "s-" + secrets.token_hex(4)
        b = Agent(ENGINE, c, sid2, cmd, names, values)
        b.initialize()
        try:
            b.call("session/load", {"sessionId": acp_sid, "cwd": "/home/bot", "mcpServers": []}, timeout=120)
            b.drain_updates()
            res, summ, secs = prompt(b, acp_sid, "What exact file path did you write earlier in this session? Reply with the path only.")
            r["load_after_restart"] = {"ok": True, "reply": summ["text"][-200:]}
        except Exception as e:  # noqa: BLE001
            r["load_after_restart"] = {"ok": False, "error": str(e)[:300]}
        sh(ENGINE, "exec", "-u", "root", c, "terminay-run", "--kill", sid2)
        b.close()
    else:
        r["load_after_restart"] = {"ok": False, "error": "agent does not advertise loadSession"}

    # Sign-in failure, then recovery
    cmd3, names3, values3, _ = agent_spec(name, bad_key=True)
    sid3 = "s-" + secrets.token_hex(4)
    d = Agent(ENGINE, c, sid3, cmd3, names3, values3)
    try:
        d.initialize()
        n3 = d.call("session/new", {"cwd": "/home/bot", "mcpServers": []}, timeout=120)
        try:
            res, summ, secs = prompt(d, n3["sessionId"], "Reply with the word ok.", timeout=120)
            r["bad_credential"] = {"stopReason": res.get("stopReason"), "reply": summ["text"][-300:]}
        except Exception as e:  # noqa: BLE001
            r["bad_credential"] = {"error": str(e)[:300]}
    except Exception as e:  # noqa: BLE001
        r["bad_credential"] = {"error": str(e)[:300]}
    r["bad_credential"]["stderr_tail"] = "".join(d.stderr[-5:]).replace(KEY, "[KEY]")[-400:]
    sh(ENGINE, "exec", "-u", "root", c, "terminay-run", "--kill", sid3)
    d.close()
    r["stderr_tail"] = "".join(a.stderr[-8:]).replace(KEY, "[KEY]")[-600:]


def stale_record_test(c):
    """A reused group number without the nonce must survive --kill."""
    # An unrelated `bot` process in its own group.
    sh(ENGINE, "exec", "-d", "-u", "bot", c, "setsid", "sleep", "777")
    time.sleep(1)
    line = next(l for l in container_ps(c).splitlines() if "sleep 777" in l)
    pid, pgid = int(line.split()[0]), int(line.split()[1])
    rec = json.dumps({"pgid": pgid, "start": 1, "nonce": "deadbeef" * 4})  # start time will not match
    sh(ENGINE, "exec", "-i", "-u", "root", c, "python3", "-c",
       "import sys;open('/run/terminay/sessions/stale','w').write(sys.stdin.read())", input=rec)
    sh(ENGINE, "exec", "-u", "root", c, "terminay-run", "--kill", "stale")
    survived = "sleep 777" in container_ps(c)
    retired = "stale" not in sh(ENGINE, "exec", "-u", "root", c, "ls", "/run/terminay/sessions")
    sh(ENGINE, "exec", "-u", "root", c, "kill", str(pid), check=False)
    # The bot user cannot read session records or the VNC password.
    bot_read = subprocess.run([ENGINE, "exec", "-u", "bot", c, "ls", "/run/terminay/sessions"], capture_output=True)
    bot_vnc = subprocess.run([ENGINE, "exec", "-u", "bot", c, "cat", "/run/terminay/vnc/passwd"], capture_output=True)
    return {"unrelated_group_survived": survived, "stale_record_retired": retired,
            "bot_can_list_records": bot_read.returncode == 0, "bot_can_read_vnc_password": bot_vnc.returncode == 0}


def main():
    c = "tb-spike"
    results = {"engine": ENGINE, "image": IMAGE, "engine_version": sh(ENGINE, "--version").strip(),
               "models": {"codex": CODEX_MODEL, "claude": CLAUDE_MODEL}}
    setup_container(c)
    results["process_ownership"] = stale_record_test(c)
    for name in AGENTS:
        try:
            run_agent(c, name, results)
        except Exception as e:  # noqa: BLE001
            results.setdefault(name, {})["fatal"] = str(e).replace(KEY, "[KEY]")[:600]
    text = json.dumps(results, indent=2).replace(KEY, "[KEY]")
    assert KEY not in text
    open(OUT, "w").write(text + "\n")
    print(text)


if __name__ == "__main__":
    main()
