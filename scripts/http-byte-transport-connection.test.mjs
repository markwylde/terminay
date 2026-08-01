import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

const directory = await mkdtemp(join(tmpdir(), 'terminay-http-connection-'));
const output = join(directory, 'httpByteTransport.mjs');
await build({
  bundle: true,
  entryPoints: ['src/shared/httpByteTransport.ts'],
  format: 'esm',
  logLevel: 'silent',
  outfile: output,
  platform: 'node',
});
const transport = await import(pathToFileURL(output).href);

test.after(async () => {
  await rm(directory, { force: true, recursive: true });
});

test('parses an opaque pairing fragment into an HTTP endpoint and bearer credential', () => {
  const token = 'opaque-pairing-token-123456';
  const result = transport.parseHttpConnectionUrl(
    `https://server.example.test/workspace/#${token}`,
  );

  assert.deepEqual(result, {
    authToken: token,
    origin: 'https://server.example.test/workspace',
  });
});

test('parses structured pairing data in either the fragment or query', () => {
  const pairing = {
    pairingExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    pairingSessionId: 'pairing-session-1',
    pairingToken: 'structured-pairing-token-123456',
  };
  const encoded = new URLSearchParams(pairing).toString();

  const fragment = transport.parseHttpConnectionUrl(
    `https://server.example.test/#${encoded}`,
  );
  const query = transport.parseHttpConnectionUrl(
    `https://server.example.test/?${encoded}`,
  );

  assert.deepEqual(fragment, query);
  assert.equal(fragment.authToken, pairing.pairingToken);
  assert.equal(fragment.pairingSessionId, pairing.pairingSessionId);
  assert.equal(fragment.origin, 'https://server.example.test');
});

test('rejects credentials in the URL and stale or ambiguous pairing data', () => {
  const token = 'opaque-pairing-token-123456';
  assert.throws(
    () => transport.parseHttpConnectionUrl(`http://server.example.test/#${token}`),
    /HTTPS or loopback HTTP/u,
  );
  assert.throws(
    () => transport.parseHttpConnectionUrl(`https://user:pass@server.example.test/#${token}`),
    /credentials/u,
  );
  assert.throws(
    () => transport.parseHttpConnectionUrl('https://server.example.test/'),
    /pairing credential/u,
  );
  assert.throws(
    () => transport.parseHttpConnectionUrl(
      `https://server.example.test/?pairingSessionId=session&pairingToken=${token}&pairingExpiresAt=${encodeURIComponent(new Date(Date.now() - 1).toISOString())}`,
    ),
    /expired/u,
  );
  assert.throws(
    () => transport.parseHttpConnectionUrl(
      `https://server.example.test/?pairingSessionId=session&pairingToken=${token}&pairingExpiresAt=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}&other=value`,
    ),
    /unsupported pairing data/u,
  );
});
