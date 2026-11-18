import assert from "node:assert/strict";
import test from "node:test";
import { allowedWebOrigins, parseServerCliOptions } from "../dist/cliOptions.js";

function parse(argv = [], env = {}) {
  return parseServerCliOptions(argv, env);
}

test("loopback HTTP web origins allow only equivalent loopback hosts on the same port", () => {
  const expected = [
    "http://localhost:8080",
    "http://127.0.0.1:8080",
    "http://[::1]:8080",
  ];
  assert.deepEqual(allowedWebOrigins("http://localhost:8080"), expected);
  assert.deepEqual(allowedWebOrigins("http://127.0.0.1:8080"), expected);
  assert.deepEqual(allowedWebOrigins("http://[::1]:8080"), expected);
});

test("non-loopback and HTTPS web origins remain exact", () => {
  assert.deepEqual(allowedWebOrigins("https://web.terminay.com"), [
    "https://web.terminay.com",
  ]);
  assert.deepEqual(allowedWebOrigins("https://localhost:8080"), [
    "https://localhost:8080",
  ]);
  assert.deepEqual(allowedWebOrigins("http://server.example.test:8080"), [
    "http://server.example.test:8080",
  ]);
});

test("a server is not exposed and uses the production hosted endpoints unless configured", () => {
  const options = parse();
  assert.equal(options.hostedEndpoints.appServer, "https://app.terminay.com");
  assert.equal(options.hostedEndpoints.sessionServer, "https://<session>.terminay.com");
  assert.deepEqual(options.exposeModes, []);
  assert.equal(options.directOrigin, undefined);
  for (const off of ["off", "disabled", ""]) {
    assert.deepEqual(parse(["--expose", off].slice(0, off === "" ? 0 : 2), { TERMINAY_EXPOSE: off }).exposeModes, []);
  }
});

test("exposure modes are parsed in a stable order and reject unknown names", () => {
  assert.deepEqual(parse(["--expose", "hosted"]).exposeModes, ["hosted"]);
  assert.deepEqual(
    parse(["--expose", "direct", "--direct-origin", "https://box.example.test:8443"]).exposeModes,
    ["direct"],
  );
  assert.deepEqual(
    parse(["--expose", "direct,hosted", "--direct-origin", "https://box.example.test"]).exposeModes,
    ["hosted", "direct"],
  );
  assert.deepEqual(
    parse(["--expose", "hosted, hosted"]).exposeModes,
    ["hosted"],
  );
  assert.throws(() => parse(["--expose", "public"]), /--expose accepts off, hosted, direct/u);
});

test("hosted endpoints are configured as an App Server and a Session Server", () => {
  const preview = parse([
    "--app-server",
    "https://app-pr123.dev.terminay.com",
    "--session-server",
    "https://<session>-pr123.dev.terminay.com",
  ]).hostedEndpoints;
  assert.equal(preview.appServer, "https://app-pr123.dev.terminay.com");
  assert.equal(preview.sessionServer, "https://<session>-pr123.dev.terminay.com");
  const loopback = parse([
    "--app-server",
    "localhost:8443",
    "--session-server",
    "<session>.localhost:8443",
  ]).hostedEndpoints;
  assert.equal(loopback.appServer, "http://localhost:8443");
  assert.equal(loopback.sessionServer, "http://<session>.localhost:8443");
});

test("invalid hosted endpoints fail before any listener opens and name the option", () => {
  assert.throws(() => parse(["--app-server", "https://app.terminay.com/relay"]), /^Error: --app-server: .*no path/u);
  assert.throws(() => parse(["--session-server", "https://dev.<session>.terminay.com"]), /^Error: --session-server: .*leftmost label/u);
  assert.throws(() => parse(["--session-server", "http://<session>.terminay.com"]), /^Error: --session-server: .*HTTPS/u);
});

test("a leftover production hosted domain is ignored and any other fails loudly", () => {
  assert.equal(parse(["--hosted-domain", "terminay.com"]).hostedEndpoints.appServer, "https://app.terminay.com");
  assert.equal(parse([], { TERMINAY_HOSTED_DOMAIN: "terminay.com" }).hostedEndpoints.appServer, "https://app.terminay.com");
  assert.throws(() => parse(["--hosted-domain", "example.test"]), /--app-server and --session-server/u);
  assert.throws(() => parse([], { TERMINAY_HOSTED_DOMAIN: "localhost:8443" }), /TERMINAY_APP_SERVER/u);
});

test("a direct origin must be an exact HTTPS origin", () => {
  assert.equal(
    parse(["--direct-origin", "https://box.example.test:8443"]).directOrigin,
    "https://box.example.test:8443",
  );
  assert.throws(() => parse(["--direct-origin", "http://box.example.test"]), /must use HTTPS/u);
  assert.throws(() => parse(["--direct-origin", "https://box.example.test/signal"]), /exact origin/u);
  assert.throws(() => parse(["--direct-origin", "not a url"]), /must be an HTTPS URL/u);
});

