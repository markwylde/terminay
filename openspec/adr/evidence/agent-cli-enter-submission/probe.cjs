// Does an agent CLI submit a message typed into its PTY?
// Usage: node probe.cjs <node-pty path> <mode> <cwd> [delayMs]
// Modes: joined (text+\r in one write), split (text, then \r after delayMs),
// bracket-joined, bracket-split, recover (joined, then a lone \r 1 s later).
const pty = require(process.argv[2]);
const [mode, cwd] = [process.argv[3], process.argv[4]];
const delay = Number(process.argv[5] ?? 50);
const answer = 'PINEAPPLE';
const msg = `Reply with only the word ${answer} and nothing else. This sentence pads the message so it is about as long as an instruction one agent sends another.`;
const p = pty.spawn('claude', ['--model', 'haiku'], { cols: 120, rows: 40, cwd, env: process.env });
let out = '';
p.onData((d) => { out += d; });
const paste = (s) => `\x1b[200~${s}\x1b[201~`;
setTimeout(() => {
	if (mode === 'joined') p.write(`${msg}\r`);
	if (mode === 'split') { p.write(msg); setTimeout(() => p.write('\r'), delay); }
	if (mode === 'bracket-joined') p.write(`${paste(msg)}\r`);
	if (mode === 'bracket-split') { p.write(paste(msg)); setTimeout(() => p.write('\r'), delay); }
	if (mode === 'recover') { p.write(`${msg}\r`); setTimeout(() => p.write('\r'), 1000); }
}, 6000);
setTimeout(() => {
	// The prompt echoes the message, so look for signs of a turn instead.
	// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping terminal escapes is the point
	const text = out.replace(/\x1b\][^\x07]*\x07/g, '').replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '');
	const submitted = /esc to interrupt|thinking|Cogitated|Baked|done \d/i.test(text);
	console.log(`${mode} ${delay}ms ${submitted ? 'SUBMITTED' : 'NOT SUBMITTED'}`);
	p.kill();
	process.exit(0);
}, 16000);
