import assert from "node:assert/strict";
import test from "node:test";
import { TerminayAiClient, TerminayClient } from "@terminay/client-core";
import { createInMemoryTransportPair } from "@terminay/protocol-conformance";
import {
	AiService,
	AiServiceError,
	DictationService,
	ExactTerminalTargetRegistry,
	ServerConnection,
	TerminalReplayRegistry,
	createAiOperationHandlers,
} from "../dist/index.js";

const target = Object.freeze({
	serverId: "server-a",
	projectId: "project-a",
	panelId: "panel-a",
	sessionId: "session-a",
});

function createAuthority(value = target, options = {}) {
	const authority = new ExactTerminalTargetRegistry("server-a");
	authority.register(value, {
		writeInput: options.writeInput ?? (() => undefined),
		...(options.authorizedClients === undefined ? {} : { authorizedClients: options.authorizedClients }),
	});
	return authority;
}

function request(requestId, value = target, options = {}) {
	return {
		requestId,
		clientId: options.clientId ?? "client-a",
		target: value,
		mimeType: "audio/webm",
		audio: new Uint8Array([1, 2, 3]),
		...(options.durationMs === undefined ? {} : { durationMs: options.durationMs }),
	};
}

function tick() {
	return new Promise((resolve) => setImmediate(resolve));
}

test("dictation abort cancels provider work and leaves no terminal input", async () => {
	const inserted = [];
	const authority = createAuthority(target, { writeInput: (value) => inserted.push(value) });
	let providerSignal;
	const service = new DictationService({
		serverId: "server-a",
		authority,
		provider: {
			transcribe: ({ signal }) => {
				providerSignal = signal;
				return new Promise((resolve, reject) => {
					signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
					void resolve;
				});
			},
		},
	});
	const abort = new AbortController();
	const pending = service.transcribe({ ...request("dictation-abort"), signal: abort.signal });
	await tick();
	abort.abort();
	await assert.rejects(pending, (error) => error instanceof AiServiceError && error.code === "provider_cancelled");
	assert.equal(providerSignal.aborted, true);
	assert.deepEqual(inserted, []);
	assert.equal(service.status("dictation-abort").status, "cancelled");
});

test("dictation revocation and target exit are checked again before insertion", async () => {
	const exitTarget = Object.freeze({ ...target, panelId: "panel-b", sessionId: "session-b" });
	const inserted = [];
	const authority = createAuthority(target, { authorizedClients: ["client-a"], writeInput: (value) => inserted.push(value) });
	authority.register(exitTarget, { writeInput: (value) => inserted.push(value) });
	let release;
	const service = new DictationService({
		serverId: "server-a",
		authority,
		provider: { transcribe: () => new Promise((resolve) => { release = resolve; }) },
	});

	const revoked = service.transcribe(request("dictation-revoked"));
	await tick();
	authority.setAuthorizedClients(target, ["client-b"]);
	release({ text: "must not insert" });
	await assert.rejects(revoked, (error) => error instanceof AiServiceError && error.code === "not_authorized");
	assert.deepEqual(inserted, []);

	const exited = service.transcribe(request("dictation-exited", exitTarget));
	await tick();
	authority.markExited(exitTarget);
	release({ text: "must not insert" });
	await assert.rejects(exited, (error) => error instanceof AiServiceError && error.code === "target_exited");
	assert.deepEqual(inserted, []);
});

test("dictation enforces duration and provider output bounds before writing", async () => {
	const inserted = [];
	const authority = createAuthority(target, { writeInput: (value) => inserted.push(value) });
	let providerCalls = 0;
	const durationService = new DictationService({
		serverId: "server-a",
		authority,
		provider: { transcribe: () => { providerCalls += 1; return { text: "never reached" }; } },
		limits: { maxAudioDurationMs: 100 },
	});
	await assert.rejects(
		durationService.transcribe(request("dictation-duration", target, { durationMs: 101 })),
		(error) => error instanceof AiServiceError && error.code === "audio_duration_exceeded",
	);
	assert.equal(providerCalls, 0);

	const outputService = new DictationService({
		serverId: "server-a",
		authority,
		provider: { transcribe: () => ({ text: "transcript exceeds" }) },
		limits: { maxProviderOutputBytes: 8 },
	});
	await assert.rejects(
		outputService.transcribe(request("dictation-output")),
		(error) => error instanceof AiServiceError && error.code === "audio_output_too_large",
	);
	assert.deepEqual(inserted, []);
});

test("dictation rejects invalid or character-oversized provider output without insertion", async () => {
	const inserted = [];
	const authority = createAuthority(target, { writeInput: (value) => inserted.push(value) });
	const characterLimited = new DictationService({
		serverId: "server-a",
		authority,
		provider: { transcribe: () => ({ text: "too long" }) },
		limits: { maxProviderOutputBytes: 64, maxTranscriptChars: 4 },
	});
	await assert.rejects(
		characterLimited.transcribe(request("dictation-output-chars")),
		(error) => error instanceof AiServiceError && error.code === "audio_output_too_large",
	);

	const malformed = new DictationService({
		serverId: "server-a",
		authority,
		provider: { transcribe: () => ({ text: 42 }) },
	});
	await assert.rejects(
		malformed.transcribe(request("dictation-output-invalid")),
		(error) => error instanceof AiServiceError && error.code === "empty_output",
	);
	assert.deepEqual(inserted, []);
});

test("a real framed client disconnect aborts in-flight dictation", async () => {
	const inserted = [];
	const authority = createAuthority(target, { writeInput: (value) => inserted.push(value) });
	let providerSignal;
	const service = new AiService({
		serverId: "server-a",
		authority,
		replay: new TerminalReplayRegistry(),
		providers: { codex: { generate: () => "unused" } },
		dictationProvider: {
			transcribe: ({ signal }) => {
				providerSignal = signal;
				return new Promise((resolve, reject) => {
					signal.addEventListener("abort", () => reject(new DOMException("disconnected", "AbortError")), { once: true });
					void resolve;
				});
			},
		},
	});
	const pair = createInMemoryTransportPair();
	await pair.open();
	const server = new ServerConnection(pair.server, {
		serverId: "server-a",
		serverVersion: "1.0.0",
		capabilities: ["ai.dictation"],
		authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "write" }),
		...createAiOperationHandlers(service),
	});
	const serverTask = server.start();
	const client = new TerminayClient({ transport: pair.client, clientId: "client-a", capabilities: ["ai.dictation"] });
	await client.connect();
	const ai = new TerminayAiClient(client);
	const pending = ai.transcribe(request("dictation-disconnect"));
	await tick();
	await client.close();
	await assert.rejects(pending, (error) => error.code === "unknown_command_outcome" || error.code === "disconnected");
	await serverTask;
	assert.equal(providerSignal.aborted, true);
	assert.deepEqual(inserted, []);
	assert.equal(service.status("dictation-disconnect").status, "cancelled");
});
