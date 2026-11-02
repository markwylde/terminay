#!/usr/bin/env python3
"""Gate item 7 (container side): the desktop fails closed without a bootstrap, offers only
VNC authentication, and another bot cannot reach it.

Usage: spike_desktop.py <engine> <image> <bootstrapped-bot-container>
The server-side relay (noVNC, view-only, RFB allowlist) is built and tested in task group 4.
"""
import json, socket, subprocess, sys, time

ENGINE, IMAGE, BOT = sys.argv[1:4]


def sh(*a, check=False, input=None):
    return subprocess.run(a, capture_output=True, text=True, input=input)


def rfb_security_types(host, port):
    s = socket.create_connection((host, port), timeout=5)
    banner = s.recv(12)
    s.sendall(b"RFB 003.008\n")
    n = s.recv(1)[0]
    types = list(s.recv(n)) if n else []
    s.close()
    return banner.decode().strip(), types


PROBE = ("import socket,sys\n"
         "try:\n"
         " s=socket.create_connection((sys.argv[1],int(sys.argv[2])),timeout=4);print('connected',s.recv(12))\n"
         "except Exception as e: print('refused',type(e).__name__)\n")


def main():
    out = {}
    # 1. No bootstrap: the init gives up and nothing listens.
    sh(ENGINE, "rm", "-f", "tb-noboot")
    sh(ENGINE, "run", "-d", "--name", "tb-noboot", "--label", "terminay.managed=1", IMAGE)
    time.sleep(2)
    out["no_bootstrap_xvnc_running_early"] = "Xvnc" in sh(ENGINE, "exec", "tb-noboot", "ps", "-eo", "args").stdout
    t0 = time.monotonic()
    while time.monotonic() - t0 < 45:
        st = json.loads(sh(ENGINE, "inspect", "tb-noboot").stdout)[0]["State"]
        if not st["Running"]:
            break
        time.sleep(1)
    out["no_bootstrap_exit"] = {"running": st["Running"], "exit_code": st.get("ExitCode"),
                                "after_seconds": round(time.monotonic() - t0 + 2)}
    sh(ENGINE, "rm", "-f", "tb-noboot")

    # 2. The bootstrapped bot offers VNC authentication only, on host loopback.
    port = sh(ENGINE, "port", BOT, "5901/tcp").stdout.strip().rsplit(":", 1)
    out["published"] = ":".join(port)
    out["rfb"] = rfb_security_types("127.0.0.1", int(port[1]))
    ps = sh(ENGINE, "exec", BOT, "ps", "-eo", "user,args").stdout
    out["desktop_processes"] = [l.strip()[:90] for l in ps.splitlines() if "Xvnc" in l or "openbox" in l]
    out["bot_can_read_vnc_password"] = sh(ENGINE, "exec", "-u", "bot", BOT, "cat", "/run/terminay/vnc/passwd").returncode == 0

    # 3. Another bot on its own network cannot reach this bot's desktop.
    ip = json.loads(sh(ENGINE, "inspect", BOT).stdout)[0]["NetworkSettings"]["Networks"]
    bot_ip = next(iter(ip.values()))["IPAddress"]
    sh(ENGINE, "rm", "-f", "tb-other")
    sh(ENGINE, "network", "rm", "-f", "tb-other-net")
    sh(ENGINE, "network", "create", "--label", "terminay.managed=1", "tb-other-net")
    gw = "host.containers.internal" if ENGINE == "podman" else "host.docker.internal"
    sh(ENGINE, "run", "-d", "--name", "tb-other", "--network", "tb-other-net", "--label", "terminay.managed=1",
       "--add-host", f"{gw}:host-gateway", "--entrypoint", "sleep", IMAGE, "infinity")
    out["other_bot_to_bot_ip"] = sh(ENGINE, "exec", "tb-other", "python3", "-c", PROBE, bot_ip, "5901").stdout.strip()
    out["other_bot_to_host_published_port"] = sh(ENGINE, "exec", "tb-other", "python3", "-c", PROBE,
                                                 gw, port[1]).stdout.strip()
    sh(ENGINE, "rm", "-f", "tb-other")
    sh(ENGINE, "network", "rm", "-f", "tb-other-net")
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
