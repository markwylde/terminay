#!/usr/bin/env python3
"""Run a spike inside the Linux engine host (the dind container), passing the OpenRouter key
by name only: it sits in this process's environment and in `exec -e NAME`, never in argv or on disk.

Usage: run_in_engine_host.py <outer-engine> <engine-host-container> <env-file> <command...>
"""
import os, subprocess, sys

outer, host, env_file, *cmd = sys.argv[1:]
key = next(l.split("=", 1)[1].strip().strip('"').strip("'") for l in open(env_file)
           if l.startswith("OPENROUTER_API_KEY="))
env = dict(os.environ, OPENROUTER_API_KEY=key)
r = subprocess.run([outer, "exec", "-e", "OPENROUTER_API_KEY", host, *cmd], env=env, capture_output=True, text=True)
sys.stdout.write(r.stdout.replace(key, "[KEY]"))
sys.stderr.write(r.stderr.replace(key, "[KEY]")[-3000:])
sys.exit(r.returncode)
