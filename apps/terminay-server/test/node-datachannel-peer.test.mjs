import assert from "node:assert/strict";
import test from "node:test";
import { createNodeDataChannelOpenChannels } from "../dist/index.js";

class FakeChannel {
	constructor(label) {
		this.label = label;
		this.open = true;
		this.closed = new Set();
	}

	getLabel() { return this.label; }
	isOpen() { return this.open; }
	bufferedAmount() { return 0; }
	sendMessageBinary() { return true; }
	onMessage() { return undefined; }
	onClosed(listener) { this.closed.add(listener); }
	close() { this.open = false; for (const listener of this.closed) listener(); }
}

class FakePeer {
	constructor() {
		FakePeer.instance = this;
		this.closed = false;
	}

	onLocalDescription(listener) { this.description = listener; }
	onLocalCandidate(listener) { this.candidate = listener; }
	onStateChange(listener) { this.state = listener; }
	onDataChannel(listener) { this.dataChannel = listener; }
	setRemoteDescription(sdp, type) {
		this.remoteDescription = { sdp, type };
		this.description?.("answer-sdp", "answer");
	}
	addRemoteCandidate(candidate, mid) { this.remoteCandidate = { candidate, mid }; }
	close() { this.closed = true; }
	emitChannel(label) { this.dataChannel?.(new FakeChannel(label)); }
}

function context() {
	return {
		peerId: "peer-1",
		deviceId: "device-1",
		serverId: "server-a",
		sessionOrigin: "https://session.example.test",
		channels: ["control", "application", "terminal", "assets"],
		maxFrameBytes: 1024,
		maxBufferedBytes: 4096,
		signal: new AbortController().signal,
	};
}

test("node-datachannel peer rejects an invalid injected role before peer or relay allocation", () => {
	let relaySubscribed = false;
	const signaling = {
		send() {},
		onMessage() { relaySubscribed = true; return () => {}; },
		sign: (message) => message,
		verify: (message) => message,
	};

	assert.throws(
		() => createNodeDataChannelOpenChannels({ signaling, role: "unexpected-role" }),
		/node-datachannel peer role is invalid/,
	);
	assert.equal(relaySubscribed, false, "invalid configuration must not subscribe to the authenticated relay");
});

test("node-datachannel peer opener verifies signaling, answers offers, and maps all channels", async () => {
	const inbound = [];
	const outbound = [];
	const signaling = {
		send: (message) => outbound.push(message),
		onMessage(listener) { inbound.push(listener); return () => inbound.splice(inbound.indexOf(listener), 1); },
		sign: (message) => ({ ...message, signature: "valid" }),
		verify: (message) => message?.signature === "valid" ? { type: message.type, ...(message.sdp === undefined ? { candidate: message.candidate, mid: message.mid } : { sdp: message.sdp }) } : null,
	};
	const openChannels = createNodeDataChannelOpenChannels({ signaling, timeoutMs: 1_000 });
	const pending = openChannels({ PeerConnection: FakePeer }, context());
	inbound[0]({ type: "offer", sdp: "offer-sdp", signature: "valid" });
	inbound[0]({ type: "ice", candidate: "candidate", mid: "0", signature: "valid" });
	for (const label of ["control", "application", "terminal", "assets"]) FakePeer.instance.emitChannel(label);
	const channels = await pending;
	assert.deepEqual([...channels.keys()], ["control", "application", "terminal", "assets"]);
	assert.deepEqual(FakePeer.instance.remoteDescription, { sdp: "offer-sdp", type: "offer" });
	assert.deepEqual(FakePeer.instance.remoteCandidate, { candidate: "candidate", mid: "0" });
	assert.deepEqual(outbound, [
		{ type: "answer", sdp: "answer-sdp", signature: "valid" },
	]);
});

test("node-datachannel peer fails closed when authenticated signaling verification stalls", async () => {
	const inbound = [];
	const signaling = {
		send() {},
		onMessage(listener) { inbound.push(listener); return () => inbound.splice(inbound.indexOf(listener), 1); },
		sign: (message) => message,
		verify: () => new Promise(() => {}),
	};
	const openChannels = createNodeDataChannelOpenChannels({
		signaling,
		timeoutMs: 1_000,
		signalVerificationTimeoutMs: 20,
	});
	const pending = openChannels({ PeerConnection: FakePeer }, context());
	inbound[0]({ type: "offer", sdp: "offer-sdp" });

	await assert.rejects(pending, /signaling verification timed out/);
	assert.equal(FakePeer.instance.closed, true);
	assert.equal(inbound.length, 0, "a stalled verifier must release the signaling subscription");
});

