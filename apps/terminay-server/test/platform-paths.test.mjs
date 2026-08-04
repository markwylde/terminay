import assert from "node:assert/strict";
import test from "node:test";
import { createEmbeddedServer, createStandaloneServer } from "../dist/index.js";

const pathSnapshot = {
  dataRoot: "/srv/terminay/data",
  home: "/srv/terminay/home",
  temp: "/srv/terminay/tmp",
  configRoot: "/srv/terminay/config",
  cacheRoot: "/srv/terminay/cache",
  logRoot: "/srv/terminay/log",
};

for (const [runtimeMode, createServer] of [["standalone", createStandaloneServer], ["embedded", createEmbeddedServer]]) {
  test(`${runtimeMode} service factories receive an immutable platform-path snapshot`, () => {
    const input = { ...pathSnapshot };
    let received;
    const runtime = createServer({
      serverId: `${runtimeMode}-paths`,
      serverVersion: "1.0.0",
      dataRoot: input.dataRoot,
      platformPaths: input,
      serviceFactory: {
        create(context) {
          received = context;
          return {};
        },
      },
    });

    input.home = "/caller-mutated-home";
    assert.deepEqual(received.paths, pathSnapshot);
    assert.equal(Object.isFrozen(received.paths), true);
    assert.equal(Object.isFrozen(received.config), true);
    assert.equal(received.config.platformPaths, received.paths);
    assert.deepEqual(runtime.config.platformPaths, pathSnapshot);
    assert.throws(() => { received.paths.home = "/service-mutated-home"; }, TypeError);
  });
}

test("platform path/data-root mismatches fail before a service factory runs", () => {
  let factoryCalls = 0;
  assert.throws(() => createEmbeddedServer({
    serverId: "mismatched-paths",
    serverVersion: "1.0.0",
    dataRoot: "/srv/terminay/other-data",
    platformPaths: pathSnapshot,
    serviceFactory: {
      create() {
        factoryCalls += 1;
        return {};
      },
    },
  }), /does not match/);
  assert.equal(factoryCalls, 0);
});
