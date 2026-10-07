// Feeds the Git command stream 100,000 Trace2 events and reports how much heap
// is still held afterwards. Run with --expose-gc, so the measurement is of what
// is retained and not of what has yet to be collected.
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitCommandStream } from "../../dist/index.js";

const seen = [];
const commands = new GitCommandStream({
  socketPath: join(tmpdir(), `tmy-capture-memory-${process.pid}.sock`),
  onWorktreeAdd: (command) => seen.push(command),
  createToken: () => "tok-memory",
});
if (!(await commands.listen())) throw new Error("the stream could not listen");
const env = commands.environmentFor("session-a");
const path = env.GIT_TRACE2_EVENT.slice("af_unix:stream:".length);
const send = (text) =>
  new Promise((resolve, reject) => {
    const socket = connect(path, () => socket.end(text, resolve));
    socket.on("error", reject);
  });
const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const sid = `${env.GIT_TRACE2_PARENT_SID}/1`;
const status = `${JSON.stringify({ event: "start", sid, argv: ["git", "-c", "core.fsmonitor=", "status", "--porcelain"] })}\n`;
const noise = `${JSON.stringify({ event: "region_enter", sid, category: "index", label: "do_read_index" })}\n`;
const batch = (status + noise.repeat(9)).repeat(100);

// Warm up, so one-off allocations are not counted as growth.
for (let index = 0; index < 5; index += 1) await send(batch);
await settle(100);
globalThis.gc();
const before = process.memoryUsage().heapUsed;
for (let index = 0; index < 100; index += 1) await send(batch);
await settle(200);
globalThis.gc();
const grown = process.memoryUsage().heapUsed - before;
commands.close();
console.log(JSON.stringify({ events: 100 * 100 * 10, bytes: batch.length * 100, grown, seen: seen.length }));
