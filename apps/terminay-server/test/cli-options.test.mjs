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
