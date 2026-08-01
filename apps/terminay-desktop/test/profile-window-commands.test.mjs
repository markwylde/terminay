import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createDesktopProfileWindowCommandClient,
  createDesktopRendererActions,
} from "../dist/index.js";

test("profile/window renderer capability has no compatibility or main-process import", async () => {
  const source = await readFile(new URL("../src/renderer/profileWindowCommands.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\.\.\/compatibility\//u);
  assert.doesNotMatch(source, /\.\.\/main\//u);
  assert.doesNotMatch(source, /electron|ipcRenderer|contextBridge/u);
});

test("profile window facade derives the target only from bound host context", async () => {
  const actions = [];
  const client = createDesktopProfileWindowCommandClient({
    getContext: async () => ({ connectionId: "remote:bound" }),
    openWindow: async (action) => { actions.push(action); },
  });

  await client.openCurrentProfileWindow({ workspaceViewId: "view-settings" });
  assert.deepEqual(actions, [{
    type: "window.open",
    profileId: "remote:bound",
    workspaceViewId: "view-settings",
  }]);
  assert.equal("openProfileWindow" in client, false);
  assert.equal("requestAction" in client, false);
});

test("profile window facade dispatches only the validated snapshots", async () => {
  const actions = [];
  let workspaceViewReads = 0;
  let connectionReads = 0;
  const client = createDesktopProfileWindowCommandClient({
    getContext: async () => ({
      get connectionId() {
        connectionReads += 1;
        return connectionReads === 1 ? "remote:bound" : "remote:other";
      },
    }),
    openWindow: async (action) => { actions.push(action); },
  });

  await client.openCurrentProfileWindow({
    get workspaceViewId() {
      workspaceViewReads += 1;
      return workspaceViewReads === 1 ? "view-bound" : "view-other";
    },
  });

  assert.equal(connectionReads, 1);
  assert.equal(workspaceViewReads, 1);
  assert.deepEqual(actions, [{
    type: "window.open",
    profileId: "remote:bound",
    workspaceViewId: "view-bound",
  }]);
});

test("renderer action rejects a profile outside its bound connection before bridge dispatch", async () => {
  const calls = [];
  const actions = createDesktopRendererActions({
    getContext: async () => ({
      version: 1,
      windowId: "window-a",
      connectionId: "remote:bound",
      profileLabel: "Bound",
      capabilities: { nativeWindows: true },
      presentation: {},
    }),
    requestAction: async (action, options) => { calls.push({ action, options }); },
  });

  await assert.rejects(actions.openWindow({ serverId: "remote:other", view: "view-a" }), /bound connection/);
  assert.deepEqual(calls, []);
  await actions.openWindow({ serverId: "remote:bound", view: "view-a" });
  assert.deepEqual(calls, [{
    action: { type: "window.open", profileId: "remote:bound", workspaceViewId: "view-a" },
    options: { userGesture: true },
  }]);
});
