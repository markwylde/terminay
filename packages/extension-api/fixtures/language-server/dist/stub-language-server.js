/**
 * A stub Language Server Protocol server over stdio. It answers `initialize`,
 * `textDocument/completion` with one item, `textDocument/hover`,
 * `textDocument/definition`, and publishes one diagnostic after `didOpen`.
 * It is a fixture, not an implementation of anything.
 */
let buffer = Buffer.alloc(0);

function send(payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

function reply(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function handle(message) {
  switch (message.method) {
    case "initialize":
      reply(message.id, {
        capabilities: {
          textDocumentSync: 1,
          completionProvider: { triggerCharacters: ["."] },
          hoverProvider: true,
          definitionProvider: true,
        },
        serverInfo: { name: "fixture-language-server", version: "1.0.0" },
      });
      return;
    case "textDocument/didOpen": {
      const uri = message.params?.textDocument?.uri;
      if (typeof uri !== "string") return;
      send({
        jsonrpc: "2.0",
        method: "textDocument/publishDiagnostics",
        params: {
          uri,
          diagnostics: [{
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
            severity: 1,
            source: "fixture",
            message: "fixture diagnostic",
          }],
        },
      });
      return;
    }
    case "textDocument/completion":
      reply(message.id, {
        isIncomplete: false,
        items: [{ label: "fixtureCompletion", kind: 1, detail: "fixture" }],
      });
      return;
    case "textDocument/hover":
      reply(message.id, {
        contents: { kind: "plaintext", value: "fixture hover" },
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      });
      return;
    case "textDocument/definition":
      reply(message.id, [{
        uri: message.params?.textDocument?.uri ?? "",
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      }]);
      return;
    case "shutdown":
      reply(message.id, null);
      return;
    case "exit":
      process.exit(0);
      return;
    default:
      if (typeof message.id === "number") reply(message.id, null);
  }
}

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const separator = buffer.indexOf("\r\n\r\n");
    if (separator < 0) return;
    const header = buffer.subarray(0, separator).toString("utf8");
    const match = /content-length:\s*(\d+)/i.exec(header);
    if (!match) {
      buffer = buffer.subarray(separator + 4);
      continue;
    }
    const length = Number(match[1]);
    if (buffer.length < separator + 4 + length) return;
    const body = buffer.subarray(separator + 4, separator + 4 + length).toString("utf8");
    buffer = buffer.subarray(separator + 4 + length);
    try {
      handle(JSON.parse(body));
    } catch {
      // A frame this stub cannot parse is not a frame it answers.
    }
  }
});

process.stdin.on("end", () => process.exit(0));
