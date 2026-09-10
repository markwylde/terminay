import test from "node:test";
import assert from "node:assert/strict";
import {
  CLIENT_SERVER_COMPATIBILITY,
  DEFAULT_PROTOCOL_LIMITS,
  FEATURE_CAPABILITIES,
  decodeFrame,
  encodeFrame,
} from "@terminay/protocol";
import {
  compatibilityToConnectionStatus,
  connectWithCompatibility,
  ConnectionProfileStore,
  TerminayClient,
} from "../dist/index.js";

/** A transport that answers exactly one hello with a scripted reply. */
function createRespondingTransport(reply) {
  const frames = [];
  const queued = [];
  let waiter;
  let closed = false;
  const push = (envelope) => {
    const frame = encodeFrame(envelope, new Uint8Array(), DEFAULT_PROTOCOL_LIMITS);
    if (waiter !== undefined) {
      const resolve = waiter;
      waiter = undefined;
      resolve({ value: frame, done: false });
      return;
    }
    queued.push(frame);
  };
  return {
    state: "open",
    frames,
    queuedBytes: 0,
    bufferedBytes: 0,
    incoming: {
      [Symbol.asyncIterator]() {
        return {
          next() {
            if (queued.length > 0) return Promise.resolve({ value: queued.shift(), done: false });
            if (closed) return Promise.resolve({ value: undefined, done: true });
            return new Promise((resolve) => { waiter = resolve; });
          },
          return() {
            closed = true;
            waiter?.({ value: undefined, done: true });
            waiter = undefined;
            return Promise.resolve({ value: undefined, done: true });
          },
        };
      },
    },
    open: async () => {},
    async send(frame) {
      const decoded = decodeFrame(frame);
      frames.push(decoded);
      if (decoded.envelope.type === "client_hello") push(reply(decoded.envelope));
    },
    waitForWritable: async () => {},
    async close() {
      closed = true;
      waiter?.({ value: undefined, done: true });
      waiter = undefined;
    },
    onStateChange: () => () => {},
  };
}

function serverHello(clientHello, capabilities, protocolVersion = 1) {
  return {
    type: "server_hello",
    protocolVersion,
    serverId: "server-a",
    serverVersion: "3.0.0",
    clientId: clientHello.clientId,
    capabilities,
    limits: DEFAULT_PROTOCOL_LIMITS,
    authScope: "write",
  };
}

const REQUIRED = [...CLIENT_SERVER_COMPATIBILITY.requiredCapabilities];
const OPTIONAL = [...CLIENT_SERVER_COMPATIBILITY.optionalCapabilities];

test("a hello carries the required and optional capabilities the bundle declares", async () => {
  const transport = createRespondingTransport((hello) =>
    serverHello(hello, [...REQUIRED, ...OPTIONAL]),
  );
  const client = new TerminayClient({ transport, clientId: "client-a" });
  const result = await connectWithCompatibility(client);
  const hello = transport.frames[0].envelope;
  for (const capability of [...REQUIRED, ...OPTIONAL])
    assert.equal(hello.capabilities.includes(capability), true, capability);
  assert.equal(result.compatibility.state, "compatible");
  assert.equal(result.hello.serverId, "server-a");
  assert.equal(compatibilityToConnectionStatus(result.compatibility), "connected");
  await client.close();
});

test("a server missing an optional capability is degraded but still connected", async () => {
  const transport = createRespondingTransport((hello) =>
    serverHello(hello, [...REQUIRED, ...OPTIONAL.filter((capability) => capability !== FEATURE_CAPABILITIES.git)]),
  );
  const client = new TerminayClient({ transport, clientId: "client-a" });
  const { compatibility } = await connectWithCompatibility(client);
  assert.equal(compatibility.state, "degraded");
  assert.deepEqual(compatibility.missingOptionalCapabilities, [FEATURE_CAPABILITIES.git]);
  assert.equal(compatibilityToConnectionStatus(compatibility), "connected");
  await client.close();
});

