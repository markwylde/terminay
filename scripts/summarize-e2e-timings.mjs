// Prints the slowest tests from a Playwright JSON report into the job log.
// Reporting never affects the shard's result: a missing or unreadable report
// prints a note and exits 0.
import { readFile } from "node:fs/promises";

/** Flatten a Playwright JSON report into one row per test attempt set. */
export function collectTestTimings(report) {
	const rows = [];
	const visit = (suite, titles) => {
		const path = suite.title ? [...titles, suite.title] : titles;
		for (const spec of suite.specs ?? []) {
			for (const test of spec.tests ?? []) {
				const results = test.results ?? [];
				const duration = results.reduce((total, result) => total + (result.duration ?? 0), 0);
				rows.push({
					title: [...path, spec.title].filter(Boolean).join(" › "),
					file: spec.file,
					line: spec.line,
					duration,
					attempts: results.length,
					status: results.at(-1)?.status ?? "skipped",
				});
			}
		}
		for (const child of suite.suites ?? []) visit(child, path);
	};
	for (const suite of report.suites ?? []) visit(suite, []);
	return rows;
}

export function formatSlowestTests(rows, limit = 15) {
	const sorted = [...rows].sort((a, b) => b.duration - a.duration);
	const total = rows.reduce((sum, row) => sum + row.duration, 0);
	const lines = [
		`Slowest ${Math.min(limit, sorted.length)} of ${rows.length} tests (${(total / 1000).toFixed(1)}s of test time):`,
	];
	for (const row of sorted.slice(0, limit)) {
		const retried = row.attempts > 1 ? ` (${row.attempts} attempts, ${row.status})` : "";
		lines.push(`  ${(row.duration / 1000).toFixed(1).padStart(6)}s  ${row.title}${retried}`);
	}
	return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const file = process.argv[2] ?? "test-results/e2e-timings.json";
	try {
		const report = JSON.parse(await readFile(file, "utf8"));
		process.stdout.write(`${formatSlowestTests(collectTestTimings(report))}\n`);
	} catch (error) {
		process.stdout.write(`No E2E timing report at ${file}: ${error.message}\n`);
	}
}