test("node-datachannel peer fails closed when the native binding reports an unknown lifecycle state", async () => {
	const inbound = [];
	const signaling = {
		send() {},
		onMessage(listener) { inbound.push(listener); return () => inbound.splice(inbound.indexOf(listener), 1); },
		sign: (message) => message,
		verify: (message) => message,
	};
	const openChannels = createNodeDataChannelOpenChannels({ signaling, timeoutMs: 1_000 });
	const pending = openChannels({ PeerConnection: FakePeer }, context());

	FakePeer.instance.state({ state: "corrupt-native-state" });
	await assert.rejects(pending, /reported an invalid state/);

	assert.equal(FakePeer.instance.closed, true);
	assert.equal(inbound.length, 0, "invalid native state must release the signaling subscription");
});

test("node-datachannel peer rejects an invalid relay unsubscribe handle before native setup", async () => {
	let listener;
	const signaling = {
		send() {},
		onMessage(candidate) {
			listener = candidate;
			return undefined;
		},
		sign: (message) => message,
		verify: (message) => message,
	};
	const openChannels = createNodeDataChannelOpenChannels({ signaling, timeoutMs: 1_000 });

	await assert.rejects(
		openChannels({ PeerConnection: FakePeer }, context()),
		/signaling unsubscribe is invalid/,
	);

	assert.equal(typeof listener, "function", "the malformed relay contract is observed at registration");
	assert.equal(FakePeer.instance.closed, true, "the native peer must be closed before any authenticated channel allocation");
	assert.equal(FakePeer.instance.dataChannel, undefined, "no native traffic channel listener may be registered");
});

test("node-datachannel peer stops native listener registration after a synchronous terminal state", async () => {
	const inbound = [];
	class SynchronouslyFailedRegistrationPeer extends FakePeer {
		onStateChange(listener) {
			super.onStateChange(listener);
			listener("failed");
		}
		onDataChannel(listener) {
			this.dataChannelRegistrationCount = (this.dataChannelRegistrationCount ?? 0) + 1;
			super.onDataChannel(listener);
		}
	}
	const signaling = {
		send() {},
		onMessage(listener) { inbound.push(listener); return () => inbound.splice(inbound.indexOf(listener), 1); },
		sign: (message) => message,
		verify: (message) => message,
	};
	const openChannels = createNodeDataChannelOpenChannels({ signaling, timeoutMs: 1_000 });

	await assert.rejects(
		openChannels({ PeerConnection: SynchronouslyFailedRegistrationPeer }, context()),
		/closed during native listener registration/,
	);

	assert.equal(FakePeer.instance.closed, true);
	assert.equal(FakePeer.instance.dataChannelRegistrationCount, undefined,
		"a terminal synchronous state must prevent later native listener registration");
	assert.equal(inbound.length, 0, "the authenticated signaling subscription must be released");
});

test("node-datachannel peer rejects oversized native local signaling before signing or relay send", async () => {
	const inbound = [];
	const outbound = [];
	let signCalls = 0;
	const signaling = {
		send: (message) => outbound.push(message),
		onMessage(listener) { inbound.push(listener); return () => inbound.splice(inbound.indexOf(listener), 1); },
		sign: (message) => { signCalls += 1; return message; },
		verify: (message) => message,
	};
	const openChannels = createNodeDataChannelOpenChannels({
		signaling,
		timeoutMs: 1_000,
		maxSignalBytes: 8,
	});
	const pending = openChannels({ PeerConnection: FakePeer }, context());

	FakePeer.instance.description("x".repeat(9), "answer");
	await assert.rejects(pending, /description is invalid or too large/);

	assert.equal(signCalls, 0, "invalid native SDP must not reach the signing boundary");
	assert.deepEqual(outbound, [], "invalid native SDP must not reach the relay");
	assert.equal(FakePeer.instance.closed, true);
	assert.equal(inbound.length, 0, "failure must release the signaling subscription");
});

