// Summarise a V8 .cpuprofile: self time and inclusive time per function.
import { readFileSync } from 'node:fs';

const profile = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const top = Number(process.argv[3] ?? 25);
const byId = new Map(profile.nodes.map((node) => [node.id, node]));
const parent = new Map();
for (const node of profile.nodes)
	for (const child of node.children ?? []) parent.set(child, node.id);
const label = (node) => {
	const frame = node.callFrame;
	const file = frame.url.split('/').slice(-1)[0] || '(native)';
	return `${frame.functionName || '(anonymous)'} ${file}:${frame.lineNumber + 1}`;
};
const self = new Map();
const inclusive = new Map();
let total = 0;
for (let index = 0; index < profile.samples.length; index += 1) {
	const delta = profile.timeDeltas[index] ?? 0;
	total += delta;
	let node = byId.get(profile.samples[index]);
	self.set(label(node), (self.get(label(node)) ?? 0) + delta);
	const seen = new Set();
	while (node !== undefined) {
		const name = label(node);
		if (!seen.has(name)) {
			seen.add(name);
			inclusive.set(name, (inclusive.get(name) ?? 0) + delta);
		}
		node = byId.get(parent.get(node.id));
	}
}
const print = (title, map, filter = () => true) => {
	console.log(`\n${title}`);
	for (const [name, time] of [...map]
		.filter(([name]) => filter(name))
		.sort((a, b) => b[1] - a[1])
		.slice(0, top))
		console.log(
			`${((time / total) * 100).toFixed(1).padStart(5)}%  ${(time / 1000).toFixed(0).padStart(6)}ms  ${name}`,
		);
};
console.log(`total sampled ${(total / 1e6).toFixed(2)}s`);
print('SELF', self);
print('INCLUSIVE (project code)', inclusive, (name) =>
	/authority\.mjs|\.ts:/.test(name),
);
