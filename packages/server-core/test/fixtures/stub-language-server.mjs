#!/usr/bin/env node
// A deliberately small language server: Content-Length framed JSON-RPC over
// stdio, exactly what the host's client speaks, and nothing more. It answers
// initialize, completion, hover and definition, and publishes one diagnostic
// for every document that is opened.
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const crashOn = process.argv.includes("--crash-on-hover") ? "textDocument/hover" : undefined;
let root = process.cwd();
let buffer = Buffer.alloc(0);

function send(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  process.stdout.write(`Content-Length: ${body.byteLength}\r\n\r\n`);
  process.stdout.write(body);
}

function range(line, character, endCharacter) {
  return { start: { line, character }, end: { line, character: endCharacter } };
}

function handle(message) {
  const { id, method, params } = message;
  if (method === "initialize") {
    root = params?.rootPath ?? root;
    send({ jsonrpc: "2.0", id, result: { capabilities: { textDocumentSync: 1, completionProvider: {}, hoverProvider: true, definitionProvider: true } } });
    return;
  }
  if (method === "initialized") return;
  if (method === "textDocument/didOpen" || method === "textDocument/didChange") {
    const uri = params?.textDocument?.uri;
    if (typeof uri === "string")
      send({
        jsonrpc: "2.0",
        method: "textDocument/publishDiagnostics",
        params: { uri, diagnostics: [{ range: range(0, 0, 5), severity: 1, code: 2304, source: "stub", message: "cannot find name" }] },
      });
    return;
  }
  if (method === "textDocument/didClose" || method === "workspace/didChangeWatchedFiles") return;
  if (method === crashOn) {
    process.exit(3);
    return;
  }
  if (method === "textDocument/completion") {
    send({ jsonrpc: "2.0", id, result: { isIncomplete: false, items: [{ label: "greet", kind: 3, detail: "() => string", documentation: { kind: "markdown", value: "Greets" } }] } });
    return;
  }
  if (method === "textDocument/hover") {
    send({ jsonrpc: "2.0", id, result: { contents: { kind: "markdown", value: "**greet**" }, range: range(0, 0, 5) } });
    return;
  }
  if (method === "textDocument/definition") {
    send({
      jsonrpc: "2.0",
      id,
      result: [
        { uri: pathToFileURL(resolve(root, "lib/target.ts")).href, range: range(2, 0, 4) },
        // Deliberately outside the project: the host must drop it.
        { uri: pathToFileURL("/etc/hosts").href, range: range(0, 0, 1) },
      ],
    });
    return;
  }
  if (method === "shutdown") {
    send({ jsonrpc: "2.0", id, result: null });
    return;
  }
  if (method === "exit") {
    process.exit(0);
    return;
  }
  if (id !== undefined) send({ jsonrpc: "2.0", id, error: { code: -32601, message: "method not found" } });
}

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) return;
    const match = /content-length:\s*(\d+)/i.exec(buffer.subarray(0, headerEnd).toString("ascii"));
    if (match === null) { buffer = Buffer.alloc(0); return; }
    const length = Number(match[1]);
    const start = headerEnd + 4;
    if (buffer.byteLength < start + length) return;
    const body = buffer.subarray(start, start + length).toString("utf8");
    buffer = buffer.subarray(start + length);
    try { handle(JSON.parse(body)); } catch { /* a malformed frame is ignored */ }
  }
});
