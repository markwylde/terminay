#!/usr/bin/env python3
"""Gate item 1: Codex host login, shared in place with masks, using a throwaway host home
and fake API keys only (no real credential is ever written).

Usage: spike_hostlogin.py <engine> <image> <throwaway-host-home> <host-codex-binary>
The host-codex binary runs only with CODEX_HOME set to the throwaway home.
"""
import json, os, stat, subprocess, sys, time, secrets
from concurrent.futures import ThreadPoolExecutor

ENGINE, IMAGE, HOME, HOST_CODEX = sys.argv[1:5]
H = os.path.join(HOME, ".codex")
MNT = "/run/terminay/host-auth/codex"
SIDECAR_NAMES = {"auth.json", "auth.lock"}  # Codex writes auth.json in place and locks auth.lock
SIDECAR_PREFIXES = ()
EMPTY = os.path.join(HOME, ".terminay-empty")


HOST_UID = int(os.environ.get("SPIKE_HOST_UID", "-1"))  # Linux: the host user has the bot's uid


def as_host_user():
    if HOST_UID >= 0:
        os.setgid(HOST_UID)
        os.setuid(HOST_UID)


def sh(*argv, check=True, input=None, env=None, host_user=False):
    r = subprocess.run(argv, capture_output=True, text=True, input=input, env=env,
                       preexec_fn=as_host_user if host_user else None)
    if check and r.returncode != 0:
        raise RuntimeError(f"{argv[:6]} -> {r.returncode}: {r.stderr.strip()[:300]}")
    return r


def host_codex(*args, input=None):
    env = {"PATH": os.environ["PATH"], "HOME": HOME, "CODEX_HOME": H}
    return sh(HOST_CODEX, *args, input=input, env=env, check=False, host_user=True)


def fake(tag):
    return f"sk-fake-{tag}-{secrets.token_hex(4)}"


def host_key():
    try:
        return json.load(open(os.path.join(H, "auth.json"))).get("OPENAI_API_KEY")
    except FileNotFoundError:
        return None
    except ValueError:
        return "INVALID-JSON"


def validate():
    """Pre-mount validation: canonical, inside the home, no link components, single-link regular file."""
    p = os.path.join(H, "auth.json")
    real = os.path.realpath(p)
    st = os.lstat(p)
    comps_ok = all(not os.path.islink(os.path.join(HOME, *os.path.relpath(p, HOME).split(os.sep)[:i + 1]))
                   for i in range(len(os.path.relpath(p, HOME).split(os.sep))))
    return {"canonical_inside_home": real == os.path.realpath(p) and real.startswith(os.path.realpath(HOME) + os.sep),
            "no_link_components": comps_ok, "regular": stat.S_ISREG(st.st_mode), "nlink": st.st_nlink}


def mask_args():
    args = []
    for name in sorted(os.listdir(H)):
        if name in SIDECAR_NAMES or (SIDECAR_PREFIXES and name.startswith(SIDECAR_PREFIXES)):
            continue
        p = os.path.join(H, name)
        dst = f"{MNT}/{name}"
        if os.path.isdir(p) and not os.path.islink(p):
            opts = "tmpfs-size=4k,ro=true,notmpcopyup" if ENGINE == "podman" else "tmpfs-size=4096,readonly"
            args += ["--mount", f"type=tmpfs,destination={dst},{opts}"]  # Podman copies the hidden contents up by default
        else:
            args += ["-v", f"{EMPTY}:{dst}:ro"]
    return args


def start_bot(name):
    sh(ENGINE, "rm", "-f", name, check=False)
    sh(ENGINE, "run", "-d", "--name", name, "--label", "terminay.managed=1",
       "-v", f"{H}:{MNT}", *mask_args(), IMAGE)
    out = sh(ENGINE, "exec", "-i", "-u", "root", name, "terminay-init", "--bootstrap",
             input=json.dumps({"botId": name, "vncPassword": "spikepw1",
                               "authLinks": [{"link": ".codex/auth.json", "target": f"{MNT}/auth.json"}]})).stdout
    assert out.strip() == "ready", out


def bot(name, script, check=False):
    return sh(ENGINE, "exec", "-i", "-u", "bot", "-e", "HOME=/home/bot", name, "sh", "-c", script, check=check)


def bot_key_now(name):
    r = bot(name, "cat /home/bot/.codex/auth.json 2>/dev/null")
    try:
        return json.loads(r.stdout).get("OPENAI_API_KEY") if r.stdout.strip() else None
    except ValueError:
        return "INVALID-JSON"


LAGS = []


def bot_key(name, expect=Ellipsis, wait=15.0):
    """Read the bot's view; when an expected value is given, wait for the engine's file cache."""
    t0 = time.monotonic()
    while True:
        v = bot_key_now(name)
        if expect is Ellipsis or v == expect or time.monotonic() - t0 > wait:
            if expect is not Ellipsis:
                LAGS.append(round(time.monotonic() - t0, 1))
            return v
        time.sleep(0.25)