test("node-datachannel peer rejects blank native local SDP before signing or relay send", async () => {
	const inbound = [];
	const outbound = [];
	let signCalls = 0;
	const signaling = {
		send: (message) => outbound.push(message),
		onMessage(listener) { inbound.push(listener); return () => inbound.splice(inbound.indexOf(listener), 1); },
		sign: (message) => { signCalls += 1; return message; },
		verify: (message) => message,
	};
	const openChannels = createNodeDataChannelOpenChannels({ signaling, timeoutMs: 1_000 });
	const pending = openChannels({ PeerConnection: FakePeer }, context());

	FakePeer.instance.description(" \t\r\n", "answer");
	await assert.rejects(pending, /description is invalid or too large/);

	assert.equal(signCalls, 0, "blank native SDP must not reach the signing boundary");
	assert.deepEqual(outbound, [], "blank native SDP must not reach the relay");
	assert.equal(FakePeer.instance.closed, true);
	assert.equal(inbound.length, 0, "failure must release the signaling subscription");
});

test("node-datachannel peer rejects malformed native local ICE before signing or relay send", async () => {
	const inbound = [];
	const outbound = [];
	let signCalls = 0;
	const signaling = {
		send: (message) => outbound.push(message),
		onMessage(listener) { inbound.push(listener); return () => inbound.splice(inbound.indexOf(listener), 1); },
		sign: (message) => { signCalls += 1; return message; },
		verify: (message) => message,
	};
	const openChannels = createNodeDataChannelOpenChannels({
		signaling,
		timeoutMs: 1_000,
		maxSignalBytes: 8,
	});
	const pending = openChannels({ PeerConnection: FakePeer }, context());

	FakePeer.instance.candidate("candidate", "0");
	await assert.rejects(pending, /candidate is invalid or too large/);

	assert.equal(signCalls, 0, "invalid native ICE must not reach the signing boundary");
	assert.deepEqual(outbound, [], "invalid native ICE must not reach the relay");
	assert.equal(FakePeer.instance.closed, true);
	assert.equal(inbound.length, 0, "failure must release the signaling subscription");
});

test("node-datachannel peer rejects blank ICE at native and authenticated signaling boundaries", async () => {
	const inbound = [];
	const outbound = [];
	let signCalls = 0;
	const signaling = {
		send: (message) => outbound.push(message),
		onMessage(listener) { inbound.push(listener); return () => inbound.splice(inbound.indexOf(listener), 1); },
		sign: (message) => { signCalls += 1; return message; },
		verify: (message) => message,
	};
	const openChannels = createNodeDataChannelOpenChannels({ signaling, timeoutMs: 1_000 });
	const nativePending = openChannels({ PeerConnection: FakePeer }, context());

	FakePeer.instance.candidate(" \t\r\n", "0");
	await assert.rejects(nativePending, /candidate is invalid or too large/);
	assert.equal(signCalls, 0, "blank native ICE must not reach the signing boundary");
	assert.deepEqual(outbound, [], "blank native ICE must not reach the relay");
	assert.equal(FakePeer.instance.closed, true);
	assert.equal(inbound.length, 0, "native failure must release the signaling subscription");

	const authenticatedInbound = [];
	const authenticatedSignaling = {
		send() {},
		onMessage(listener) {
			authenticatedInbound.push(listener);
			return () => authenticatedInbound.splice(authenticatedInbound.indexOf(listener), 1);
		},
		sign: (message) => message,
		verify: (message) => message,
	};
	const authenticatedPending = createNodeDataChannelOpenChannels({
		signaling: authenticatedSignaling,
		timeoutMs: 1_000,
	})({ PeerConnection: FakePeer }, context());
	authenticatedInbound[0]({ type: "ice", candidate: "", mid: "0" });
	await assert.rejects(authenticatedPending, /candidate is invalid or too large/);
	assert.equal(FakePeer.instance.closed, true);
	assert.equal(authenticatedInbound.length, 0, "authenticated failure must release the signaling subscription");
});

