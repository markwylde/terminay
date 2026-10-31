import test from "node:test";
import assert from "node:assert/strict";
import { sessionHolderAddress, windowsPipeName } from "../dist/index.js";

const generation = "0123456789abcdef";
const ada = "S-1-5-21-1004336348-1177238915-682003330-1001";
const bob = "S-1-5-21-1004336348-1177238915-682003330-1002";
const root = "C:\\Users\\ada\\AppData\\Roaming\\Terminay";
const address = (overrides = {}) =>
  sessionHolderAddress({ dataRoot: root, generation, platform: "win32", userSid: ada, ...overrides });

test("a Windows holder listens on a pipe named for the user, the data root, and the generation", () => {
  assert.match(address(), /^\\\\\.\\pipe\\terminay-holder-[0-9a-f]{24}-0123456789abcdef$/);
  assert.equal(address(), address(), "one user and data root always resolve to one name");
  assert.notEqual(address({ userSid: bob }), address(), "two users never share a pipe");
  assert.notEqual(address({ dataRoot: "D:\\Terminay" }), address(), "two data roots never share a pipe");
  assert.notEqual(address({ generation: "fedcba9876543210" }), address());
});

test("Windows data roots compare without case and accept either separator", () => {
  assert.equal(address({ dataRoot: "c:/users/ADA/AppData/Roaming/Terminay" }), address());
});

test("a Windows address refuses a missing or malformed SID and generation", () => {
  assert.throws(() => address({ userSid: undefined }), /user SID/);
  assert.throws(() => address({ userSid: "ada" }), /SID is invalid/);
  assert.throws(() => address({ generation: "../x" }), /generation is invalid/);
  assert.throws(() => windowsPipeName("control", { userSid: "S-1", dataRoot: root }), /SID is invalid/);
});

test("elsewhere the holder listens on the socket under the data root", () => {
  assert.equal(
    sessionHolderAddress({ dataRoot: "/var/lib/terminay", generation, platform: "linux" }),
    `/var/lib/terminay/session-holder/${generation}.sock`,
  );
});
