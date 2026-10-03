import test from "node:test";
import assert from "node:assert/strict";
import {
  encodeHolderFrame,
  HolderFrameDecoder,
  HolderProtocolError,
  selectHolderProtocolVersion,
  SESSION_HOLDER_MAX_FRAME_BYTES,
  SESSION_HOLDER_MAX_PAYLOAD_BYTES,
  SESSION_HOLDER_PROTOCOL_VERSIONS,
} from "../dist/index.js";

const hex = (bytes) => Buffer.from(bytes).toString("hex");
const fromHex = (text) => new Uint8Array(Buffer.from(text, "hex"));

test("a holder frame round-trips its header and payload", () => {
  const payload = new Uint8Array([0, 1, 2, 255]);
  const frame = encodeHolderFrame({ type: "data", sessionId: "s1", position: 42 }, payload);
  const decoded = new HolderFrameDecoder().push(frame);
  assert.equal(decoded.length, 1);
  assert.deepEqual(decoded[0].message, { type: "data", sessionId: "s1", position: 42 });
  assert.deepEqual([...decoded[0].payload], [0, 1, 2, 255]);
});

test("frames split across arbitrary chunk boundaries decode in order", () => {
  const stream = Buffer.concat([
    encodeHolderFrame({ type: "list", id: 1 }),
    encodeHolderFrame({ type: "write", sessionId: "s1" }, new TextEncoder().encode("ls\n")),
    encodeHolderFrame({ type: "drain" }),
  ]);
  for (const size of [1, 2, 3, 7, stream.byteLength]) {
    const decoder = new HolderFrameDecoder();
    const messages = [];
    for (let offset = 0; offset < stream.byteLength; offset += size)
      for (const frame of decoder.push(stream.subarray(offset, offset + size)))
        messages.push([frame.message.type, new TextDecoder().decode(frame.payload)]);
    assert.deepEqual(messages, [["list", ""], ["write", "ls\n"], ["drain", ""]]);
    assert.equal(decoder.pendingBytes, 0);
  }
});

test("a truncated frame yields nothing until its remaining bytes arrive", () => {
  const frame = encodeHolderFrame({ type: "list", id: 9 });
  const decoder = new HolderFrameDecoder();
  assert.deepEqual(decoder.push(frame.subarray(0, frame.byteLength - 1)), []);
  assert.equal(decoder.pendingBytes, frame.byteLength - 1);
  assert.equal(decoder.push(frame.subarray(frame.byteLength - 1)).length, 1);
});

test("an oversized payload is refused when encoding", () => {
  assert.throws(
    () => encodeHolderFrame({ type: "write", sessionId: "s1" }, new Uint8Array(SESSION_HOLDER_MAX_PAYLOAD_BYTES + 1)),
    HolderProtocolError,
  );
});

test("a frame length outside the bound is refused before it is buffered", () => {
  const oversized = new Uint8Array(4);
  new DataView(oversized.buffer).setUint32(0, SESSION_HOLDER_MAX_FRAME_BYTES + 1, false);
  assert.throws(() => new HolderFrameDecoder().push(oversized), HolderProtocolError);
  const undersized = new Uint8Array(4);
  new DataView(undersized.buffer).setUint32(0, 3, false);
  assert.throws(() => new HolderFrameDecoder().push(undersized), HolderProtocolError);
});

test("a header that overruns its frame, is not JSON, or has no type is refused", () => {
  const overrun = new Uint8Array(8);
  const view = new DataView(overrun.buffer);
  view.setUint32(0, 4, false);
  view.setUint32(4, 10, false);
  assert.throws(() => new HolderFrameDecoder().push(overrun), HolderProtocolError);

  const raw = (text) => {
    const header = new TextEncoder().encode(text);
    const frame = new Uint8Array(8 + header.byteLength);
    const frameView = new DataView(frame.buffer);
    frameView.setUint32(0, 4 + header.byteLength, false);
    frameView.setUint32(4, header.byteLength, false);
    frame.set(header, 8);
    return frame;
  };
  assert.throws(() => new HolderFrameDecoder().push(raw("{not json")), HolderProtocolError);
  assert.throws(() => new HolderFrameDecoder().push(raw('{"id":1}')), HolderProtocolError);
  assert.throws(() => new HolderFrameDecoder().push(raw("[1]")), HolderProtocolError);
});

test("version selection picks the highest version both sides speak", () => {
  assert.equal(selectHolderProtocolVersion([1]), 1);
  assert.equal(selectHolderProtocolVersion([1, 2, 3], [1, 2]), 2);
  assert.equal(selectHolderProtocolVersion([3, 1], [1, 3]), 3);
  assert.equal(selectHolderProtocolVersion([2], [1]), undefined);
  assert.equal(selectHolderProtocolVersion([], [1]), undefined);
  assert.equal(selectHolderProtocolVersion([0, -1, 1.5, "1"], [1]), undefined);
});

/**
 * A holder outlives the server build that started it, so a newer server must
 * be able to produce exactly these bytes for as long as version 1 is spoken.
 * If this test fails, the change belongs in a new protocol version.
 */
test("protocol version 1 wire bytes are pinned", () => {
  assert.deepEqual(SESSION_HOLDER_PROTOCOL_VERSIONS.includes(1), true);
  const pinned = [
    [
      { type: "hello", credential: "c", versions: [1] },
      undefined,
      "00000034000000307b2274797065223a2268656c6c6f222c2263726564656e7469616c223a2263222c2276657273696f6e73223a5b315d7d",
    ],
    [{ type: "list", id: 1 }, undefined, "0000001a000000167b2274797065223a226c697374222c226964223a317d"],
    [
      { type: "write", sessionId: "s" },
      new Uint8Array([0x6c, 0x73, 0x0a]),
      "00000027000000207b2274797065223a227772697465222c2273657373696f6e4964223a2273227d6c730a",
    ],
    [
      { type: "data", sessionId: "s", position: 7 },
      new Uint8Array([0x41]),
      "000000310000002c7b2274797065223a2264617461222c2273657373696f6e4964223a2273222c22706f736974696f6e223a377d41",
    ],
    [
      { type: "setLimit", limitMs: null },
      undefined,
      "00000026000000227b2274797065223a227365744c696d6974222c226c696d69744d73223a6e756c6c7d",
    ],
    [
      { type: "exit", sessionId: "s", outputPosition: 9, exitCode: 0, signal: null, at: 5 },
      undefined,
      "00000058000000547b2274797065223a2265786974222c2273657373696f6e4964223a2273222c226f7574707574506f736974696f6e223a392c2265786974436f6465223a302c227369676e616c223a6e756c6c2c226174223a357d",
    ],
  ];
  for (const [message, payload, expected] of pinned) {
    assert.equal(hex(encodeHolderFrame(message, payload)), expected, message.type);
    const [decoded] = new HolderFrameDecoder().push(fromHex(expected));
    assert.deepEqual(decoded.message, message, message.type);
    assert.deepEqual([...decoded.payload], [...(payload ?? [])], message.type);
  }
});
