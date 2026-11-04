import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkClaudeCredentials, checkClaudePrompt } from './claude-login.mjs';
import { checkDevicePrompt } from './device.mjs';

const manifest = JSON.parse(
	await readFile(new URL('./package.json', import.meta.url), 'utf8'),
).terminay;
const selected = process.argv[2];
const agent = manifest.contributes.botAgents.find((a) =>
	a.id.endsWith(`/${selected}`),
);
assert.ok(agent);
assert.equal(agent.runtimeProtocol, 'native-cli-v1');
for (const pin of agent.imageInstall.npm) {
	const i = pin.lastIndexOf('@');
	const pkg = JSON.parse(
		await readFile(
			`/usr/local/lib/node_modules/${pin.slice(0, i)}/package.json`,
			'utf8',
		),
	);
	assert.equal(pkg.version, pin.slice(i + 1));
}
const env = {
	PATH: process.env.PATH,
	HOME: '/home/bot',
	LANG: 'C.UTF-8',
	CLAUDE_CODE_MAX_RETRIES: '0',
	CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
};
if (selected === 'codex') await checkDevicePrompt(agent.deviceSignIn, env);
else {
	await checkClaudePrompt(agent.deviceSignIn, env);
	await checkClaudeCredentials(agent, env);
	console.log('saved login, API key and setup token selection passed');
}
console.log('device sign-in URL and code passed');
await import('./native-gate.mjs');
console.log('credential confinement passed');
