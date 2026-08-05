import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createAgentDriverRegistry } from "../packages/server-core/dist/activity/agentDrivers.js";

const args = Object.fromEntries(process.argv.slice(2).map((value) => {
  const separator = value.indexOf("=");
  return separator < 0 ? [value.replace(/^--/u, ""), true] : [value.slice(2, separator), value.slice(separator + 1)];
}));
const provider = typeof args.provider === "string" ? args.provider : "codex";
const version = typeof args.version === "string" ? args.version : "0.2";
const fixturePath = resolve(typeof args.fixture === "string" ? args.fixture : `packages/server-core/test/fixtures/${provider}/v${version}/basic.jsonl`);
const records = (await readFile(fixturePath, "utf8")).trim().split(/\r?\n/u).map((line) => JSON.parse(line));
const registry = createAgentDriverRegistry();
const inspected = registry.inspectSession(provider, records[0]);
assert(inspected, `${fixturePath}: first record is not recognized session metadata`);
const resolved = registry.resolve(provider, inspected.session.providerVersion ?? version);
assert(resolved, `${provider} has no registered mapping`);
const events = records.map((record, index) => registry.normalize(provider, inspected.session.providerVersion ?? version, record, {
  activationTerminalSessionId: "compatibility-terminal", providerSessionId: inspected.session.providerSessionId,
  sequence: index + 1, occurredAt: index + 1,
})).filter(Boolean);
for (const required of ["session.started", "turn.started", "agent.done"]) {
  assert(events.some(({ kind }) => kind === required), `${fixturePath}: missing required ${required} lifecycle event`);
}
process.stdout.write(`${provider} ${version} is compatible with ${resolved.mappingVersion} (${events.length} lifecycle records)\n`);
