import test from "node:test";
import assert from "node:assert/strict";
import {
  createTerminalSignalParser,
  parseTerminalSignals,
} from "../dist/activity/index.js";

test("incremental parser handles split OSC, BEL, and ST terminators", () => {
  const parser = createTerminalSignalParser();
  assert.deepEqual(parser.push("before\x1b]9;4;3"), []);
  assert.deepEqual(parser.push(";42\x1b"), []);
  assert.deepEqual(parser.push("\\after"), [{ kind: "progress", state: 3, progress: 42 }]);
  assert.deepEqual(parser.push("\x1b]133;C\x07\x1b]133;D;0\x1b\\"), [
    { kind: "command", phase: "executing" },
    { kind: "command", phase: "finished", exitCode: 0 },
  ]);
  assert.deepEqual(parser.push("\x07"), [{ kind: "bell" }]);
});

test("OSC 9 progress is not confused with notifications and malformed payloads are ignored", () => {
  assert.deepEqual(parseTerminalSignals("\x1b]9;hello\x07"), [{ kind: "notification", body: "hello" }]);
  assert.deepEqual(parseTerminalSignals("\x1b]9;4;0\x07"), [{ kind: "progress", state: 0 }]);
  assert.deepEqual(parseTerminalSignals("\x1b]9;4;not-a-state\x07"), []);
  assert.deepEqual(parseTerminalSignals("\x1b]9;4;3;101\x07"), []);
  assert.deepEqual(parseTerminalSignals("\x1b]633;P;foo=bar\x07"), []);
  assert.deepEqual(parseTerminalSignals("\x1b]777;notify;title;body;tail\x07"), [{
    kind: "notification",
    title: "title",
    body: "body;tail",
  }]);
});

test("oversized OSC payload is discarded through its terminator and parser recovers", () => {
  const parser = createTerminalSignalParser({ maxPayloadBytes: 8 });
  assert.deepEqual(parser.push("\x1b]9;4;333333333333\x07"), []);
  assert.deepEqual(parser.push("\x1b]9;4;1\x07"), [{ kind: "progress", state: 1 }]);
});
