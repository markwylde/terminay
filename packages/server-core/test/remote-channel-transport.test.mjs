import assert from "node:assert/strict";
import test from "node:test";
import { TerminayClient } from "@terminay/client-core";
import { createInMemoryTransportPair } from "@terminay/protocol-conformance";
import {
	HeadlessChannelTransport,
	RemoteConnectionManager,
	RemoteHeadlessWebRtcFactory,
	ServerConnection,
} from "../dist/index.js";

class FakeChannel {
	constructor(peer = null) {
		this.label = "application";
		this.peer = peer;
		this.readyState = "connecting";
		this.bufferedAmount = 0;
		this.messages = new Set();
		this.states = new Set();
		this.sent = [];
		this.closed = false;
		this.sendError = undefined;
	}

	send(frame) {
		if (this.sendError !== undefined) throw this.sendError;
		if (this.readyState !== "open") throw new Error("channel is not open");
		this.sent.push(new Uint8Array(frame));
		this.peer?.emit(new Uint8Array(frame));
	}

	close() {
		if (this.closed) return;
		this.closed = true;
		this.readyState = "closed";
		for (const listener of [...this.states]) listener("closed");
		if (this.peer !== null && !this.peer.closed) this.peer.close();
	}

	onMessage(listener) {
		this.messages.add(listener);
		return () => this.messages.delete(listener);
	}

	onStateChange(listener) {
		this.states.add(listener);
		return () => this.states.delete(listener);
	}

	open() {
		this.readyState = "open";
		for (const listener of [...this.states]) listener("open");
	}

	emit(frame) {
		for (const listener of [...this.messages]) listener(frame);
	}
}

function channelPair() {
	const left = new FakeChannel();
	const right = new FakeChannel(left);
	left.peer = right;
	left.open();
	right.open();
	return { left, right };
}

test("headless channel transport waits for open, copies frames, and closes cleanly", async () => {
	const channel = new FakeChannel();
	const transport = new HeadlessChannelTransport(channel, { maxFrameBytes: 8, maxBufferedBytes: 16 });
	const opening = transport.open();
	channel.open();
	await opening;
	assert.equal(transport.state, "open");
	const original = new Uint8Array([1, 2, 3]);
	await transport.send(original);
	original[0] = 9;
	assert.deepEqual([...channel.sent[0]], [1, 2, 3]);
	channel.emit(new Uint8Array([4, 5]));
	const iterator = transport.incoming[Symbol.asyncIterator]();
	assert.deepEqual([...(await iterator.next()).value], [4, 5]);
	await transport.close();
	assert.equal(transport.state, "closed");
});

test("an externally closed channel releases native listeners before a reconnect can replace it", async () => {
	const channel = new FakeChannel();
	channel.open();
	const transport = new HeadlessChannelTransport(channel);
	await transport.open();
	const states = [];
	transport.onStateChange((state) => states.push(state));

	channel.close();

	assert.equal(transport.state, "closed");
	assert.deepEqual(states, ["closed"]);
	assert.equal(channel.messages.size, 0);
	assert.equal(channel.states.size, 0);
	channel.emit(new Uint8Array([1]));
	assert.equal(transport.bufferedBytes, 0);
	assert.deepEqual(await transport.incoming[Symbol.asyncIterator]().next(), { done: true, value: undefined });
});

test("a throwing transport state observer cannot escape a native close callback or hide the terminal transition", async () => {
	const channel = new FakeChannel();
	channel.open();
	const transport = new HeadlessChannelTransport(channel);
	await transport.open();
	const states = [];
	transport.onStateChange(() => {
		throw new Error("observer is faulty");
	});
	transport.onStateChange((state) => states.push(state));

	assert.doesNotThrow(() => channel.close());
	assert.equal(transport.state, "closed");
	assert.deepEqual(states, ["closed"]);
	assert.equal(channel.messages.size, 0);
	assert.equal(channel.states.size, 0);
});

test("invalid or oversized inbound frames fail closed before reaching the application", async () => {
	const channel = new FakeChannel();
	channel.open();
	const transport = new HeadlessChannelTransport(channel, { maxFrameBytes: 4, maxInboundBytes: 4 });
	await transport.open();
	channel.emit(new Uint8Array([1, 2, 3, 4, 5]));
	assert.equal(transport.state, "failed");
	assert.equal(channel.closed, true);
	const iterator = transport.incoming[Symbol.asyncIterator]();
	await assert.rejects(iterator.next(), /transport frame size out of bounds/);
});

