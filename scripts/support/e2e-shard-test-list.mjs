// Deals the E2E suite out to shards.
//
// Playwright's own `--shard` cuts the ordered test list into contiguous
// slices. Slow tests sit together in a few spec files, so some slices carried
// three times the test time of others and the slowest set the length of the
// whole run. Dealing tests out in turn gives every shard a share of each file.
//
// A spec whose tests share setup stays whole: one that starts something in
// `beforeAll`, or that declares itself one group. Splitting it would repeat
// the setup in every shard, or break tests that rely on running in order.

const TITLE_SEPARATOR = ' › ';

/** Every test in a `playwright test --list --reporter=json` report, in order. */
export function listedTests(report) {
	const tests = [];
	const visit = (suite, titles) => {
		for (const spec of suite.specs ?? [])
			tests.push({ file: spec.file, titles: [...titles, spec.title] });
		for (const child of suite.suites ?? [])
			visit(child, [...titles, child.title]);
	};
	// A file's own suite is titled with its path, which is not part of a
	// test's title path.
	for (const fileSuite of report.suites ?? []) visit(fileSuite, []);
	return tests;
}

/** Whether a spec's tests must stay in one shard. */
export function sharesSetup(source) {
	return (
		/\btest\.beforeAll\(/u.test(source) ||
		/\bdescribe\.serial\b/u.test(source) ||
		/describe\.configure\(\{\s*mode:\s*['"](?:default|serial)['"]/u.test(source)
	);
}

/**
 * The units dealt to shards, in suite order: a whole file when its tests share
 * setup, otherwise one test.
 */
export function shardUnits(tests, keepsTogether) {
	const units = [];
	const whole = new Map();
	for (const test of tests) {
		if (!keepsTogether(test.file)) {
			units.push({ line: describe(test), tests: [test] });
			continue;
		}
		let unit = whole.get(test.file);
		if (unit === undefined) {
			unit = { line: test.file, tests: [] };
			whole.set(test.file, unit);
			units.push(unit);
		}
		unit.tests.push(test);
	}
	return units;
}

/**
 * Deal units to `total` shards: each goes to the shard holding the fewest
 * tests so far, the earliest on a tie. For single tests that is a plain deal
 * in turn; a whole file counts for as many tests as it has.
 */
export function dealToShards(units, total) {
	const shards = Array.from({ length: total }, () => ({ count: 0, units: [] }));
	for (const unit of units) {
		let target = shards[0];
		for (const shard of shards) if (shard.count < target.count) target = shard;
		target.units.push(unit);
		target.count += unit.tests.length;
	}
	return shards.map((shard) => shard.units);
}

/**
 * The `--test-list` lines of every shard. Throws unless each listed test is
 * selected by exactly one shard under Playwright's own matching, so a title
 * this format cannot express fails the split rather than dropping a test.
 */
export function shardTestLists(report, keepsTogether, total) {
	const tests = listedTests(report);
	const lists = dealToShards(shardUnits(tests, keepsTogether), total).map(
		(units) => units.map((unit) => unit.line),
	);
	for (const test of tests) {
		const selectedBy = lists.filter((lines) =>
			lines.some((line) => selects(line, test)),
		).length;
		if (selectedBy !== 1) {
			throw new Error(
				`${describe(test)} would run in ${selectedBy} shards, not exactly one`,
			);
		}
	}
	return lists;
}

function describe(test) {
	return [test.file, ...test.titles].join(TITLE_SEPARATOR);
}

/** Playwright's test-list matching: the file, then a prefix of the title path. */
function selects(line, test) {
	const delimiter = line.includes('›') ? '›' : '>';
	const [file, ...titles] = line.split(delimiter).map((token) => token.trim());
	return (
		file === test.file &&
		titles.length <= test.titles.length &&
		titles.every((title, index) => title === test.titles[index])
	);
}
