import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  APP_WINDOW_OPERATIONS,
  AppWindowAttachmentWriter,
  AppWindowService,
  keptAttachmentName,
  MAX_APP_WINDOW_ATTACHMENT_PART_BYTES,
  MAX_APP_WINDOW_ATTACHMENTS,
} from "../dist/index.js";

const PART = MAX_APP_WINDOW_ATTACHMENT_PART_BYTES;
const scratch = async () => join(await mkdtemp(join(tmpdir(), "terminay-attachments-test-")), "terminay-attachments");
const bytes = (length, fill = 7) => new Uint8Array(length).fill(fill);
const listed = async (directory) => readdir(directory).catch(() => []);
/** Removal after a refusal is not awaited by the request that caused it. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 20));

async function setup(overrides = {}) {
  const directory = await scratch();
  const typed = [];
  const asked = [];
  let holder = "client-desktop";
  const windows = new AppWindowService({
    isPresentationHolder: (_window, context) => context.clientId === holder,
    deliverMessage: async (window, text) => { typed.push({ terminal: window.terminalSessionId, text }); },
    attachments: {
      directory,
      authorize: async (window, text, attachments) => { asked.push({ window: window.id, text, attachments }); },
      type: async (window, text) => { typed.push({ terminal: window.terminalSessionId, text }); },
      ...overrides,
    },
  });
  const window = windows.open({ terminalSessionId: "session-1", projectId: "project-1", title: "Questions", source: { kind: "agent" }, html: "<p>q</p>" });
  const { commands } = windows.operations();
  const request = (payload, body = new Uint8Array(), clientId = "client-desktop", connectionId = "c1") =>
    ({ envelope: { payload }, body, context: { clientId, connectionId, authScope: "write", signal: new AbortController().signal } });
  const begin = (payload, ...rest) => commands[APP_WINDOW_OPERATIONS.messageBegin](request({ windowId: window.id, ...payload }, undefined, ...rest));
  const part = (uploadId, file, offset, body, ...rest) => commands[APP_WINDOW_OPERATIONS.messagePart](request({ windowId: window.id, uploadId, file, offset }, body, ...rest));
  const finish = (uploadId, ...rest) => commands[APP_WINDOW_OPERATIONS.messageFinish](request({ windowId: window.id, uploadId }, undefined, ...rest));
  const cancel = (uploadId, ...rest) => commands[APP_WINDOW_OPERATIONS.messageCancel](request({ windowId: window.id, uploadId }, undefined, ...rest));
  return { windows, window, directory, typed, asked, begin, part, finish, cancel, setHolder: (next) => { holder = next; } };
}

async function rejectsWith(promise, code) {
  await assert.rejects(promise, (error) => { assert.equal(error.code, code); return true; });
}

test("an offered name is reduced to a safe file name that keeps its extension", () => {
  assert.equal(keptAttachmentName("photo.jpg"), "photo.jpg");
  assert.equal(keptAttachmentName("../../.ssh/authorized_keys"), "authorized_keys");
  assert.equal(keptAttachmentName("C:\\Users\\mark\\a b (1).PNG"), "a_b_1_.PNG");
  assert.equal(keptAttachmentName(".."), "file");
  assert.equal(keptAttachmentName(".bashrc"), "bashrc");
  assert.equal(keptAttachmentName("日本語"), "file");
  assert.equal(keptAttachmentName("\u0000\n;rm -rf ~;.sh"), "rm_-rf_.sh");
  const long = keptAttachmentName(`${"n".repeat(300)}.jpeg`);
  assert.equal(long.length, 80);
  assert.ok(long.endsWith(".jpeg"));
});

test("a message with a photo is asked about once, written to the scratch directory, and typed with its path", async () => {
  const { directory, typed, asked, begin, part, finish, windows } = await setup();
  const photo = bytes(PART + 1000, 9);
  const { uploadId } = await begin({ text: "2. Use the new logo? Yes", attachments: [{ name: "logo.png", size: photo.byteLength }] });
  assert.equal(asked.length, 1);
  assert.deepEqual(asked[0].attachments, [{ name: "logo.png", size: photo.byteLength }]);
  // Nothing is on disk or in the terminal until bytes arrive and the message is finished.
  assert.deepEqual(await listed(directory), []);
  assert.deepEqual(typed, []);
  assert.deepEqual(await part(uploadId, 0, 0, photo.subarray(0, PART)), { windowId: windows.list()[0].id, received: PART });
  await part(uploadId, 0, PART, photo.subarray(PART));
  const result = await finish(uploadId);
  // The view is told it was delivered and nothing about where.
  assert.deepEqual(Object.keys(result), ["windowId"]);
  const [name] = await listed(directory);
  assert.match(name, /^[0-9a-f]{16}-logo\.png$/);
  const path = join(directory, name);
  assert.deepEqual(typed, [{ terminal: "session-1", text: `2. Use the new logo? Yes\nAttached: ${path}` }]);
  assert.deepEqual(new Uint8Array(await readFile(path)), photo);
  const mode = (await stat(path)).mode & 0o777;
  assert.equal(mode, 0o600);
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
  assert.equal(windows.list()[0].state, "minimised");
});

test("a view cannot choose where a file lands", async () => {
  const { directory, begin, part, finish, typed } = await setup();
  const { uploadId } = await begin({ text: "", attachments: [{ name: "../../../../escaped.txt", size: 3 }, { name: "/etc/passwd", size: 0 }] });
  await part(uploadId, 0, 0, bytes(3));
  await finish(uploadId);
  const names = (await listed(directory)).sort((a, b) => a.slice(17).localeCompare(b.slice(17)));
  assert.equal(names.length, 2);
  assert.match(names[0], /^[0-9a-f]{16}-escaped\.txt$/);
  assert.match(names[1], /^[0-9a-f]{16}-passwd$/);
  // Attachments alone are a message: one line per file and no text.
  assert.equal(typed.length, 1);
  assert.deepEqual(typed[0].text.split("\n").map((line) => line.replace(/[0-9a-f]{16}-/u, "")).sort(), [`Attached: ${join(directory, "escaped.txt")}`, `Attached: ${join(directory, "passwd")}`]);
  assert.deepEqual(await listed(join(directory, "..")), ["terminay-attachments"]);
});

test("attachments are refused from an observer, from a minimised window, in excess, and when malformed", async () => {
  const { directory, begin, windows, window, asked, typed } = await setup();
  const one = [{ name: "a.txt", size: 1 }];
  await rejectsWith(begin({ text: "hi", attachments: one }, "client-phone"), "forbidden");
  await rejectsWith(begin({ text: "hi", attachments: Array.from({ length: MAX_APP_WINDOW_ATTACHMENTS + 1 }, () => one[0]) }), "validation");
  await rejectsWith(begin({ text: "hi", attachments: [] }), "validation");
  await rejectsWith(begin({ text: "hi" }), "validation");
  await rejectsWith(begin({ text: "hi", attachments: [{ name: "", size: 1 }] }), "validation");
  await rejectsWith(begin({ text: "hi", attachments: [{ name: "a", size: -1 }] }), "validation");
  await rejectsWith(begin({ text: "hi", attachments: [{ name: "a", size: 1.5 }] }), "validation");
  await rejectsWith(begin({ text: "hi", attachments: [{ name: "n".repeat(256), size: 1 }] }), "validation");
  await rejectsWith(begin({ text: "bad\u001b[2J", attachments: one }), "validation");
  windows.operations();
  await windows.operations().commands[APP_WINDOW_OPERATIONS.setState]({ envelope: { payload: { windowId: window.id, state: "minimised" } }, body: new Uint8Array(), context: { clientId: "client-desktop", connectionId: "c1", signal: new AbortController().signal } });
  await rejectsWith(begin({ text: "hi", attachments: one }), "forbidden");
  assert.deepEqual(asked, []);
  assert.deepEqual(typed, []);
  assert.deepEqual(await listed(directory), []);
});

test("a declined or forbidden message uploads nothing and leaves the window able to send again", async () => {
  let refuse = true;
  const { directory, begin, part, finish, typed } = await setup({
    authorize: async () => { if (refuse) throw Object.assign(new Error("Window Messages is set to Never Allow"), { code: "forbidden" }); },
  });
  await rejectsWith(begin({ text: "hi", attachments: [{ name: "a.txt", size: 1 }] }), "forbidden");
  assert.deepEqual(await listed(directory), []);
  refuse = false;
  const { uploadId } = await begin({ text: "hi", attachments: [{ name: "a.txt", size: 1 }] });
  // One message at a time: a second cannot begin while the first is arriving.
  await rejectsWith(begin({ text: "again", attachments: [{ name: "b.txt", size: 1 }] }), "resource");
  await part(uploadId, 0, 0, bytes(1));
  await finish(uploadId);
  assert.equal(typed.length, 1);
});

test("parts must arrive in order and within the declared size, or the whole message is dropped", async () => {
  for (const attempt of [
    async ({ part, uploadId }) => part(uploadId, 0, 5, bytes(5)),
    async ({ part, uploadId }) => part(uploadId, 0, 0, bytes(11)),
    async ({ part, uploadId }) => part(uploadId, 1, 0, bytes(1)),
    async ({ part, uploadId }) => part(uploadId, 2, 0, bytes(1)),
    async ({ part, uploadId }) => part(uploadId, 0, 0, bytes(0)),
    async ({ part, uploadId }) => part(uploadId, 0, 0, bytes(PART + 1)),
    async ({ part, uploadId }) => part(uploadId, 0.5, 0, bytes(1)),
    async ({ part, uploadId, finish }) => { await part(uploadId, 0, 0, bytes(4)); return finish(uploadId); },
  ]) {
    const context = await setup();
    const { uploadId } = await context.begin({ text: "hi", attachments: [{ name: "a.bin", size: 10 }, { name: "b.bin", size: 1 }] });
    await rejectsWith(attempt({ ...context, uploadId }), "validation");
    await settled();
    assert.deepEqual(await listed(context.directory), []);
    assert.deepEqual(context.typed, []);
    // The upload is gone: nothing more can be added to it.
    await rejectsWith(context.part(uploadId, 0, 0, bytes(1)), "not_found");
    // And the window can send again.
    const again = await context.begin({ text: "retry", attachments: [{ name: "c.bin", size: 0 }] });
    await context.finish(again.uploadId);
    assert.equal(context.typed.length, 1);
  }
});

test("an upload belongs to the connection that began it and ends when control moves", async () => {
  const { directory, begin, part, finish, cancel, typed, setHolder } = await setup();
  const { uploadId } = await begin({ text: "hi", attachments: [{ name: "a.bin", size: 4 }] });
  await part(uploadId, 0, 0, bytes(2));
  assert.equal((await listed(directory)).length, 1);
  // Another client, or the same client on another connection, cannot continue or cancel it.
  await rejectsWith(part(uploadId, 0, 2, bytes(2), "client-phone", "c2"), "not_found");
  await rejectsWith(finish(uploadId, "client-desktop", "c9"), "not_found");
  await cancel(uploadId, "client-phone", "c2");
  assert.equal((await listed(directory)).length, 1);
  // Control moves to the phone: the desktop's next part ends the upload.
  setHolder("client-phone");
  await rejectsWith(part(uploadId, 0, 2, bytes(2)), "forbidden");
  await settled();
  assert.deepEqual(await listed(directory), []);
  assert.deepEqual(typed, []);
});

test("closing the window, ending the session, losing the connection, or cancelling removes a partial file and types nothing", async () => {
  const endings = [
    ({ windows, window }) => windows.close("session-1", window.id),
    ({ windows }) => windows.endSession("session-1"),
    ({ windows }) => windows.endAll(),
    ({ windows }) => windows.closeConnection("c1"),
    ({ cancel, uploadId }) => cancel(uploadId),
  ];
  for (const end of endings) {
    const context = await setup();
    const { uploadId } = await context.begin({ text: "hi", attachments: [{ name: "a.bin", size: 4 }] });
    await context.part(uploadId, 0, 0, bytes(2));
    assert.equal((await listed(context.directory)).length, 1);
    await end({ ...context, uploadId });
    await settled();
    assert.deepEqual(await listed(context.directory), []);
    assert.deepEqual(context.typed, []);
  }
  // Another connection closing leaves an upload alone.
  const context = await setup();
  const { uploadId } = await context.begin({ text: "hi", attachments: [{ name: "a.bin", size: 2 }] });
  context.windows.closeConnection("c2");
  await context.part(uploadId, 0, 0, bytes(2));
  await context.finish(uploadId);
  assert.equal(context.typed.length, 1);
});

test("a message that cannot be typed leaves no file behind", async () => {
  const { directory, begin, part, finish } = await setup({ type: async () => { throw Object.assign(new Error("terminal is gone"), { code: "unavailable" }); } });
  const { uploadId } = await begin({ text: "hi", attachments: [{ name: "a.bin", size: 2 }, { name: "b.bin", size: 2 }] });
  await part(uploadId, 0, 0, bytes(2));
  await part(uploadId, 1, 0, bytes(2));
  await rejectsWith(finish(uploadId), "unavailable");
  await settled();
  assert.deepEqual(await listed(directory), []);
});

test("a file that cannot be written drops the message and what was already written", async () => {
  const { directory, begin, part, typed } = await setup();
  const { uploadId } = await begin({ text: "hi", attachments: [{ name: "a.bin", size: 2 }, { name: "b.bin", size: 2 }] });
  await part(uploadId, 0, 0, bytes(2));
  // The directory disappears from under the second file.
  const [first] = await listed(directory);
  const { rm } = await import("node:fs/promises");
  await rm(directory, { recursive: true });
  await writeFile(directory, "not a directory");
  await rejectsWith(part(uploadId, 1, 0, bytes(2)), "resource");
  await settled();
  assert.ok(first);
  assert.deepEqual(typed, []);
});

test("delivered attachments outlive their window and their terminal session", async () => {
  const { directory, begin, part, finish, windows, window } = await setup();
  const { uploadId } = await begin({ text: "hi", attachments: [{ name: "kept.txt", size: 2 }] });
  await part(uploadId, 0, 0, bytes(2));
  await finish(uploadId);
  windows.close("session-1", window.id);
  windows.endSession("session-1");
  windows.endAll();
  await settled();
  assert.equal((await listed(directory)).length, 1);
});

test("a large file arrives whole without any part exceeding the bound", async () => {
  const { directory, begin, part, finish } = await setup();
  const size = PART * 20 + 123;
  const { uploadId } = await begin({ text: "video", attachments: [{ name: "clip.mp4", size }] });
  for (let offset = 0; offset < size; offset += PART)
    await part(uploadId, 0, offset, bytes(Math.min(PART, size - offset), offset / PART));
  await finish(uploadId);
  const [name] = await listed(directory);
  const written = await readFile(join(directory, name));
  assert.equal(written.byteLength, size);
  assert.equal(written[0], 0);
  assert.equal(written[size - 1], 20);
});

test("without attachments configured a message with files is unavailable and a plain message still works", async () => {
  const typed = [];
  const windows = new AppWindowService({ isPresentationHolder: () => true, deliverMessage: async (_window, text) => { typed.push(text); } });
  const window = windows.open({ terminalSessionId: "s", projectId: "p", title: "t", source: { kind: "agent" }, html: "<p>x</p>" });
  const { commands } = windows.operations();
  const context = { clientId: "c", connectionId: "c1", signal: new AbortController().signal };
  await rejectsWith(commands[APP_WINDOW_OPERATIONS.messageBegin]({ envelope: { payload: { windowId: window.id, text: "hi", attachments: [{ name: "a", size: 1 }] } }, body: new Uint8Array(), context }), "unavailable");
  await commands[APP_WINDOW_OPERATIONS.message]({ envelope: { payload: { windowId: window.id, text: "hi" } }, body: new Uint8Array(), context });
  assert.deepEqual(typed, ["hi"]);
});

test("the scratch directory must be a real directory: a link someone left in its place is refused", async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-attachments-link-"));
  const elsewhere = join(root, "elsewhere");
  await mkdir(elsewhere);
  const directory = join(root, "terminay-attachments");
  await symlink(elsewhere, directory);
  const writer = new AppWindowAttachmentWriter(directory, [{ name: "a.txt", size: 1 }]);
  await assert.rejects(writer.write(0, 0, bytes(1)));
  assert.deepEqual(await listed(elsewhere), []);
});