test("node-datachannel peer fails closed when the native binding emits SDP for the wrong negotiated role", async () => {
	const inbound = [];
	const outbound = [];
	let signCalls = 0;
	const signaling = {
		send: (message) => outbound.push(message),
		onMessage(listener) { inbound.push(listener); return () => inbound.splice(inbound.indexOf(listener), 1); },
		sign: (message) => { signCalls += 1; return message; },
		verify: (message) => message,
	};
	const openChannels = createNodeDataChannelOpenChannels({ signaling, timeoutMs: 1_000 });
	const pending = openChannels({ PeerConnection: FakePeer }, context());

	FakePeer.instance.description("unexpected-offer", "offer");
	await assert.rejects(pending, /SDP type inconsistent with its role/);

	assert.equal(signCalls, 0, "wrong-role native SDP must not reach the signing boundary");
	assert.deepEqual(outbound, [], "wrong-role native SDP must not reach the relay");
	assert.equal(FakePeer.instance.closed, true);
	assert.equal(inbound.length, 0, "failure must release the signaling subscription");
});

test("node-datachannel peer bounds native outbound signaling before asynchronous signing", async () => {
	const inbound = [];
	let releaseFirstSign;
	let signCalls = 0;
	const firstSign = new Promise((resolve) => { releaseFirstSign = resolve; });
	const signaling = {
		send() {},
		onMessage(listener) { inbound.push(listener); return () => inbound.splice(inbound.indexOf(listener), 1); },
		sign: async (message) => {
			signCalls += 1;
			await firstSign;
			return message;
		},
		verify: (message) => message,
	};
	const openChannels = createNodeDataChannelOpenChannels({
		signaling,
		timeoutMs: 1_000,
		maxQueuedOutboundSignals: 1,
	});
	const pending = openChannels({ PeerConnection: FakePeer }, context());

	FakePeer.instance.candidate("candidate-one", "0");
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(signCalls, 1, "only the first native callback may reach the asynchronous signer");
	FakePeer.instance.candidate("candidate-two", "1");
	await assert.rejects(pending, /outbound signaling queue limit reached/);

	assert.equal(FakePeer.instance.closed, true);
	assert.equal(inbound.length, 0, "overflow must release the authenticated signaling subscription");
	releaseFirstSign();
	await new Promise((resolve) => setImmediate(resolve));
});

test("node-datachannel peer fails closed when a post-setup native signer stalls", async () => {
	const inbound = [];
	const signaling = {
		send() {},
		onMessage(listener) { inbound.push(listener); return () => inbound.splice(inbound.indexOf(listener), 1); },
		sign: (message) => message.type === "ice" ? new Promise(() => {}) : message,
		verify: (message) => message,
	};
	const openChannels = createNodeDataChannelOpenChannels({
		signaling,
		timeoutMs: 1_000,
		outboundSignalTimeoutMs: 20,
	});
	const pending = openChannels({ PeerConnection: FakePeer }, context());
	inbound[0]({ type: "offer", sdp: "offer-sdp" });
	for (const label of ["control", "application", "terminal", "assets"]) FakePeer.instance.emitChannel(label);
	await pending;

	FakePeer.instance.candidate("post-setup-candidate", "0");
	await new Promise((resolve) => setTimeout(resolve, 40));

	assert.equal(FakePeer.instance.closed, true);
	assert.equal(inbound.length, 0, "a stalled signer must release the signaling subscription after setup");
});

test("node-datachannel peer fails closed when a post-setup relay send stalls", async () => {
	const inbound = [];
	const signaling = {
		send: (message) => message.type === "ice" ? new Promise(() => {}) : undefined,
		onMessage(listener) { inbound.push(listener); return () => inbound.splice(inbound.indexOf(listener), 1); },
		sign: (message) => message,
		verify: (message) => message,
	};
	const openChannels = createNodeDataChannelOpenChannels({
		signaling,
		timeoutMs: 1_000,
		outboundSignalTimeoutMs: 20,
	});
	const pending = openChannels({ PeerConnection: FakePeer }, context());
	inbound[0]({ type: "offer", sdp: "offer-sdp" });
	for (const label of ["control", "application", "terminal", "assets"]) FakePeer.instance.emitChannel(label);
	await pending;

	FakePeer.instance.candidate("post-setup-candidate", "0");
	await new Promise((resolve) => setTimeout(resolve, 40));

	assert.equal(FakePeer.instance.closed, true);
	assert.equal(inbound.length, 0, "a stalled relay send must release the signaling subscription after setup");
});

