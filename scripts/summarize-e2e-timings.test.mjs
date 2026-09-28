import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { collectTestTimings, formatSlowestTests } from "./summarize-e2e-timings.mjs";

const run = promisify(execFile);

const report = {
	suites: [
		{
			title: "terminal.spec.ts",
			file: "terminal.spec.ts",
			specs: [
				{ title: "types", file: "terminal.spec.ts", line: 3, tests: [{ results: [{ duration: 1200, status: "passed" }] }] },
			],
			suites: [
				{
					title: "terminal behavior",
					specs: [
						{
							title: "scrolls",
							file: "terminal.spec.ts",
							line: 9,
							tests: [{ results: [{ duration: 4000, status: "failed" }, { duration: 3500, status: "passed" }] }],
						},
					],
				},
			],
		},
		{ title: "app.spec.ts", specs: [{ title: "boots", file: "app.spec.ts", line: 1, tests: [{ results: [{ duration: 2500, status: "passed" }] }] }] },
	],
};

test("collects one row per test with summed attempt durations", () => {
	const rows = collectTestTimings(report);
	assert.equal(rows.length, 3);
	const scrolls = rows.find((row) => row.title.endsWith("scrolls"));
	assert.equal(scrolls.title, "terminal.spec.ts › terminal behavior › scrolls");
	assert.equal(scrolls.duration, 7500);
	assert.equal(scrolls.attempts, 2);
	assert.equal(scrolls.status, "passed");
});

test("formats the slowest tests first with totals", () => {
	const text = formatSlowestTests(collectTestTimings(report), 2);
	const lines = text.split("\n");
	assert.equal(lines[0], "Slowest 2 of 3 tests (11.2s of test time):");
	assert.match(lines[1], /7\.5s {2}terminal\.spec\.ts › terminal behavior › scrolls \(2 attempts, passed\)$/u);
	assert.match(lines[2], /2\.5s {2}app\.spec\.ts › boots$/u);
});

test("a missing report prints a note and exits 0", async () => {
	const { stdout } = await run(process.execPath, ["scripts/summarize-e2e-timings.mjs", "/nonexistent/timings.json"]);
	assert.match(stdout, /No E2E timing report at \/nonexistent\/timings\.json/u);
});

test("the CLI prints a summary from a report file", async () => {
	const dir = await mkdtemp(path.join(tmpdir(), "e2e-timings-"));
	const file = path.join(dir, "report.json");
	await writeFile(file, JSON.stringify(report));
	const { stdout } = await run(process.execPath, ["scripts/summarize-e2e-timings.mjs", file]);
	assert.match(stdout, /^Slowest 3 of 3 tests/u);
});
