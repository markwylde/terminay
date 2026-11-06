import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BOT_IMAGE_ONLY_EXCERPT, BotMessageStore } from "../dist/botService/messages.js";
import { BotNotificationFeed } from "../dist/botService/notificationFeed.js";

const bot = "abc123def456";
const other = "abc123def457";
const execution = "a".repeat(24);
const png = Buffer.from("89504e470d0a1a0a", "hex");

function setup(t) {
  const root = mkdtempSync(join(tmpdir(), "bot-notify-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const clock = { now: 1_000 };
  return { root, clock, store: new BotMessageStore(root, () => clock.now) };
}

/** A feed whose sink records what the manager would hold per bot. */
function fed(store, bots = [bot]) {
  const held = new Map();
  const feed = new BotNotificationFeed(store, (botId, posts) => {
    if (posts === undefined) held.delete(botId);
    else held.set(botId, posts);
  }, () => bots);
  return { held, feed };
}

let key = 0;
const say = (store, author, text, attachments = []) =>
  store.post(bot, author, text, author === "bot" ? execution : null, `k-${++key}`, attachments);

test("a fresh bot starts with nothing to acknowledge", (t) => {
  const { store } = setup(t);
  assert.equal(store.acknowledgedSequence(bot), 0);
  assert.equal(store.unacknowledged(bot), undefined);
});

test("one bot post raises one notification; three posts still one, covering three", (t) => {
  const { store, clock } = setup(t);
  const { held } = fed(store);
  const first = say(store, "bot", "Build is green");
  assert.deepEqual(held.get(bot), { count: 1, body: "Build is green", raisedAt: 1_000, throughSequence: first.sequence });
  clock.now = 2_000;
  say(store, "bot", "Second");
  const third = say(store, "bot", "Third\nline");
  assert.deepEqual(held.get(bot), { count: 3, body: "Third line", raisedAt: 2_000, throughSequence: third.sequence });
});

test("a user post raises nothing and acknowledges what came before it", (t) => {
  const { store } = setup(t);
  const { held } = fed(store);
  say(store, "bot", "Waiting for you");
  assert.equal(held.get(bot)?.count, 1);
  say(store, "user", "Thanks");
  assert.equal(held.has(bot), false);
  assert.equal(store.unacknowledged(bot), undefined);
});

test("acknowledgement is monotonic, clamped, and writes nothing when it does not advance", (t) => {
  const { store } = setup(t);
  const a = say(store, "bot", "one");
  const b = say(store, "bot", "two");
  let writes = 0;
  store.on("acknowledged", () => writes++);
  assert.equal(store.acknowledge(bot, a.sequence), a.sequence);
  assert.equal(store.unacknowledged(bot).count, 1);
  assert.equal(store.acknowledge(bot, 0), a.sequence, "a stale acknowledgement does not move it back");
  assert.equal(store.acknowledge(bot, a.sequence), a.sequence);
  assert.equal(writes, 1);
  assert.equal(store.acknowledge(bot, 10_000), store.sequence(bot), "clamped to what exists");
  assert.equal(store.unacknowledged(bot), undefined);
  assert.throws(() => store.acknowledge(bot, -1), /Invalid sequence/);
  assert.ok(b.sequence <= store.sequence(bot));
});

test("an acknowledgement racing a newer post leaves the newer post's notification", (t) => {
  const { store } = setup(t);
  const { held } = fed(store);
  const seen = say(store, "bot", "seen");
  say(store, "bot", "not yet delivered");
  store.acknowledge(bot, seen.sequence);
  assert.deepEqual([held.get(bot).count, held.get(bot).body], [1, "not yet delivered"]);
});

test("editing the latest post updates the excerpt; deleting it falls back; deleting the only post removes it", (t) => {
  const { store } = setup(t);
  const { held } = fed(store);
  const first = say(store, "bot", "Build is green");
  const second = say(store, "bot", "Deploying");
  store.edit(bot, second.id, 1, "Deployed");
  assert.deepEqual([held.get(bot).count, held.get(bot).body], [2, "Deployed"]);
  store.edit(bot, second.id, 2, null);
  assert.deepEqual([held.get(bot).count, held.get(bot).body], [1, "Build is green"]);
  store.edit(bot, first.id, 1, null);
  assert.equal(held.has(bot), false);
});

test("clearing removes the notification and a later post raises a new one", (t) => {
  const { store } = setup(t);
  const { held } = fed(store);
  say(store, "bot", "before");
  store.clear(bot);
  assert.equal(held.has(bot), false);
  say(store, "bot", "after");
  assert.deepEqual([held.get(bot).count, held.get(bot).body], [1, "after"]);
});

test("a post with images and no text says it sent an image", (t) => {
  const { store } = setup(t);
  const { held } = fed(store);
  say(store, "bot", "", [store.putAttachment(bot, "screen.png", png)]);
  assert.equal(held.get(bot).body, BOT_IMAGE_ONLY_EXCERPT);
});

test("deleting a bot removes its notification and leaves other bots alone", (t) => {
  const { store } = setup(t);
  const { held } = fed(store, [bot, other]);
  say(store, "bot", "mine");
  store.post(other, "bot", "theirs", execution, "o-1");
  store.removeBot(bot);
  assert.equal(held.has(bot), false);
  assert.equal(held.get(other).body, "theirs");
});

test("a restart restores an unacknowledged notification and not an acknowledged one", (t) => {
  const { root, store } = setup(t);
  say(store, "bot", "waiting");
  store.post(other, "bot", "read", execution, "o-1");
  store.acknowledge(other, store.sequence(other));
  const restarted = new BotMessageStore(root);
  const { held } = fed(restarted, [bot, other]);
  assert.equal(held.get(bot).body, "waiting");
  assert.equal(held.has(other), false);
});

test("history written before acknowledgement existed raises nothing", (t) => {
  const { root, store } = setup(t);
  say(store, "bot", "old news");
  const path = join(root, bot, "messages.json");
  const state = JSON.parse(readFileSync(path, "utf8"));
  delete state.acknowledged;
  writeFileSync(path, JSON.stringify(state));
  const upgraded = new BotMessageStore(root);
  const { held } = fed(upgraded);
  assert.equal(held.has(bot), false);
  upgraded.post(bot, "bot", "new", execution, "after-upgrade");
  assert.deepEqual([held.get(bot).count, held.get(bot).body], [1, "new"]);
});

test("a closed feed hears nothing more", (t) => {
  const { store } = setup(t);
  const { held, feed } = fed(store);
  feed.close();
  say(store, "bot", "after close");
  assert.equal(held.has(bot), false);
});