test("node-datachannel peer opener rejects unexpected channels", async () => {
	const inbound = [];
	class ReusedPeer extends FakePeer {
		constructor() {
			super();
			ReusedPeer.instance = this;
		}
	}
	const signaling = {
		send() {},
		onMessage(listener) { inbound.push(listener); return () => undefined; },
		sign: (message) => message,
		verify: (message) => message,
	};
	const openChannels = createNodeDataChannelOpenChannels({ signaling, timeoutMs: 100 });
	const pending = openChannels({ PeerConnection: ReusedPeer }, context());
	ReusedPeer.instance.emitChannel("unexpected");
	await assert.rejects(pending, /unexpected or duplicate/);
	assert.equal(ReusedPeer.instance.closed, true);
});

test("node-datachannel peer contains native callback listener failures and closes the candidate", async () => {
	const inbound = [];
	const signaling = {
		send() {},
		onMessage(listener) { inbound.push(listener); return () => inbound.splice(inbound.indexOf(listener), 1); },
		sign: (message) => message,
		verify: (message) => message,
	};
	const openChannels = createNodeDataChannelOpenChannels({ signaling, timeoutMs: 1_000 });
	const pending = openChannels({ PeerConnection: FakePeer }, context());
	const candidate = new FakeChannel("control");
	candidate.onClosed = () => { throw new Error("native lifecycle listener registration failed"); };

	assert.doesNotThrow(() => FakePeer.instance.dataChannel(candidate));
	await assert.rejects(pending, /native lifecycle listener registration failed/);

	assert.equal(candidate.open, false, "the callback channel must be closed during failed admission");
	assert.equal(FakePeer.instance.closed, true);
	assert.equal(inbound.length, 0, "the authenticated signaling subscription must be released");
});

test("node-datachannel peer fails closed when native channel state inspection throws during setup", async () => {
	const inbound = [];
	const signaling = {
		send() {},
		onMessage(listener) { inbound.push(listener); return () => inbound.splice(inbound.indexOf(listener), 1); },
		sign: (message) => message,
		verify: (message) => message,
	};
	const openChannels = createNodeDataChannelOpenChannels({ signaling, timeoutMs: 1_000 });
	const pending = openChannels({ PeerConnection: FakePeer }, context());

	inbound[0]({ type: "offer", sdp: "offer-sdp" });
	for (const label of ["control", "application", "terminal", "assets"]) {
		const channel = new FakeChannel(label);
		if (label === "assets") channel.isOpen = () => { throw new Error("native state probe failed"); };
		assert.doesNotThrow(() => FakePeer.instance.dataChannel(channel));
	}
	await assert.rejects(pending, /channel state inspection failed during setup/);

	assert.equal(FakePeer.instance.closed, true);
	assert.equal(inbound.length, 0, "the authenticated signaling subscription must be released");
});

test("node-datachannel peer opener rejects authenticated replayed descriptions", async () => {
	const inbound = [];
	const signaling = {
		send() {},
		onMessage(listener) { inbound.push(listener); return () => inbound.splice(inbound.indexOf(listener), 1); },
		sign: (message) => message,
		verify: (message) => message,
	};
	const openChannels = createNodeDataChannelOpenChannels({ signaling, timeoutMs: 1_000 });
	const pending = openChannels({ PeerConnection: FakePeer }, context());
	inbound[0]({ type: "offer", sdp: "offer-sdp" });
	inbound[0]({ type: "offer", sdp: "replayed-offer-sdp" });
	await assert.rejects(pending, /invalid or replayed/);
	assert.equal(FakePeer.instance.closed, true);
	assert.equal(inbound.length, 0);
});