test("a slow backpressured channel fails closed instead of waiting forever", async () => {
	const channel = new FakeChannel();
	channel.open();
	channel.bufferedAmount = 16;
	const transport = new HeadlessChannelTransport(channel, {
		maxFrameBytes: 8,
		maxBufferedBytes: 16,
		maxWritableWaitMs: 15,
	});
	await transport.open();
	const states = [];
	transport.onStateChange((state, reason) => states.push([state, reason?.code]));
	await assert.rejects(transport.send(new Uint8Array([1])), /remained backpressured/);
	assert.equal(transport.state, "failed");
	assert.equal(channel.closed, true);
	assert.deepEqual(states, [["failed", "timeout"]]);
});

test("headless channel send racing with close rejects and cannot reuse the channel", async () => {
	const channel = new FakeChannel();
	channel.open();
	channel.bufferedAmount = 16;
	const transport = new HeadlessChannelTransport(channel, {
		maxFrameBytes: 8,
		maxBufferedBytes: 16,
		maxWritableWaitMs: 1_000,
	});
	await transport.open();
	const sending = transport.send(new Uint8Array([1]));
	await transport.close({ code: "unavailable", message: "scripted close" });
	await assert.rejects(sending, /transport is (?:closing|closed)/u);
	await assert.rejects(transport.send(new Uint8Array([2])), /transport is closed/u);
	assert.deepEqual(channel.sent, []);
});

test("headless channel observes abort while waiting for backpressure", async () => {
	const channel = new FakeChannel();
	channel.open();
	channel.bufferedAmount = 16;
	const transport = new HeadlessChannelTransport(channel, {
		maxFrameBytes: 8,
		maxBufferedBytes: 16,
		maxWritableWaitMs: 1_000,
	});
	await transport.open();
	const controller = new AbortController();
	const waiting = transport.waitForWritable(1, controller.signal);
	controller.abort(new Error("scripted abort"));
	await assert.rejects(waiting, /scripted abort/u);
	assert.equal(transport.state, "open");
	await transport.close();
});

test("headless channel fails closed on synchronous native send failure", async () => {
	const channel = new FakeChannel();
	channel.open();
	channel.sendError = new Error("scripted native send failure");
	const transport = new HeadlessChannelTransport(channel, { maxFrameBytes: 8, maxBufferedBytes: 16 });
	await transport.open();
	await assert.rejects(transport.send(new Uint8Array([1])), /scripted native send failure/u);
	assert.equal(transport.state, "failed");
	assert.equal(channel.closed, true);
});

test("a throwing or poisoned native buffered-byte counter fails the relay closed", async () => {
	for (const value of [Number.NaN, -1, Number.MAX_SAFE_INTEGER]) {
		const channel = new FakeChannel();
		channel.open();
		channel.bufferedAmount = value;
		const transport = new HeadlessChannelTransport(channel, { maxFrameBytes: 8, maxBufferedBytes: 16 });
		await transport.open();
		assert.equal(transport.queuedBytes, 0);
		assert.equal(transport.state, "failed");
		assert.equal(channel.closed, true);
	}

	const channel = new FakeChannel();
	channel.open();
	Object.defineProperty(channel, "bufferedAmount", {
		get() {
			throw new Error("native counter failed");
		},
	});
	const transport = new HeadlessChannelTransport(channel, { maxFrameBytes: 8, maxBufferedBytes: 16 });
	await transport.open();
	await assert.rejects(transport.waitForWritable(), /buffered amount is invalid/);
	assert.equal(transport.state, "failed");
	assert.equal(channel.closed, true);
});

test("the canonical client protocol runs over a headless application channel", async () => {
	const channels = channelPair();
	const clientTransport = new HeadlessChannelTransport(channels.left);
	const serverTransport = new HeadlessChannelTransport(channels.right);
	const server = new ServerConnection(serverTransport, {
		serverId: "server-a",
		serverVersion: "1.0.0",
		capabilities: ["workspace"],
		authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "read" }),
		queries: {
			"workspace.echo": ({ envelope, context }) => ({
				clientId: context.clientId,
				payload: envelope.payload,
			}),
		},
	});
	const serverTask = server.start();
	const client = new TerminayClient({ transport: clientTransport, clientId: "client-a", capabilities: ["workspace"] });
	const hello = await client.connect();
	assert.equal(hello.serverId, "server-a");
	const result = await client.query("workspace.echo", { view: "remote" });
	assert.deepEqual(result.result, { clientId: "client-a", payload: { view: "remote" } });
	await client.close();
	await serverTask;
	assert.equal(server.state, "closed");
});