test("direct exposure without an origin fails before any listener opens", () => {
  assert.throws(
    () => parse(["--expose", "direct"]),
    /--expose direct requires --direct-origin \(TERMINAY_DIRECT_ORIGIN\)/u,
  );
  assert.throws(
    () => parse([], { TERMINAY_EXPOSE: "hosted,direct" }),
    /--expose direct requires --direct-origin/u,
  );
});

test("command-line exposure configuration takes precedence over the environment", () => {
  const environment = {
    TERMINAY_APP_SERVER: "https://app.env.example.test",
    TERMINAY_SESSION_SERVER: "https://<session>.env.example.test",
    TERMINAY_EXPOSE: "hosted",
    TERMINAY_DIRECT_ORIGIN: "https://env.example.test",
  };
  assert.deepEqual(parse([], environment).exposeModes, ["hosted"]);
  assert.equal(parse([], environment).hostedEndpoints.appServer, "https://app.env.example.test");
  assert.equal(parse([], environment).directOrigin, "https://env.example.test");

  const overridden = parse(
    [
      "--app-server",
      "https://app.flag.example.test",
      "--session-server",
      "https://<session>.flag.example.test",
      "--expose",
      "off",
      "--direct-origin",
      "https://flag.example.test",
    ],
    environment,
  );
  assert.equal(overridden.hostedEndpoints.appServer, "https://app.flag.example.test");
  assert.equal(overridden.hostedEndpoints.sessionServer, "https://<session>.flag.example.test");
  assert.deepEqual(overridden.exposeModes, []);
  assert.equal(overridden.directOrigin, "https://flag.example.test");
});

test("an advertised ICE address is parsed from the flag and the environment", () => {
  const flag = parse(["--advertise-address", "127.0.0.1:51000"]);
  assert.deepEqual({ ...flag.advertiseAddress }, { host: "127.0.0.1", port: 51000 });

  const environment = parse([], { TERMINAY_WEBRTC_ADVERTISE_ADDRESS: "192.168.2.10:51000" });
  assert.deepEqual({ ...environment.advertiseAddress }, { host: "192.168.2.10", port: 51000 });

  // The flag wins, as every other option in this parser does.
  const both = parse(["--advertise-address", "127.0.0.1:51000"], {
    TERMINAY_WEBRTC_ADVERTISE_ADDRESS: "192.168.2.10:52000",
  });
  assert.deepEqual({ ...both.advertiseAddress }, { host: "127.0.0.1", port: 51000 });
});

test("a bracketed IPv6 address is accepted", () => {
  const parsed = parse(["--advertise-address", "[::1]:51000"]);
  assert.deepEqual({ ...parsed.advertiseAddress }, { host: "::1", port: 51000 });
});

test("no advertised address leaves the option unset", () => {
  assert.equal(parse().advertiseAddress, undefined);
  // The daemon CLI clears the address by writing an empty variable into the
  // environment file, so an empty variable must read as unset rather than as a
  // malformed address. An empty *flag* value stays a usage error, as it is for
  // every other option in this parser.
  assert.equal(parse([], { TERMINAY_WEBRTC_ADVERTISE_ADDRESS: "" }).advertiseAddress, undefined);
  assert.equal(parse([], { TERMINAY_WEBRTC_ADVERTISE_ADDRESS: "   " }).advertiseAddress, undefined);
  assert.throws(() => parse(["--advertise-address"]), /requires a value/u);
});

test("a hostname is refused, because a candidate is resolved on the peer's machine", () => {
  assert.throws(
    () => parse(["--advertise-address", "box.example.com:51000"]),
    /literal address and port/u,
  );
  assert.throws(() => parse(["--advertise-address", "localhost:51000"]), /literal address and port/u);
});

test("a malformed advertised address is refused", () => {
  for (const value of ["127.0.0.1", "51000", "127.0.0.1:", ":51000", "127.0.0.1:abc", "::1:51000"]) {
    assert.throws(() => parse(["--advertise-address", value]), /--advertise-address/u, value);
  }
});

test("an out-of-range port or octet is refused", () => {
  assert.throws(() => parse(["--advertise-address", "127.0.0.1:0"]), /between 1 and 65535/u);
  assert.throws(() => parse(["--advertise-address", "127.0.0.1:65536"]), /--advertise-address/u);
  assert.throws(() => parse(["--advertise-address", "999.0.0.1:51000"]), /valid IPv4 address/u);
});