test("node-datachannel peer defers authenticated ICE until its remote SDP and bounds that queue", async () => {
	const inbound = [];
	const signaling = {
		send() {},
		onMessage(listener) { inbound.push(listener); return () => inbound.splice(inbound.indexOf(listener), 1); },
		sign: (message) => message,
		verify: (message) => message,
	};
	const openChannels = createNodeDataChannelOpenChannels({
		signaling,
		timeoutMs: 1_000,
		maxPendingCandidates: 1,
	});
	const pending = openChannels({ PeerConnection: FakePeer }, context());
	inbound[0]({ type: "ice", candidate: "before-sdp", mid: "0" });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(FakePeer.instance.remoteCandidate, undefined);
	inbound[0]({ type: "offer", sdp: "offer-sdp" });
	for (const label of ["control", "application", "terminal", "assets"]) FakePeer.instance.emitChannel(label);
	await pending;
	assert.deepEqual(FakePeer.instance.remoteDescription, { sdp: "offer-sdp", type: "offer" });
	assert.deepEqual(FakePeer.instance.remoteCandidate, { candidate: "before-sdp", mid: "0" });

	const overflow = createNodeDataChannelOpenChannels({
		signaling,
		timeoutMs: 1_000,
		maxPendingCandidates: 1,
	})({ PeerConnection: FakePeer }, context());
	const overflowInbound = inbound.at(-1);
	overflowInbound({ type: "ice", candidate: "one", mid: "0" });
	overflowInbound({ type: "ice", candidate: "two", mid: "1" });
	await assert.rejects(overflow, /pending candidate limit reached/);
	assert.equal(FakePeer.instance.closed, true);
});

test("node-datachannel peer opener fails closed on an authenticated replayed ICE frame", async () => {
	const inbound = [];
	const signaling = {
		send() {},
		onMessage(listener) { inbound.push(listener); return () => inbound.splice(inbound.indexOf(listener), 1); },
		sign: (message) => message,
		verify: (message) => message,
	};
	const openChannels = createNodeDataChannelOpenChannels({ signaling, timeoutMs: 1_000 });
	const pending = openChannels({ PeerConnection: FakePeer }, context());
	inbound[0]({ type: "offer", sdp: "offer-sdp" });
	inbound[0]({ type: "ice", candidate: "candidate", mid: "0" });
	inbound[0]({ type: "ice", candidate: "candidate", mid: "0" });

	await assert.rejects(pending, /candidate is replayed/);
	assert.equal(FakePeer.instance.closed, true);
	assert.deepEqual(FakePeer.instance.remoteCandidate, { candidate: "candidate", mid: "0" });
	assert.equal(inbound.length, 0);
});

test("node-datachannel peer opener bounds distinct authenticated ICE after SDP acceptance", async () => {
	const inbound = [];
	const signaling = {
		send() {},
		onMessage(listener) { inbound.push(listener); return () => inbound.splice(inbound.indexOf(listener), 1); },
		sign: (message) => message,
		verify: (message) => message,
	};
	const openChannels = createNodeDataChannelOpenChannels({
		signaling,
		timeoutMs: 1_000,
		maxRemoteCandidates: 1,
	});
	const pending = openChannels({ PeerConnection: FakePeer }, context());
	inbound[0]({ type: "offer", sdp: "offer-sdp" });
	inbound[0]({ type: "ice", candidate: "first", mid: "0" });
	inbound[0]({ type: "ice", candidate: "second", mid: "1" });

	await assert.rejects(pending, /remote candidate limit reached/);
	assert.deepEqual(FakePeer.instance.remoteCandidate, { candidate: "first", mid: "0" });
	assert.equal(FakePeer.instance.closed, true);
	assert.equal(inbound.length, 0, "the signaling subscription must be released");
});

test("node-datachannel peer opener fails closed when verified signaling exceeds its byte limit", async () => {
	const inbound = [];
	const signaling = {
		send() {},
		onMessage(listener) { inbound.push(listener); return () => inbound.splice(inbound.indexOf(listener), 1); },
		sign: (message) => message,
		verify: (message) => message,
	};
	const openChannels = createNodeDataChannelOpenChannels({
		signaling,
		timeoutMs: 1_000,
		maxSignalBytes: 8,
	});
	const pending = openChannels({ PeerConnection: FakePeer }, context());
	inbound[0]({ type: "offer", sdp: "too-large" });
	await assert.rejects(pending, /description is invalid or too large/);
	assert.equal(FakePeer.instance.closed, true);
	assert.equal(FakePeer.instance.remoteDescription, undefined);
	assert.equal(inbound.length, 0);
});