test("session transport consumers prevent application frames from duplicating into the manager queue", async () => {
	const channels = new Map();
	const manager = new RemoteConnectionManager({ serverId: "server-a", sessionOrigin: "https://session.example.test" });
	manager.expose(Date.now() + 60_000);
	const factory = new RemoteHeadlessWebRtcFactory({
		manager,
		runtimes: [{
			runtime: "custom",
			connect: () => {
				const result = new Map();
				for (const label of ["control", "application", "terminal", "assets"]) {
					const channel = new FakeChannel();
					channel.label = label;
					channel.open();
					channels.set(label, channel);
					result.set(label, channel);
				}
				return result;
			},
		}],
	});
	const session = await factory.connect("custom", {
		ticketId: "ticket-a",
		serverId: "server-a",
		sessionOrigin: "https://session.example.test",
		deviceId: "device-a",
		expiresAt: Date.now() + 60_000,
		authenticated: true,
	});
	const transport = session.createTransport("application", { maxFrameBytes: 8 });
	await transport.open();
	channels.get("application").emit(new Uint8Array([6, 7]));
	const next = await transport.incoming[Symbol.asyncIterator]().next();
	assert.deepEqual([...next.value], [6, 7]);
	assert.equal(manager.snapshot().peers[0].queuedBytes, 0);
	await session.close();
});

test("each authenticated channel has one protocol transport owner until it closes", async () => {
	const channels = new Map();
	const manager = new RemoteConnectionManager({ serverId: "server-owner", sessionOrigin: "https://session.example.test" });
	manager.expose(Date.now() + 60_000);
	const factory = new RemoteHeadlessWebRtcFactory({
		manager,
		runtimes: [{
			runtime: "custom",
			connect: () => {
				const result = new Map();
				for (const label of ["control", "application", "terminal", "assets"]) {
					const channel = new FakeChannel();
					channel.label = label;
					channel.open();
					channels.set(label, channel);
					result.set(label, channel);
				}
				return result;
			},
		}],
	});
	const session = await factory.connect("custom", {
		ticketId: "ticket-owner",
		serverId: "server-owner",
		sessionOrigin: "https://session.example.test",
		deviceId: "device-owner",
		expiresAt: Date.now() + 60_000,
		authenticated: true,
	});

	const first = session.createTransport("application");
	await first.open();
	assert.throws(() => session.createTransport("application"), /already attached/);
	channels.get("application").emit(new Uint8Array([9]));
	assert.deepEqual([...(await first.incoming[Symbol.asyncIterator]().next()).value], [9]);

	await first.close();
	assert.equal(session.state, "closed");
	const replacementSession = await factory.connect("custom", {
		ticketId: "ticket-owner-reconnect",
		serverId: "server-owner",
		sessionOrigin: "https://session.example.test",
		deviceId: "device-owner",
		expiresAt: Date.now() + 60_000,
		authenticated: true,
	});
	const replacement = replacementSession.createTransport("application");
	await replacement.open();
	channels.get("application").emit(new Uint8Array([10]));
	assert.deepEqual([...(await replacement.incoming[Symbol.asyncIterator]().next()).value], [10]);
	await replacementSession.close();
});

test("Local and headless remote transports share one client/server application protocol suite", async () => {
	const run = async (clientTransport, serverTransport) => {
		const server = new ServerConnection(serverTransport, {
			serverId: "server-a",
			serverVersion: "1.0.0",
			capabilities: ["workspace"],
			authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "write" }),
			queries: {
				"workspace.snapshot": () => ({ revision: 4, projects: ["project-a"] }),
			},
			commands: {
				"workspace.create": ({ envelope, context }) => ({
					result: { clientId: context.clientId, payload: envelope.payload },
					revision: context.expectedRevision === undefined ? 5 : context.expectedRevision + 1,
				}),
			},
		});
		const serverTask = server.start();
		const client = new TerminayClient({ transport: clientTransport, clientId: "client-a", capabilities: ["workspace"] });
		const hello = await client.connect();
		const snapshot = await client.query("workspace.snapshot");
		const command = await client.command("workspace.create", { name: "Project A" }, { expectedRevision: 4, commandId: "create-project-a" });
		await client.close();
		await serverTask;
		return { hello: hello.serverId, snapshot: snapshot.result, command: command.result };
	};

	const local = createInMemoryTransportPair();
	await local.open();
	const localResult = await run(local.client, local.server);

	const left = new FakeChannel();
	const right = new FakeChannel(left);
	left.peer = right;
	left.open();
	right.open();
	const remoteResult = await run(new HeadlessChannelTransport(left), new HeadlessChannelTransport(right));
	assert.deepEqual(remoteResult, localResult);
});