test("a server missing a required capability is incompatible and names the server", async () => {
  const transport = createRespondingTransport((hello) =>
    serverHello(hello, REQUIRED.filter((capability) => capability !== FEATURE_CAPABILITIES.files)),
  );
  const client = new TerminayClient({ transport, clientId: "client-a" });
  const { compatibility } = await connectWithCompatibility(client);
  assert.equal(compatibility.state, "incompatible");
  assert.equal(compatibility.reason, "capability");
  assert.equal(compatibility.upgrade, "server");
  assert.deepEqual(compatibility.missingRequiredCapabilities, [FEATURE_CAPABILITIES.files]);
  assert.equal(compatibilityToConnectionStatus(compatibility), "incompatible");
  await client.close();
});

test("a server above the client protocol range asks for a client upgrade", async () => {
  const transport = createRespondingTransport((hello) =>
    serverHello(hello, [...REQUIRED, ...OPTIONAL], 4),
  );
  const client = new TerminayClient({ transport, clientId: "client-a" });
  const { compatibility } = await connectWithCompatibility(client);
  assert.equal(compatibility.state, "incompatible");
  assert.equal(compatibility.reason, "protocol");
  assert.equal(compatibility.upgrade, "client");
  await client.close();
});

test("a refused hello resolves into a typed incompatible result, not an opaque throw", async () => {
  const transport = createRespondingTransport(() => ({
    type: "incompatible_version",
    supportedMin: 0,
    supportedMax: 0,
    requestedMin: 1,
    requestedMax: 1,
    error: { code: "incompatible", message: "no shared protocol version" },
  }));
  const client = new TerminayClient({ transport, clientId: "client-a" });
  const result = await connectWithCompatibility(client);
  assert.equal(result.hello, undefined);
  assert.equal(result.compatibility.state, "incompatible");
  assert.equal(result.compatibility.reason, "protocol");
  assert.equal(result.compatibility.upgrade, "server");
  assert.deepEqual(result.compatibility.serverProtocol, { minimum: 0, maximum: 0 });
  await client.close();
});

test("the attached set runs many servers while the primary stays the selected one", () => {
  const store = new ConnectionProfileStore();
  const remote = store.remember({
    id: "prod",
    serverId: "srv-prod",
    label: "Production",
    origin: "https://prod.example.test",
  });
  assert.deepEqual(store.snapshot().attachedProfileIds, ["local"]);
  assert.equal(store.isAttached(remote.id), false);

  store.attach(remote.id);
  assert.equal(store.isAttached(remote.id), true);
  assert.deepEqual(store.snapshot().attachedProfileIds, ["local", "prod"]);
  assert.deepEqual(store.attachedProfiles.map((profile) => profile.id), ["local", "prod"]);
  assert.equal(store.snapshot().currentProfileId, "local");

  // Selecting an attached server moves the primary without detaching anything.
  store.select(remote.id);
  assert.deepEqual(store.snapshot().attachedProfileIds, ["prod", "local"]);
  assert.throws(() => store.detach("prod"), /primary/u);

  store.detach("local");
  assert.deepEqual(store.snapshot().attachedProfileIds, ["prod"]);
  assert.equal(store.isAttached("local"), false);

  assert.throws(() => store.attach("unknown"), /unknown connection profile/u);
});

test("forgetting or archiving a profile detaches it", () => {
  const store = new ConnectionProfileStore();
  store.remember({ id: "a", serverId: "srv-a", label: "A", origin: "https://a.example.test" });
  store.remember({ id: "b", serverId: "srv-b", label: "B", origin: "https://b.example.test" });
  store.attach("a");
  store.attach("b");
  store.archive("a");
  assert.equal(store.isAttached("a"), false);
  assert.throws(() => store.attach("a"), /archived/u);
  store.forget("b", true);
  assert.equal(store.isAttached("b"), false);
  assert.deepEqual(store.snapshot().attachedProfileIds, ["local"]);
});