test("node-datachannel peer opener rejects blank authenticated SDP before native delivery", async () => {
	const inbound = [];
	const signaling = {
		send() {},
		onMessage(listener) { inbound.push(listener); return () => inbound.splice(inbound.indexOf(listener), 1); },
		sign: (message) => message,
		verify: (message) => message,
	};
	const openChannels = createNodeDataChannelOpenChannels({ signaling, timeoutMs: 1_000 });
	const pending = openChannels({ PeerConnection: FakePeer }, context());
	inbound[0]({ type: "offer", sdp: "\n\t" });

	await assert.rejects(pending, /description is invalid or too large/);
	assert.equal(FakePeer.instance.remoteDescription, undefined, "blank SDP must not reach the native peer");
	assert.equal(FakePeer.instance.closed, true);
	assert.equal(inbound.length, 0, "failure must release the signaling subscription");
});

test("node-datachannel peer opener bounds asynchronous signaling verification", async () => {
	const inbound = [];
	let release;
	const verification = new Promise((resolve) => { release = resolve; });
	const signaling = {
		send() {},
		onMessage(listener) { inbound.push(listener); return () => inbound.splice(inbound.indexOf(listener), 1); },
		sign: (message) => message,
		verify: async (message) => {
			await verification;
			return message;
		},
	};
	const openChannels = createNodeDataChannelOpenChannels({
		signaling,
		timeoutMs: 1_000,
		maxQueuedSignals: 2,
	});
	const pending = openChannels({ PeerConnection: FakePeer }, context());
	inbound[0]({ type: "offer", sdp: "offer-one" });
	inbound[0]({ type: "ice", candidate: "candidate", mid: "0" });
	inbound[0]({ type: "ice", candidate: "candidate", mid: "1" });
	await assert.rejects(pending, /signaling queue limit reached/);
	assert.equal(FakePeer.instance.closed, true);
	assert.equal(inbound.length, 0);
	release();
});

test("node-datachannel offerer closes an untracked native channel when its label is malformed", async () => {
	const inbound = [];
	const created = [];
	class WrongLabelOffererPeer extends FakePeer {
		createDataChannel(label) {
			const channel = new FakeChannel(label === "terminal" ? "wrong-label" : label);
			created.push(channel);
			return channel;
		}
	}
	const signaling = {
		send() {},
		onMessage(listener) { inbound.push(listener); return () => inbound.splice(inbound.indexOf(listener), 1); },
		sign: (message) => message,
		verify: (message) => message,
	};
	const openChannels = createNodeDataChannelOpenChannels({ signaling, role: "offerer", timeoutMs: 1_000 });
	await assert.rejects(
		openChannels({ PeerConnection: WrongLabelOffererPeer }, context()),
		/wrong label/,
	);

	assert.equal(FakePeer.instance.closed, true);
	assert.equal(inbound.length, 0, "the authenticated signaling subscription must be released");
	assert.equal(created.length, 3);
	assert.equal(created.at(-1).open, false, "the malformed untracked native channel must be closed");
	assert.equal(created.slice(0, -1).every((channel) => channel.open === false), true);
});

test("node-datachannel offerer stops allocating lanes after a synchronous native close during setup", async () => {
	const inbound = [];
	const created = [];
	class SynchronouslyClosingOffererPeer extends FakePeer {
		createDataChannel(label) {
			const channel = new FakeChannel(label);
			created.push(channel);
			if (label === "control") {
				const register = channel.onClosed.bind(channel);
				channel.onClosed = (listener) => {
					register(listener);
					channel.close();
				};
			}
			return channel;
		}
	}
	const signaling = {
		send() {},
		onMessage(listener) { inbound.push(listener); return () => inbound.splice(inbound.indexOf(listener), 1); },
		sign: (message) => message,
		verify: (message) => message,
	};
	const openChannels = createNodeDataChannelOpenChannels({ signaling, role: "offerer", timeoutMs: 1_000 });

	await assert.rejects(
		openChannels({ PeerConnection: SynchronouslyClosingOffererPeer }, context()),
		/channel control closed during setup/,
	);

	assert.equal(created.length, 1, "no later traffic lanes may be allocated after teardown starts");
	assert.equal(created[0].open, false);
	assert.equal(FakePeer.instance.closed, true);
	assert.equal(inbound.length, 0, "the authenticated signaling subscription must be released");
});

