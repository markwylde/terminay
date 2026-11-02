#!/usr/bin/env python3
"""Gate item 1: how the host's Codex CLI writes auth.json (in place or replace), what it creates,
and what logout does. Throwaway CODEX_HOME and fake keys only.

Usage: host_codex_write.py <codex-binary> <throwaway-home>
"""
import json, os, subprocess, sys

codex, home = sys.argv[1], sys.argv[2]
ch = os.path.join(home, ".codex")
os.makedirs(ch, exist_ok=True)
env = {"PATH": "/usr/bin:/bin", "HOME": home, "CODEX_HOME": ch}
out = {"version": subprocess.run([codex, "--version"], capture_output=True, text=True, env=env).stdout.strip(),
       "logins": []}
for i in range(3):
    subprocess.run([codex, "login", "--with-api-key"], input=f"sk-fake-{i}\n", capture_output=True, text=True, env=env)
    st = os.lstat(os.path.join(ch, "auth.json"))
    out["logins"].append({"inode": st.st_ino, "nlink": st.st_nlink, "mode": oct(st.st_mode)})
out["entries_after_login"] = sorted(os.listdir(ch))
subprocess.run([codex, "logout"], capture_output=True, env=env)
out["entries_after_logout"] = sorted(os.listdir(ch))
# Login through a symlink: does Codex follow it, or replace the link?
target_dir = os.path.join(home, "shared")
os.makedirs(target_dir, exist_ok=True)
open(os.path.join(target_dir, "auth.json"), "w").write("{}")
os.symlink(os.path.join(target_dir, "auth.json"), os.path.join(ch, "auth.json"))
subprocess.run([codex, "login", "--with-api-key"], input="sk-fake-link\n", capture_output=True, text=True, env=env)
out["login_through_link"] = {"still_link": os.path.islink(os.path.join(ch, "auth.json")),
                             "target_updated": "sk-fake-link" in open(os.path.join(target_dir, "auth.json")).read(),
                             "shared_dir_entries": sorted(os.listdir(target_dir))}
subprocess.run([codex, "logout"], capture_output=True, env=env)
out["logout_through_link"] = {"link_exists": os.path.lexists(os.path.join(ch, "auth.json")),
                              "target_exists": os.path.exists(os.path.join(target_dir, "auth.json"))}
print(json.dumps(out, indent=1))
