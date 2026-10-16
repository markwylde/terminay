// Runs real turns against the Claude Code and Codex CLIs installed on this
// machine. It spends tokens, so it runs only with TERMINAY_CHAT_CONFORMANCE=1.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createAgentExtensionHarness } from '@terminay/extension-api/testing';
import { createBuiltInAgentsExtension } from '../dist/index.js';

const enabled = process.env.TERMINAY_CHAT_CONFORMANCE === '1';
const manifest = JSON.parse(
	await readFile(new URL('../package.json', import.meta.url), 'utf8'),
).terminay;
const pingServer = fileURLToPath(
	new URL('./fixtures/ping-mcp-server.mjs', import.meta.url),
);
const providers = [
	['Claude Code', 'com.terminay.builtin-agents/claude-code'],
	['Codex', 'com.terminay.builtin-agents/codex'],
];

for (const [name, providerId] of providers) {
	test(`${name}: a real turn streams a reply and calls only the host MCP server`, {
		skip: !enabled,
		timeout: 240_000,
	}, async (t) => {
		const workingDirectory = await mkdtemp(
			join(tmpdir(), 'terminay-chat-conformance-'),
		);
		t.after(() => rm(workingDirectory, { recursive: true, force: true }));
		const harness = await createAgentExtensionHarness(
			createBuiltInAgentsExtension(),
			{ manifest },
		);
		t.after(() => harness.dispose());
		const availability = await harness.chatAvailability(providerId);
		if (!availability.available)
			return t.skip(`${name} is ${availability.reason}`);

		const plain = await harness.openChatSession(providerId, {
			sessionId: 'plain',
			workingDirectory,
			mcpServer: null,
		});
		await plain.prompt('Reply with just the word pong.');
		assert.match(plain.text().toLowerCase(), /pong/);
		assert.deepEqual(plain.violations(), []);
		t.diagnostic(`${name} plain reply: ${JSON.stringify(plain.text())}`);
		await plain.session.close();

		const tooled = await harness.openChatSession(providerId, {
			sessionId: 'tooled',
			workingDirectory,
			mcpServer: {
				name: 'terminay_chat',
				command: process.execPath,
				args: [pingServer],
			},
		});
		await tooled.prompt(
			'Call the ping tool from the terminay_chat MCP server, then reply with exactly the text it returned and nothing else.',
		);
		const tools = tooled
			.events()
			.filter((event) => event.type === 'tool')
			.map((event) => event.tool);
		t.diagnostic(`${name} tools: ${JSON.stringify(tools)}`);
		t.diagnostic(`${name} tooled reply: ${JSON.stringify(tooled.text())}`);
		t.diagnostic(
			`${name} failures: ${JSON.stringify(tooled.events().filter((event) => event.type === 'failure'))}`,
		);
		assert.ok(
			tools.some(
				(tool) =>
					tool.server === 'terminay_chat' &&
					tool.name === 'ping' &&
					tool.state === 'completed',
			),
		);
		assert.ok(
			tools.every((tool) => tool.server === 'terminay_chat'),
			'no other tool ran',
		);
		assert.match(tooled.text(), /pong-from-terminay/);
		await tooled.session.close();
	});
}