test("a literal public host derives the direct origin and the advertised ICE address", () => {
  const options = parse([
    "--expose", "hosted,direct", "--http-port", "8443", "--public-host", "192.168.2.218",
  ]);
  assert.equal(options.directOrigin, "https://192.168.2.218:8443");
  assert.deepEqual({ ...options.advertiseAddress }, { host: "192.168.2.218", port: 51000 });
  assert.deepEqual({ ...options.publicHost }, { host: "192.168.2.218", kind: "address" });
  // The advertised address pins the range itself; no ICE port was configured.
  assert.equal(options.icePort, undefined);

  const environment = parse([], {
    TERMINAY_EXPOSE: "direct",
    TERMINAY_HTTP_PORT: "9443",
    TERMINAY_PUBLIC_HOST: "[2001:db8::10]",
  });
  assert.equal(environment.directOrigin, "https://[2001:db8::10]:9443");
  assert.deepEqual({ ...environment.advertiseAddress }, { host: "2001:db8::10", port: 51000 });
});

test("a public host that is a name or loopback derives the direct origin only", () => {
  for (const [host, kind] of [
    ["box.example.com", "name"],
    ["localhost", "loopback"],
    ["127.0.0.1", "loopback"],
    ["::1", "loopback"],
  ]) {
    const options = parse(["--expose", "direct", "--http-port", "8443", "--public-host", host]);
    assert.equal(options.publicHost.kind, kind);
    assert.equal(options.advertiseAddress, undefined);
    assert.equal(options.icePort, undefined);
    assert.equal(
      options.directOrigin,
      `https://${host.includes(":") ? `[${host}]` : host}:8443`,
    );
  }
});

test("an explicit direct origin or advertised address wins over the public host", () => {
  const origin = parse([
    "--expose", "direct", "--http-port", "8443", "--public-host", "192.168.2.218",
    "--direct-origin", "https://box.example.com:8443",
  ]);
  assert.equal(origin.directOrigin, "https://box.example.com:8443");
  assert.deepEqual({ ...origin.advertiseAddress }, { host: "192.168.2.218", port: 51000 });

  const advertised = parse([
    "--expose", "direct", "--http-port", "8443", "--public-host", "192.168.2.218",
    "--advertise-address", "203.0.113.7:52000",
  ]);
  assert.equal(advertised.directOrigin, "https://192.168.2.218:8443");
  assert.deepEqual({ ...advertised.advertiseAddress }, { host: "203.0.113.7", port: 52000 });

  // An explicitly empty advertised address declines the derived one too.
  const cleared = parse(
    ["--expose", "direct", "--http-port", "8443", "--public-host", "192.168.2.218"],
    { TERMINAY_WEBRTC_ADVERTISE_ADDRESS: "" },
  );
  assert.equal(cleared.advertiseAddress, undefined);
});

test("a public host is validated and needs a port to name an origin", () => {
  for (const bad of ["https://box.example.com", "box.example.com:8443", "box/path", "0.0.0.0", "::", "1.2.3", "bad host"]) {
    assert.throws(() => parse(["--public-host", bad]), /--public-host/u, bad);
  }
  assert.throws(
    () => parse(["--expose", "direct", "--public-host", "192.168.2.218"]),
    /needs --http-port/u,
  );
  // Without direct exposure there is no origin to derive, only the candidate.
  const hostedOnly = parse(["--expose", "hosted", "--public-host", "192.168.2.218"]);
  assert.equal(hostedOnly.directOrigin, undefined);
  assert.deepEqual({ ...hostedOnly.advertiseAddress }, { host: "192.168.2.218", port: 51000 });
});

test("direct exposure still needs an origin from somewhere", () => {
  assert.throws(() => parse(["--expose", "direct"]), /--direct-origin .* or --public-host/u);
});

test("an ICE range can be pinned without an advertised address", () => {
  const pinned = parse(["--ice-port", "52000", "--ice-port-span", "16"]);
  assert.equal(pinned.icePort, 52000);
  assert.equal(pinned.icePortSpan, 16);
  assert.equal(pinned.advertiseAddress, undefined);

  const unpinned = parse();
  assert.equal(unpinned.icePort, undefined);
  assert.equal(unpinned.icePortSpan, 4);

  const fromPublicHost = parse(["--public-host", "192.168.2.218", "--ice-port", "52000"]);
  assert.deepEqual({ ...fromPublicHost.advertiseAddress }, { host: "192.168.2.218", port: 52000 });

  assert.throws(
    () => parse(["--ice-port", "52000", "--advertise-address", "192.168.2.218:51000"]),
    /must equal the --advertise-address port/u,
  );
  assert.throws(() => parse(["--ice-port", "0"]), /--ice-port/u);
  assert.throws(() => parse(["--ice-port-span", "1"]), /--ice-port-span/u);
  assert.throws(() => parse(["--ice-port", "65535"]), /past port 65535/u);
  assert.throws(
    () => parse(["--advertise-address", "192.168.2.218:65534", "--ice-port-span", "16"]),
    /past port 65535/u,
  );
});

test("the build revision is read from the environment and validated", () => {
  assert.equal(parse().serverRevision, undefined);
  assert.equal(parse([], { TERMINAY_SERVER_REVISION: "9497f228b72d" }).serverRevision, "9497f228b72d");
  assert.throws(() => parse([], { TERMINAY_SERVER_REVISION: "not a revision" }), /TERMINAY_SERVER_REVISION/u);
});