def main():
    os.makedirs(os.path.join(H, "sessions", "2026"), exist_ok=True)
    os.makedirs(os.path.join(H, "skills", "demo"), exist_ok=True)
    open(os.path.join(H, "config.toml"), "w").write('model = "host-only-model"\n')
    open(os.path.join(H, "history.jsonl"), "w").write('{"text":"host history"}\n')
    open(os.path.join(H, "sessions", "2026", "rollout.jsonl"), "w").write("{}\n")
    open(os.path.join(H, "skills", "demo", "SKILL.md"), "w").write("host skill\n")
    open(EMPTY, "w").close()
    os.chmod(EMPTY, 0o444)
    if HOST_UID >= 0:
        for root, dirs, files in os.walk(HOME):
            for n in dirs + files:
                os.lchown(os.path.join(root, n), HOST_UID, HOST_UID)
        os.chown(HOME, HOST_UID, HOST_UID)
    out = {"host_codex": host_codex("--version").stdout.strip()}
    k = fake("host1")
    out["host_login"] = host_codex("login", "--with-api-key", input=k + "\n").returncode
    out["validation"] = validate()

    start_bot("tb-hl1")
    start_bot("tb-hl2")
    out["bot_link"] = bot("tb-hl1", "ls -l /home/bot/.codex/auth.json | sed 's/.* -> /-> /'").stdout.strip()
    out["1_bot_sees_host_login"] = bot_key("tb-hl1", k) == k

    # Masks hide everything else and are read-only.
    m = {}
    m["sessions_listing"] = bot("tb-hl1", f"ls -A {MNT}/sessions").stdout.split()
    m["skills_listing"] = bot("tb-hl1", f"ls -A {MNT}/skills").stdout.split()
    m["config_toml_bytes"] = len(bot("tb-hl1", f"cat {MNT}/config.toml").stdout)
    m["history_bytes"] = len(bot("tb-hl1", f"cat {MNT}/history.jsonl").stdout)
    m["write_masked_dir"] = bot("tb-hl1", f"touch {MNT}/sessions/x").returncode == 0
    m["write_masked_file"] = bot("tb-hl1", f"echo x > {MNT}/config.toml").returncode == 0
    m["bot_own_codex_dir_is_separate"] = bot("tb-hl1", "ls -A /home/bot/.codex").stdout.split()
    m["can_create_new_top_level_entry"] = bot("tb-hl1", f"touch {MNT}/planted && rm {MNT}/planted").returncode == 0
    m["can_replace_auth_with_link"] = bot("tb-hl1", f"ln -s /etc/passwd {MNT}/x.lnk && rm {MNT}/x.lnk").returncode == 0
    out["2_masks"] = m

    k2 = fake("host2")
    host_codex("login", "--with-api-key", input=k2 + "\n")
    out["3_host_relogin_seen_by_bots"] = bot_key("tb-hl1", k2) == k2 and bot_key("tb-hl2", k2) == k2

    k3 = fake("bot1")
    r = bot("tb-hl1", f"printf '%s\\n' {k3} | codex login --with-api-key")
    out["4_bot_login_writes_host_file"] = {"exit": r.returncode, "host_sees": host_key() == k3,
                                           "other_bot_sees": bot_key("tb-hl2", k3) == k3,
                                           "link_still_link": bot("tb-hl1", "test -L /home/bot/.codex/auth.json").returncode == 0,
                                           "host_validation": validate()}

    host_codex("logout")
    out["5_host_logout"] = {"bot_key": bot_key("tb-hl1", None),
                            "bot_status": bot("tb-hl1", "codex login status").stdout.strip()[:80] +
                                          bot("tb-hl1", "codex login status").stderr.strip()[:80]}
    k4 = fake("host3")
    host_codex("login", "--with-api-key", input=k4 + "\n")
    out["6_host_login_again_seen_without_recreate"] = bot_key("tb-hl1", k4) == k4

    r = bot("tb-hl2", "codex logout")
    out["7_bot_logout"] = {"exit": r.returncode, "out": (r.stdout + r.stderr).strip()[:120],
                           "bot_link_present": bot("tb-hl2", "test -L /home/bot/.codex/auth.json").returncode == 0,
                           "host_file_present": os.path.exists(os.path.join(H, "auth.json"))}
    if not os.path.exists(os.path.join(H, "auth.json")):
        host_codex("login", "--with-api-key", input=fake("host4") + "\n")
    start_bot("tb-hl2")  # restore the link for the race test

    # Concurrency: the host CLI and two bots each sign in 15 times at once.
    def host_loop():
        for i in range(15):
            host_codex("login", "--with-api-key", input=fake(f"h{i}") + "\n")

    def bot_loop(name):
        def f():
            bot(name, "for i in $(seq 15); do printf 'sk-fake-%s-%s\\n' " + name + " $i | codex login --with-api-key >/dev/null 2>&1; done")
        return f

    with ThreadPoolExecutor(3) as ex:
        for fut in [ex.submit(host_loop), ex.submit(bot_loop("tb-hl1")), ex.submit(bot_loop("tb-hl2"))]:
            fut.result()
    left = sorted(n for n in os.listdir(H) if n.startswith(".auth-"))
    out["8_concurrent_logins"] = {"final_valid_json": host_key() not in (None, "INVALID-JSON"),
                                  "validation": validate(), "leftover_temp_files": left,
                                  "bots_agree_with_host": bot_key("tb-hl1", host_key()) == host_key() == bot_key("tb-hl2", host_key())}
    out["visibility_lag_seconds"] = LAGS
    for n in ("tb-hl1", "tb-hl2"):
        sh(ENGINE, "rm", "-f", n, check=False)
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
