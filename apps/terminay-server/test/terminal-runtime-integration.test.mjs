import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import * as nodePty from "node-pty";
import { createEmbeddedServer, createStandaloneServer } from "../dist/index.js";
import { createNodePtyFactory, TerminalService } from "@terminay/server-core";

const decoder = new TextDecoder();

/**
 * Waits re-checked whenever something happens: `notify` is called for every
 * event a subscription or the terminal service delivers.
 */
function changes() {
  const checks = new Set();
  return {
    notify() {
      for (const check of [...checks]) check();
    },
    until(predicate) {
      return new Promise((resolve, reject) => {
        const check = () => {
          try {
            if (!predicate()) return;
          } catch (error) {
            checks.delete(check);
            reject(error);
            return;
          }
          checks.delete(check);
          resolve();
        };
        checks.add(check);
        check();
      });
    },
  };
}

function outputText(events) {
  return events
    .filter((event) => event.type === "output")
    .map((event) => decoder.decode(event.bytes))
    .join("");
}

test("standalone and embedded compositions create bounded server-owned real shells", async () => {
  for (const [runtimeMode, createServer] of [
    ["standalone", createStandaloneServer],
    ["embedded", createEmbeddedServer],
  ]) {
    const dataRoot = await mkdtemp(join(tmpdir(), `terminay-task8-${runtimeMode}-`));
    const shellMarker = `TASK8_${runtimeMode.toUpperCase()}`;
    const shellInput = `input-${runtimeMode}`;
    const shellScript = `printf '${shellMarker}_READY\\n'; read value; printf '${shellMarker}_ECHO:%s\\n' "$value"`;
    const spawnRecords = [];
    const ptyFactory = createNodePtyFactory({
      spawn(file, args, options) {
        spawnRecords.push({ file, args: [...args], options: { ...options } });
        return nodePty.spawn(file, [...args], options);
      },
    });
    let runtime;
    let session;
    const subscriptions = [];
    const changed = changes();

    try {
      runtime = createServer({
        serverId: `task8-${runtimeMode}`,
        serverVersion: "task8-test",
        dataRoot,
        platformPaths: {
          dataRoot,
          home: dataRoot,
          temp: dataRoot,
          configRoot: join(dataRoot, "config"),
          cacheRoot: join(dataRoot, "cache"),
          logRoot: join(dataRoot, "logs"),
        },
        serviceFactory: {
          create(context) {
            assert.equal(context.config.runtimeMode, runtimeMode);
            return {
              terminal: new TerminalService({
                serverId: context.config.serverId,
                ptyFactory,
              }),
            };
          },
        },
      });

      assert.equal(runtime.config.runtimeMode, runtimeMode);
      await runtime.start();
      const terminal = runtime.services.terminal;
      assert.ok(terminal instanceof TerminalService);
      // Output a detached session produces reaches no subscription, only the service.
      subscriptions.push({ close: terminal.onEvent(() => changed.notify()) });

      session = await terminal.createSession({
        projectId: `task8-project-${runtimeMode}`,
        sessionId: `task8-session-${runtimeMode}`,
        shellPath: "/bin/sh",
        args: ["-c", shellScript],
        cwd: process.cwd(),
        cols: 80,
        rows: 24,
      });
      assert.equal(session.identity.serverId, `task8-${runtimeMode}`);
      assert.equal(session.identity.projectId, `task8-project-${runtimeMode}`);
      assert.equal(session.identity.sessionId, `task8-session-${runtimeMode}`);
      assert.equal(session.status, "running");
      assert.equal(runtime.diagnostics().terminal.runningSessions, 1);
      assert.deepEqual(spawnRecords, [{
        file: "/bin/sh",
        args: ["-c", shellScript],
        options: { name: undefined, cols: 80, rows: 24, cwd: process.cwd() },
      }]);
      assert.deepEqual(Object.keys(spawnRecords[0].options).sort(), ["cols", "cwd", "name", "rows"]);

      const readAuthorization = { ...session.identity, clientId: `${runtimeMode}-reader`, scope: "read" };
      const writeAuthorization = { ...session.identity, clientId: `${runtimeMode}-writer`, scope: "write" };
      const events = [];
      const initial = terminal.subscribe(session.identity, {
        authorization: readAuthorization,
        fromPosition: 0,
        onEvent: (event) => {
          events.push(event);
          changed.notify();
        },
      });
      subscriptions.push(initial);
      await changed.until(() => outputText(events).includes(`${shellMarker}_READY`));

      const detachedAt = session.outputPosition;
      initial.close();
      assert.equal(session.status, "running");
      await terminal.input(session.identity, `${shellInput}\n`, writeAuthorization);
      await changed.until(() => session.outputPosition > detachedAt);

      const resumedEvents = [];
      const resumed = terminal.subscribe(session.identity, {
        authorization: readAuthorization,
        fromPosition: detachedAt,
        onEvent: (event) => {
          resumedEvents.push(event);
          changed.notify();
        },
      });
      subscriptions.push(resumed);
      await changed.until(
        () => session.status === "exited" && outputText([...events, ...resumedEvents]).includes(`${shellMarker}_ECHO:${shellInput}`),
      );

      assert.equal(session.exit.reason, "exit");
      assert.ok(resumedEvents.some((event) => event.type === "output" && event.replay));
      assert.equal(runtime.diagnostics().terminal.runningSessions, 0);
    } finally {
      for (const subscription of subscriptions) subscription.close();
      await runtime?.stop().catch(() => undefined);
      await rm(dataRoot, { recursive: true, force: true });
    }
  }
});
