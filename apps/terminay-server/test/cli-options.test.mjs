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

test("a server is not exposed and uses the default hosted domain unless configured", () => {
  const options = parse();
  assert.equal(options.hostedDomain, "terminay.com");
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

test("hosted domain accepts a bare domain or an exact origin and keeps an explicit port", () => {
  assert.equal(parse(["--hosted-domain", "example.test"]).hostedDomain, "example.test");
  assert.equal(parse(["--hosted-domain", "https://example.test"]).hostedDomain, "example.test");
  assert.equal(parse(["--hosted-domain", "localhost:8443"]).hostedDomain, "localhost:8443");
  assert.throws(() => parse(["--hosted-domain", "https://example.test/relay"]), /exact origin/u);
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
    TERMINAY_HOSTED_DOMAIN: "env.example.test",
    TERMINAY_EXPOSE: "hosted",
    TERMINAY_DIRECT_ORIGIN: "https://env.example.test",
  };
  assert.deepEqual(parse([], environment).exposeModes, ["hosted"]);
  assert.equal(parse([], environment).hostedDomain, "env.example.test");
  assert.equal(parse([], environment).directOrigin, "https://env.example.test");

  const overridden = parse(
    [
      "--hosted-domain",
      "flag.example.test",
      "--expose",
      "off",
      "--direct-origin",
      "https://flag.example.test",
    ],
    environment,
  );
  assert.equal(overridden.hostedDomain, "flag.example.test");
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
