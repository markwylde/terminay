import assert from "node:assert/strict";
import test from "node:test";
import {
  TERMINAL_LAUNCHER_OPERATIONS,
  followTerminalLaunchers,
  parseTerminalLaunchers,
  serverOffersTerminalLaunchers,
} from "../dist/index.js";

const CLAUDE = { id: "com.terminay.builtin-agents/launch-claude-code", displayName: "Claude Code", icon: "agent-claude-code" };
const CODEX = { id: "com.terminay.builtin-agents/launch-codex", displayName: "Codex", icon: "agent-codex" };

function fakeTransport(answers) {
  const listeners = new Map();
  const queries = [];
  return {
    queries,
    async query(operation) {
      queries.push(operation);
      const next = answers.shift();
      if (next instanceof Error) throw next;
      return next;
    },
    async command() {
      throw new Error("no commands");
    },
    async subscribe(event, listener, onResync) {
      listeners.set(event, { listener, onResync });
      return () => listeners.delete(event);
    },
    emit(event) {
      listeners.get(event)?.listener({ event, payload: {} });
    },
    listening(event) {
      return listeners.has(event);
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("a server offers launchers only when its hello says so", () => {
  assert.equal(serverOffersTerminalLaunchers(["terminal.v1", "terminal-launchers.v1"]), true);
  assert.equal(serverOffersTerminalLaunchers(["terminal.v1"]), false);
});

test("a malformed list keeps only well-formed launchers", () => {
  assert.deepEqual(
    parseTerminalLaunchers({ launchers: [CLAUDE, { id: "bad id", displayName: "x", icon: "terminal" }, { ...CODEX, executable: "/x" }, CLAUDE] }),
    [CLAUDE, CODEX],
  );
  assert.deepEqual(parseTerminalLaunchers(null), []);
});

test("the list is read at once and again when the server says it changed", async () => {
  const transport = fakeTransport([{ launchers: [CLAUDE, CODEX] }, { launchers: [CLAUDE] }]);
  const seen = [];
  const stop = followTerminalLaunchers(transport, (launchers) => seen.push(launchers.map((launcher) => launcher.displayName)));
  await settle();
  assert.deepEqual(seen, [["Claude Code", "Codex"]]);
  transport.emit(TERMINAL_LAUNCHER_OPERATIONS.changed);
  await settle();
  assert.deepEqual(seen, [["Claude Code", "Codex"], ["Claude Code"]]);
  stop();
  assert.equal(transport.listening(TERMINAL_LAUNCHER_OPERATIONS.changed), false);
});

test("a server that cannot answer leaves no launchers", async () => {
  const transport = fakeTransport([new Error("unknown operation")]);
  const seen = [];
  followTerminalLaunchers(transport, (launchers) => seen.push(launchers));
  await settle();
  assert.deepEqual(seen, [[]]);
});
