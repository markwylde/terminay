#!/usr/bin/env python3
"""Minimal ACP client used by the add-terminay-bots feasibility gate.

Drives an ACP agent running inside a bot container through
`<engine> exec -i -u root [-e NAME...] <container> terminay-run <sid> -- <cmd>`.
Secrets are passed by name only (`-e NAME`); values live only in this process's
environment, never in argv.
"""
import json, os, subprocess, sys, threading, time, queue


class Agent:
    def __init__(self, engine, container, sid, cmd, env_names=(), env_values=None, log=None):
        argv = [engine, "exec", "-i", "-u", "root"]
        for n in env_names:
            argv += ["-e", n]
        argv += [container, "terminay-run", sid, "--", *cmd]
        env = dict(os.environ)
        env.update(env_values or {})
        self.argv = argv
        self.proc = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=subprocess.PIPE, env=env)
        self.next_id = 1
        self.pending = {}
        self.updates = queue.Queue()
        self.requests = queue.Queue()
        self.stderr = []
        self.log = log or (lambda m: None)
        self.permission_policy = "allow"
        self.permission_log = []
        threading.Thread(target=self._read, daemon=True).start()
        threading.Thread(target=self._read_err, daemon=True).start()

    def _read_err(self):
        for line in self.proc.stderr:
            self.stderr.append(line.decode("utf-8", "replace"))
            del self.stderr[:-400]

    def _read(self):
        for raw in self.proc.stdout:
            try:
                msg = json.loads(raw)
            except ValueError:
                self.log(f"non-json: {raw[:200]!r}")
                continue
            if "id" in msg and ("result" in msg or "error" in msg) and "method" not in msg:
                q = self.pending.pop(msg["id"], None)
                if q:
                    q.put(msg)
            elif msg.get("method") == "session/update":
                self.updates.put(msg["params"])
            elif "method" in msg and "id" in msg:
                self._on_request(msg)
            else:
                self.updates.put({"other": msg})
        for q in list(self.pending.values()):
            q.put({"error": {"message": "agent exited"}})

    def _send(self, obj):
        data = (json.dumps(obj) + "\n").encode()
        self.proc.stdin.write(data)
        self.proc.stdin.flush()

    def _on_request(self, msg):
        m = msg["method"]
        if m == "session/request_permission":
            opts = msg["params"].get("options", [])
            self.permission_log.append({"tool": msg["params"].get("toolCall", {}).get("title"),
                                        "options": [o.get("kind") for o in opts]})
            pick = None
            if self.permission_policy == "allow":
                for kind in ("allow_once", "allow_always"):
                    pick = next((o for o in opts if o.get("kind") == kind), None)
                    if pick:
                        break
            else:
                pick = next((o for o in opts if o.get("kind", "").startswith("reject")), None)
            if pick:
                self._send({"jsonrpc": "2.0", "id": msg["id"],
                            "result": {"outcome": {"outcome": "selected", "optionId": pick["optionId"]}}})
            else:
                self._send({"jsonrpc": "2.0", "id": msg["id"], "result": {"outcome": {"outcome": "cancelled"}}})
        else:
            self.requests.put(msg)
            self._send({"jsonrpc": "2.0", "id": msg["id"],
                        "error": {"code": -32601, "message": f"client does not support {m}"}})

    def call(self, method, params, timeout=120):
        rid = self.next_id
        self.next_id += 1
        q = queue.Queue()
        self.pending[rid] = q
        self._send({"jsonrpc": "2.0", "id": rid, "method": method, "params": params})
        try:
            msg = q.get(timeout=timeout)
        except queue.Empty:
            raise TimeoutError(f"{method} timed out after {timeout}s")
        if "error" in msg:
            raise RuntimeError(f"{method}: {msg['error']}")
        return msg["result"]

    def call_async(self, method, params):
        rid = self.next_id
        self.next_id += 1
        q = queue.Queue()
        self.pending[rid] = q
        self._send({"jsonrpc": "2.0", "id": rid, "method": method, "params": params})
        return q

    def notify(self, method, params):
        self._send({"jsonrpc": "2.0", "method": method, "params": params})

    def initialize(self):
        return self.call("initialize", {
            "protocolVersion": 1,
            "clientCapabilities": {"fs": {"readTextFile": False, "writeTextFile": False}, "terminal": False},
            "clientInfo": {"name": "terminay-bots-spike", "version": "0.0.0"},
        }, timeout=60)

    def drain_updates(self):
        out = []
        while True:
            try:
                out.append(self.updates.get_nowait())
            except queue.Empty:
                return out

    def close(self, grace=5):
        try:
            self.proc.stdin.close()
        except Exception:  # noqa: BLE001
            pass
        try:
            self.proc.wait(timeout=grace)
        except subprocess.TimeoutExpired:
            self.proc.kill()


def summarize(updates):
    text, tools, plans, kinds = [], [], 0, {}
    for u in updates:
        upd = u.get("update", {})
        k = upd.get("sessionUpdate", "other")
        kinds[k] = kinds.get(k, 0) + 1
        if k == "agent_message_chunk":
            c = upd.get("content", {})
            if c.get("type") == "text":
                text.append(c.get("text", ""))
        elif k in ("tool_call", "tool_call_update"):
            tools.append({"kind": upd.get("kind"), "title": upd.get("title"), "status": upd.get("status")})
        elif k == "plan":
            plans += 1
    return {"text": "".join(text), "tools": tools, "plans": plans, "kinds": kinds}
