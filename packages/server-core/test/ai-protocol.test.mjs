import assert from "node:assert/strict";
import test from "node:test";
import { TerminayAiClient, TerminayClient, TerminayClientFacade } from "@terminay/client-core";
import { createInMemoryTransportPair } from "@terminay/protocol-conformance";
import {
	AiService,
	ExactTerminalTargetRegistry,
	ServerConnection,
	TerminalReplayRegistry,
	createAiOperationHandlers,
} from "../dist/index.js";

const target = {
	serverId: "server-a",
	projectId: "project-a",
	panelId: "panel-a",
	sessionId: "session-a",
};

async function connectAi(service, scope = "write", clientId = "client-a") {
	const pair = createInMemoryTransportPair();
	await pair.open();
	const server = new ServerConnection(pair.server, {
		serverId: "server-a",
		serverVersion: "1.0.0",
		capabilities: ["ai.metadata", "ai.dictation"],
		authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: scope }),
		...createAiOperationHandlers(service),
	});
	const serverTask = server.start();
	const client = new TerminayClient({ transport: pair.client, clientId, capabilities: ["ai.metadata", "ai.dictation"] });
	await client.connect();
	return { server, client, ai: new TerminayAiClient(new TerminayClientFacade(client)), serverTask };
}

function serviceFor(options = {}) {
	const authority = new ExactTerminalTargetRegistry("server-a");
	authority.register(target, {
		title: "Terminal",
		note: "",
		writeInput: options.writeInput ?? (() => undefined),
	});
	const replay = new TerminalReplayRegistry({ maxBytes: 128, maxChars: 128 });
	replay.append(target.sessionId, "safe target output\n");
	const service = new AiService({
		serverId: "server-a",
		authority,
		replay,
		providers: options.providers ?? {
			codex: {
				listModels: () => [{ id: "test-model", label: "Test model" }],
				generate: () => "Generated title",
			},
		},
		dictationProvider: options.dictationProvider,
		dictationSettings: options.dictationSettings,
		limits: options.limits,
	});
	return { authority, service };
}

test("TerminayClient carries bounded AI model and metadata operations", async () => {
	let providerContext;
	const { authority, service } = serviceFor({
		providers: {
			codex: {
				listModels: () => [{ id: "test-model", label: "Test model" }],
				generate: (request) => {
					providerContext = request.context;
					return '"Build warnings"';
				},
			},
		},
	});
	const { client, ai, serverTask } = await connectAi(service);
	assert.deepEqual(await ai.listModels("codex"), [{ id: "test-model", label: "Test model" }]);
	const result = await ai.generateMetadata({
		requestId: "metadata-a",
		target,
		targetType: "title",
		provider: "codex",
		model: "test-model",
		expectedRevision: 0,
	});
	assert.equal(result.text, "Build warnings");
	assert.equal(result.revision, 1);
	assert.equal(authority.getTarget(target).title, "Build warnings");
	assert.equal(providerContext.target.sessionId, target.sessionId);
	assert.match(providerContext.text, /safe target output/);
	await client.close();
	await serverTask;
});

test("TerminayClient sends dictation audio as a bounded binary body and never retargets", async () => {
	const inserted = [];
	let providerRequest;
	const { authority, service } = serviceFor({
		writeInput: (input) => inserted.push(input),
		dictationProvider: {
			transcribe: (request) => {
				providerRequest = request;
				return { text: "echo" };
			},
		},
		dictationSettings: { enabled: true, provider: "openai", model: "test-transcribe", appendNewline: true },
	});
	const { client, ai, serverTask } = await connectAi(service);
	const result = await ai.transcribe({
		requestId: "dictation-a",
		target,
		mimeType: "audio/webm;codecs=opus",
		durationMs: 500,
		audio: new Uint8Array([1, 2, 3]),
	});
	assert.equal(result.text, "echo");
	assert.deepEqual(inserted, ["echo\n"]);
	assert.deepEqual([...providerRequest.audio], [1, 2, 3]);
	assert.equal(providerRequest.target, undefined);
	assert.equal("apiKey" in providerRequest, false);
	authority.markExited(target);
	await assert.rejects(
		ai.transcribe({
			requestId: "dictation-exited",
			target,
			mimeType: "audio/webm",
			audio: new Uint8Array([1]),
		}),
		(error) => error.code === "not_found",
	);
	await client.close();
	await serverTask;
});

test("AI cancellation and metadata revision conflicts stay on the original request", async () => {
	let release;
	const { authority, service } = serviceFor({
		providers: {
			codex: {
				generate: ({ signal }) => new Promise((resolve, reject) => {
					release = resolve;
					signal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true });
				}),
			},
		},
	});
	const { client, ai, serverTask } = await connectAi(service);
	const secondConnection = await connectAi(service, "write", "client-b");
	const pending = ai.generateMetadata({ requestId: "metadata-cancel", target, targetType: "title", provider: "codex", model: "test-model" });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal((await secondConnection.ai.cancel("metadata-cancel")).cancelled, true);
	await assert.rejects(pending, (error) => error.code === "cancelled");

	const second = ai.generateMetadata({ requestId: "metadata-stale", target, targetType: "title", provider: "codex", model: "test-model", expectedRevision: 0 });
	await new Promise((resolve) => setImmediate(resolve));
	authority.updateMetadata(target, "title", "Manual", 0);
	release("stale");
	await assert.rejects(second, (error) => error.code === "conflict");
	assert.equal(authority.getTarget(target).title, "Manual");
	await client.close();
	await serverTask;
	await secondConnection.client.close();
	await secondConnection.serverTask;
});