test("node-datachannel peer failure after setup closes channels and releases signaling", async () => {
	const inbound = [];
	const signaling = {
		send() {},
		onMessage(listener) { inbound.push(listener); return () => inbound.splice(inbound.indexOf(listener), 1); },
		sign: (message) => message,
		verify: (message) => message,
	};
	const openChannels = createNodeDataChannelOpenChannels({ signaling, timeoutMs: 1_000 });
	const pending = openChannels({ PeerConnection: FakePeer }, context());
	inbound[0]({ type: "offer", sdp: "offer-sdp" });
	for (const label of ["control", "application", "terminal", "assets"]) FakePeer.instance.emitChannel(label);
	const channels = await pending;
	assert.equal(inbound.length, 1);
	FakePeer.instance.state("failed");
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(FakePeer.instance.closed, true);
	assert.equal(inbound.length, 0);
	assert.equal([...channels.values()].every((channel) => channel.open === false), true);
});

test("node-datachannel peer fails closed when any required traffic lane closes after setup", async () => {
	const inbound = [];
	const signaling = {
		send() {},
		onMessage(listener) { inbound.push(listener); return () => inbound.splice(inbound.indexOf(listener), 1); },
		sign: (message) => message,
		verify: (message) => message,
	};
	const openChannels = createNodeDataChannelOpenChannels({ signaling, timeoutMs: 1_000 });
	const pending = openChannels({ PeerConnection: FakePeer }, context());
	inbound[0]({ type: "offer", sdp: "offer-sdp" });
	for (const label of ["control", "application", "terminal", "assets"]) FakePeer.instance.emitChannel(label);
	const channels = await pending;

	channels.get("terminal").close();
	await new Promise((resolve) => setImmediate(resolve));

	assert.equal(FakePeer.instance.closed, true);
	assert.equal(inbound.length, 0, "the authenticated signaling subscription must be released");
	assert.equal([...channels.values()].every((channel) => channel.open === false), true);
});

test("a throwing signaling unsubscribe cannot escape a native failure callback or block peer cleanup", async () => {
	const inbound = [];
	let unsubscribeCalls = 0;
	const signaling = {
		send() {},
		onMessage(listener) {
			inbound.push(listener);
			return () => {
				unsubscribeCalls += 1;
				throw new Error("signaling unsubscribe failed");
			};
		},
		sign: (message) => message,
		verify: (message) => message,
	};
	const openChannels = createNodeDataChannelOpenChannels({ signaling, timeoutMs: 1_000 });
	const pending = openChannels({ PeerConnection: FakePeer }, context());
	inbound[0]({ type: "offer", sdp: "offer-sdp" });
	for (const label of ["control", "application", "terminal", "assets"]) FakePeer.instance.emitChannel(label);
	const channels = await pending;

	assert.doesNotThrow(() => FakePeer.instance.state("failed"));
	await new Promise((resolve) => setImmediate(resolve));

	assert.equal(unsubscribeCalls, 1);
	assert.equal(FakePeer.instance.closed, true);
	assert.equal([...channels.values()].every((channel) => channel.open === false), true);
});

test("node-datachannel peer never publishes an asynchronously signed answer after teardown", async () => {
	const inbound = [];
	const outbound = [];
	let releaseSign;
	const signing = new Promise((resolve) => { releaseSign = resolve; });
	const signaling = {
		send: (message) => outbound.push(message),
		onMessage(listener) { inbound.push(listener); return () => inbound.splice(inbound.indexOf(listener), 1); },
		sign: async (message) => {
			await signing;
			return message;
		},
		verify: (message) => message,
	};
	const openChannels = createNodeDataChannelOpenChannels({ signaling, timeoutMs: 1_000 });
	const pending = openChannels({ PeerConnection: FakePeer }, context());
	inbound[0]({ type: "offer", sdp: "offer-sdp" });
	await new Promise((resolve) => setImmediate(resolve));
	FakePeer.instance.state("failed");
	await assert.rejects(pending, /peer is failed/);

	releaseSign();
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(outbound, []);
	assert.equal(FakePeer.instance.closed, true);
});
