import test from "node:test";
import assert from "node:assert/strict";
import {
	ChannelFragmentReassembler,
	encodeChannelFragments,
	encodeFrame,
	FRAGMENT_HEADER_BYTES,
	isChannelFragment,
	MAX_CONCURRENT_FRAGMENT_TRANSFERS,
	nextChannelTransferId,
} from "../dist/index.js";

const maxMessageBytes = 4096;

function reassembler(maxFrameBytes = 8 * 1024 * 1024) {
	return new ChannelFragmentReassembler({ maxFrameBytes });
}

test("a frame that fits the channel is sent whole and passes straight through", () => {
	const frame = encodeFrame({ type: "query", queryId: "query-a", operation: "files.tasks", payload: {} });
	const messages = encodeChannelFragments(frame, maxMessageBytes, 1);
	assert.equal(messages.length, 1);
	assert.equal(messages[0], frame);
	assert.equal(isChannelFragment(frame), false);
	assert.deepEqual(reassembler().accept(frame), { kind: "frame", frame });
});

test("an oversized frame reassembles byte for byte", () => {
	const body = new Uint8Array(64 * 1024).map((_, index) => index % 253);
	const frame = encodeFrame(
		{ type: "query_result", queryId: "query-a", ok: true, result: { truncated: false }, bodyLength: body.byteLength },
		body,
	);
	const messages = encodeChannelFragments(frame, maxMessageBytes, 7);
	assert.equal(messages.length, Math.ceil(frame.byteLength / (maxMessageBytes - FRAGMENT_HEADER_BYTES)));
	for (const message of messages) {
		assert.equal(isChannelFragment(message), true);
		assert.equal(message.byteLength <= maxMessageBytes, true);
	}
	const receiver = reassembler();
	const admitted = messages.map((message) => receiver.accept(message));
	assert.deepEqual(admitted.slice(0, -1).map((entry) => entry.kind), messages.slice(0, -1).map(() => "partial"));
	const last = admitted.at(-1);
	assert.equal(last.kind, "frame");
	assert.deepEqual(last.frame, frame);
	assert.equal(receiver.bufferedBytes, 0);
	assert.equal(receiver.openTransfers, 0);
});

test("interleaved transfers and unfragmented frames reassemble independently", () => {
	const first = new Uint8Array(9000).fill(1);
	const second = new Uint8Array(9000).fill(2);
	const left = encodeChannelFragments(first, maxMessageBytes, 1);
	const right = encodeChannelFragments(second, maxMessageBytes, 2);
	const plain = new Uint8Array([9, 9, 9]);
	const receiver = reassembler();
	const frames = [];
	for (let index = 0; index < left.length; index += 1) {
		for (const message of [left[index], right[index], plain]) {
			const admitted = receiver.accept(message);
			if (admitted.kind === "frame") frames.push(admitted.frame);
		}
	}
	assert.equal(frames.filter((frame) => frame.byteLength === 3).length, left.length);
	assert.deepEqual(frames.find((frame) => frame[0] === 1), first);
	assert.deepEqual(frames.find((frame) => frame[0] === 2), second);
});

test("a fragment that breaks the transfer's order or budget is rejected", () => {
	const frame = new Uint8Array(9000).fill(3);
	const messages = encodeChannelFragments(frame, maxMessageBytes, 3);

	const skipped = reassembler();
	skipped.accept(messages[0]);
	assert.throws(() => skipped.accept(messages[2]), /out of order/u);
	assert.equal(skipped.openTransfers, 0);

	const unopened = reassembler();
	assert.throws(() => unopened.accept(messages[1]), /out of order/u);

	const tiny = reassembler(4096);
	tiny.accept(messages[0]);
	assert.throws(() => tiny.accept(messages[1]), /exceeds the frame limit/u);

	const wrongVersion = Uint8Array.from(messages[0]);
	wrongVersion[4] = 2;
	assert.throws(() => reassembler().accept(wrongVersion), /version is unsupported/u);
});

test("a restarted transfer replaces the abandoned one and a crowded receiver evicts the oldest", () => {
	const frame = new Uint8Array(9000).fill(4);
	const messages = encodeChannelFragments(frame, maxMessageBytes, 5);
	const receiver = reassembler();
	receiver.accept(messages[0]);
	receiver.accept(messages[1]);
	// The sender failed part way through and started the transfer again.
	receiver.accept(messages[0]);
	assert.equal(receiver.openTransfers, 1);
	for (let index = 1; index < messages.length; index += 1) {
		const admitted = receiver.accept(messages[index]);
		if (index === messages.length - 1) assert.deepEqual(admitted.frame, frame);
	}

	// A transfer the sender abandoned is evicted by a newer one rather than
	// failing a lane that is otherwise healthy.
	const crowded = reassembler();
	for (let transfer = 0; transfer < MAX_CONCURRENT_FRAGMENT_TRANSFERS; transfer += 1) {
		crowded.accept(encodeChannelFragments(frame, maxMessageBytes, transfer)[0]);
	}
	assert.equal(crowded.openTransfers, MAX_CONCURRENT_FRAGMENT_TRANSFERS);
	const newest = encodeChannelFragments(frame, maxMessageBytes, MAX_CONCURRENT_FRAGMENT_TRANSFERS);
	assert.deepEqual(crowded.accept(newest[0]), { kind: "partial" });
	assert.equal(crowded.openTransfers, MAX_CONCURRENT_FRAGMENT_TRANSFERS);
	for (let index = 1; index < newest.length; index += 1) {
		const admitted = crowded.accept(newest[index]);
		if (index === newest.length - 1) assert.deepEqual(admitted.frame, frame);
	}
	// The evicted transfer's own bytes left the buffer with it.
	assert.equal(crowded.bufferedBytes, (MAX_CONCURRENT_FRAGMENT_TRANSFERS - 1) * (maxMessageBytes - FRAGMENT_HEADER_BYTES));
});

test("transfer ids advance and wrap inside the header field", () => {
	assert.equal(nextChannelTransferId(0), 1);
	assert.equal(nextChannelTransferId(0xffff), 0);
	assert.equal(nextChannelTransferId(-1), 0);
	assert.throws(() => encodeChannelFragments(new Uint8Array(10), maxMessageBytes, 0x1_0000), /transfer id is invalid/u);
	assert.throws(() => encodeChannelFragments(new Uint8Array(10), 64, 0), /too small to fragment/u);
	assert.throws(() => encodeChannelFragments(new Uint8Array(), maxMessageBytes, 0), /non-empty/u);
});
