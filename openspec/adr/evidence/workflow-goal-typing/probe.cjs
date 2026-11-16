// Does Claude Code run a workflow's /goal when Terminay types it?
//
//   node probe.cjs [--cwd <trusted dir>] [--claude <command>] <case> ...
//
// A case is <kind>:<opening-prompt bytes>[:<chunk>:<delay ms>], where kind is
// launch or resume. The text is the real typed launch or resume text from
// @terminay/protocol (build it first: npx turbo run build --filter=@terminay/protocol),
// with a multi-paragraph, non-ASCII opening prompt padded to the given size.
// Chunk and delay default to production (128 characters, 10 ms); Enter
// follows after the 50 ms submit pause. Prints one JSON line per case.
const path = require('node:path');
const repo = path.resolve(__dirname, '../../../..');
const pty = require(path.join(repo, 'node_modules/node-pty'));

const args = process.argv.slice(2);
const option = (name, fallback) => {
	const index = args.indexOf(name);
	if (index < 0) return fallback;
	const [, value] = args.splice(index, 2);
	return value;
};
const cwd = option('--cwd', process.cwd());
const claude = option('--claude', 'claude --model claude-haiku-5-5');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function openingPrompt(bytes) {
	const head = 'Reply with the single word PROBE and stop; this is only a probe.\n\nCafé, naïve, 日本語 😀.\n\n';
	const filler = 'Ignore this filler sentence. ';
	let text = head;
	while (Buffer.byteLength(text + filler, 'utf8') <= bytes) text += filler;
	return text.trim();
}

async function run(kind, bytes, chunk, delay) {
	const protocol = await import(path.join(repo, 'packages/protocol/dist/index.js'));
	const instruction = kind === 'resume' ? protocol.WORKFLOW_RESUME_INSTRUCTION : protocol.WORKFLOW_LAUNCH_INSTRUCTION;
	const text = protocol.typedWorkflowGoal(openingPrompt(bytes), instruction);
	const [command, ...commandArgs] = claude.split(' ');
	const p = pty.spawn(command, commandArgs, { cwd, cols: 120, rows: 40, env: process.env });
	let out = '';
	p.onData((data) => {
		out += data;
	});
	for (let i = 0; i < 150 && !/bypass permissions|for shortcuts/.test(out); i++) await sleep(100);
	await sleep(1000);
	const characters = [...text];
	const started = Date.now();
	for (let i = 0; i < characters.length; ) {
		let piece = '';
		while (i < characters.length && piece.length + characters[i].length <= chunk) piece += characters[i++];
		p.write(piece);
		if (i < characters.length) await sleep(delay);
	}
	const typingMs = Date.now() - started;
	await sleep(50);
	p.write('\r');
	// Claude Code ran /goal when it sets the goal (or shows it active or
	// achieved), or when it refuses the goal's length.
	// biome-ignore lint/suspicious/noControlCharactersInRegex: strips ANSI.
	const screen = () => out.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '').replace(/\s+/g, ' ');
	const set = /Goal set|\/goal active|Goal achieved/;
	const tooLong = /Goal condition is limited/;
	for (let i = 0; i < 150 && !set.test(screen()) && !tooLong.test(screen()); i++) await sleep(100);
	const goalSet = set.test(screen());
	const goalTooLong = tooLong.test(screen());
	const pastedPlaceholder = /Pasted text/.test(screen());
	if (process.env.PROBE_DUMP) require('node:fs').writeFileSync(process.env.PROBE_DUMP, out);
	p.kill();
	return {
		kind,
		openingPromptBytes: bytes,
		textChars: text.length,
		chunk,
		delay,
		typingMs,
		pastedPlaceholder,
		commandRan: goalSet || goalTooLong,
		goalSet,
		goalTooLong,
	};
}

(async () => {
	for (const spec of args) {
		const [kind, bytes, chunk = '128', delay = '10'] = spec.split(':');
		console.log(JSON.stringify(await run(kind, Number(bytes), Number(chunk), Number(delay))));
	}
	process.exit(0);
})();
