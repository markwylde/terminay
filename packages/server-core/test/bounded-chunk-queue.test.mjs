import test from "node:test";
import assert from "node:assert/strict";
import { BoundedChunkQueue } from "../dist/index.js";

const chunk = (text) => ({ bytes: new TextEncoder().encode(text) });
const text = (bytes) => new TextDecoder().decode(bytes);
const held = (queue) => [...queue].map((entry) => text(entry.bytes));

test("an empty queue holds nothing and reads an empty tail", () => {
  const queue = new BoundedChunkQueue(8, "within-bound");
  assert.equal(queue.byteLength, 0);
  assert.equal(queue.length, 0);
  assert.equal(queue.first, undefined);
  assert.deepEqual(held(queue), []);
  assert.equal(queue.readTail().byteLength, 0);
});

test("the bound must be a positive safe integer", () => {
  for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])
    assert.throws(() => new BoundedChunkQueue(invalid, "within-bound"), RangeError);
});

test("within-bound evicts whole chunks until the total fits", () => {
  const queue = new BoundedChunkQueue(8, "within-bound");
  queue.push(chunk("aaaa"));
  queue.push(chunk("bbbb"));
  assert.deepEqual(held(queue), ["aaaa", "bbbb"]);
  assert.equal(queue.byteLength, 8);

  // One byte over: the whole oldest chunk leaves, so less than the bound stays.
  queue.push(chunk("c"));
  assert.deepEqual(held(queue), ["bbbb", "c"]);
  assert.equal(queue.byteLength, 5);
  assert.equal(text(queue.first.bytes), "bbbb");
});

test("within-bound drops a chunk that alone exceeds the bound", () => {
  const queue = new BoundedChunkQueue(4, "within-bound");
  queue.push(chunk("ab"));
  queue.push(chunk("oversized"));
  assert.equal(queue.length, 0);
  assert.equal(queue.byteLength, 0);
  assert.equal(queue.first, undefined);
  queue.push(chunk("ok"));
  assert.deepEqual(held(queue), ["ok"]);
});

test("cover-bound keeps the oldest chunk until later chunks cover the bound", () => {
  const queue = new BoundedChunkQueue(8, "cover-bound");
  queue.push(chunk("aaaa"));
  queue.push(chunk("bbbb"));
  queue.push(chunk("c"));
  // Dropping "aaaa" would leave five bytes, fewer than the bound.
  assert.deepEqual(held(queue), ["aaaa", "bbbb", "c"]);
  assert.equal(text(queue.readTail()), "aaabbbbc");

  queue.push(chunk("ddd"));
  // "bbbb" + "c" + "ddd" cover the bound on their own.
  assert.deepEqual(held(queue), ["bbbb", "c", "ddd"]);
  assert.equal(text(queue.readTail()), "bbbbcddd");
});

test("cover-bound keeps the tail of a chunk larger than the bound", () => {
  const queue = new BoundedChunkQueue(4, "cover-bound");
  queue.push(chunk("xy"));
  queue.push(chunk("0123456789"));
  assert.deepEqual(held(queue), ["0123456789"]);
  assert.equal(text(queue.readTail()), "6789");
});

test("a tail read is exactly the most recent bytes, in order, and can be narrower than the bound", () => {
  const queue = new BoundedChunkQueue(16, "cover-bound");
  for (const part of ["ab", "cde", "f", "ghij"]) queue.push(chunk(part));
  assert.equal(text(queue.readTail()), "abcdefghij");
  assert.equal(text(queue.readTail(5)), "fghij");
  assert.equal(text(queue.readTail(0)), "");
  // Reading does not consume.
  assert.equal(text(queue.readTail()), "abcdefghij");
});

test("totals, order and tail stay exact across many evictions and compactions", () => {
  for (const retention of ["within-bound", "cover-bound"]) {
    const bound = 256;
    const queue = new BoundedChunkQueue(bound, retention);
    let produced = "";
    for (let index = 0; index < 5_000; index += 1) {
      const part = `[${index}]${"z".repeat(index % 7)}`;
      produced += part;
      queue.push(chunk(part));

      const retained = held(queue).join("");
      assert.equal(queue.byteLength, retained.length, retention);
      assert.ok(produced.endsWith(retained), retention);
      if (retention === "within-bound") assert.ok(queue.byteLength <= bound);
      else assert.equal(text(queue.readTail()), produced.slice(-bound));
    }
    // Thousands were evicted; the queue holds a handful, not their slots.
    assert.ok(queue.length < 100, `${retention} retained ${queue.length} chunks`);
  }
});
