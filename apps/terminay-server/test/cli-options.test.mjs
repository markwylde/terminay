import assert from "node:assert/strict";
import test from "node:test";
import { allowedWebOrigins } from "../dist/cliOptions.js";

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
