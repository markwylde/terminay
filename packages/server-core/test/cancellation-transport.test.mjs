import assert from "node:assert/strict";
import test from "node:test";
import { decodeFrame, encodeFrame } from "@terminay/protocol";
import { createInMemoryTransportPair } from "@terminay/protocol-conformance";
import { ServerConnection } from "../dist/index.js";

const hello = {
	type: "client_hello",
	protocolMin: 1,
	protocolMax: 1,
	clientId: "cancellation-client",
	clientVersion: "test",
	capabilities: [],
	limits: {},
};

async function connect(options) {
	const pair = createInMemoryTransportPair();
	await pair.open();
	const server = new ServerConnection(pair.server, {
		serverId: "cancellation-server",
		serverVersion: "test",
		capabilities: [],
		authenticate: ({ hello: clientHello }) => ({ clientId: clientHello.clientId, authScope: "write" }),
		...options,
	});
	const serverTask = server.start();
	const incoming = pair.client.incoming[Symbol.asyncIterator]();
	await pair.client.send(encodeFrame(hello));
	const serverHello = await nextEnvelope(incoming);
	assert.equal(serverHello.type, "server_hello");
	return { pair, server, serverTask, incoming };
}

async function nextEnvelope(incoming) {
	const next = await incoming.next();
	assert.equal(next.done, false);
	return decodeFrame(next.value).envelope;
}

async function waitFor(predicate) {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (predicate()) return;
		await new Promise((resolve) => setImmediate(resolve));
	}
	assert.fail("timed out waiting for the server operation to start");
}

async function closeConnection(connection) {
	await connection.server.close();
	await connection.serverTask.catch(() => undefined);
}

test("cancel aborts only the matching in-flight query and returns a bounded result", async () => {
	const signals = new Map();
	const aborted = new Map();
	const release = new Map();
	const connection = await connect({
		queries: {
			"test.wait": ({ envelope, context }) => new Promise((resolve) => {
				signals.set(envelope.queryId, context.signal);
				context.signal.addEventListener("abort", () => {
					aborted.set(envelope.queryId, true);
					setImmediate(() => resolve({ queryId: envelope.queryId, completed: false }));
				}, { once: true });
				release.set(envelope.queryId, () => resolve({ queryId: envelope.queryId, completed: true }));
			}),
		},
	});
	try {
		await connection.pair.client.send(encodeFrame({ type: "query", queryId: "query-cancel", operation: "test.wait", payload: {} }));
		await connection.pair.client.send(encodeFrame({ type: "query", queryId: "query-keep", operation: "test.wait", payload: {} }));
		await waitFor(() => signals.has("query-cancel") && signals.has("query-keep"));

		await connection.pair.client.send(encodeFrame({
			type: "cancel",
			correlationId: "query-cancel",
			reason: "x".repeat(128),
		}));
		const cancelled = await nextEnvelope(connection.incoming);
		assert.deepEqual(cancelled, {
			type: "query_result",
			queryId: "query-cancel",
			ok: false,
			error: { code: "cancelled", message: "operation cancelled", retryable: true },
		});
		assert.equal(aborted.get("query-cancel"), true);
		assert.equal(signals.get("query-keep").aborted, false);
		assert.equal(aborted.get("query-keep"), undefined);

		release.get("query-keep")();
		assert.deepEqual(await nextEnvelope(connection.incoming), {
			type: "query_result",
			queryId: "query-keep",
			ok: true,
			result: { queryId: "query-keep", completed: true },
		});
	} finally {
		await closeConnection(connection);
	}
});

test("cancel aborts a command by correlation id without cancelling a sibling command", async () => {
	const signals = new Map();
	const aborted = new Map();
	const release = new Map();
	const connection = await connect({
		commands: {
			"test.wait": ({ envelope, context }) => new Promise((resolve) => {
				signals.set(envelope.correlationId, context.signal);
				context.signal.addEventListener("abort", () => {
					aborted.set(envelope.correlationId, true);
					setImmediate(() => resolve({ result: { correlationId: envelope.correlationId, completed: false } }));
				}, { once: true });
				release.set(envelope.correlationId, () => resolve({ result: { correlationId: envelope.correlationId, completed: true } }));
			}),
		},
	});
	try {
		await connection.pair.client.send(encodeFrame({ type: "command", commandId: "command-cancel", correlationId: "correlation-cancel", operation: "test.wait", payload: {} }));
		await connection.pair.client.send(encodeFrame({ type: "command", commandId: "command-keep", correlationId: "correlation-keep", operation: "test.wait", payload: {} }));
		await waitFor(() => signals.has("correlation-cancel") && signals.has("correlation-keep"));

		await connection.pair.client.send(encodeFrame({
			type: "cancel",
			correlationId: "correlation-cancel",
			reason: "user stopped this command",
		}));
		const cancelled = await nextEnvelope(connection.incoming);
		assert.deepEqual(cancelled, {
			type: "command_result",
			commandId: "command-cancel",
			correlationId: "correlation-cancel",
			ok: false,
			error: { code: "cancelled", message: "operation cancelled", retryable: true },
		});
		assert.equal(aborted.get("correlation-cancel"), true);
		assert.equal(signals.get("correlation-keep").aborted, false);
		assert.equal(aborted.get("correlation-keep"), undefined);

		release.get("correlation-keep")();
		assert.deepEqual(await nextEnvelope(connection.incoming), {
			type: "command_result",
			commandId: "command-keep",
			correlationId: "correlation-keep",
			ok: true,
			result: { correlationId: "correlation-keep", completed: true },
		});
	} finally {
		await closeConnection(connection);
	}
});
