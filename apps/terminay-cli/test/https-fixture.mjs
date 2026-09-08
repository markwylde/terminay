import { createServer } from 'node:https';
import selfsigned from 'selfsigned';

/**
 * A local HTTPS origin for the resolution and download tests.
 *
 * The CLI refuses plain HTTP, which is the behaviour under test, so the
 * fixtures cannot fall back to `node:http`. The certificate is generated per
 * run and trusted only for the duration of the test process; the CLI itself
 * has no flag or variable that relaxes certificate checking.
 */

let relaxed = false;

function trustTheFixture() {
	if (relaxed) return;
	process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
	relaxed = true;
}

export async function startHttpsFixture(handler) {
	trustTheFixture();
	const pems = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], {
		days: 1,
		keySize: 2048,
		// OpenSSL refuses the library's default SHA-1 signature.
		algorithm: 'sha256',
		extensions: [
			{ name: 'basicConstraints', cA: true },
			{ name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }, { type: 2, value: 'localhost' }] },
		],
	});
	const server = createServer({ key: pems.private, cert: pems.cert }, (request, response) => {
		Promise.resolve(handler(request, response)).catch(() => {
			if (!response.headersSent) response.writeHead(500);
			response.end();
		});
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	const { port } = server.address();
	return {
		origin: `https://127.0.0.1:${port}`,
		async close() {
			await new Promise((resolve) => server.close(resolve));
		},
	};
}

export function json(response, status, body) {
	const payload = JSON.stringify(body);
	response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
	response.end(payload);
}

export function html(response, status, body) {
	response.writeHead(status, { 'content-type': 'text/html', 'content-length': Buffer.byteLength(body) });
	response.end(body);
}

/** The shape the resolver reads out of a GitHub release document. */
export function releaseDocument(tag, assetNames, publishedAt = '2026-09-08T13:32:38Z') {
	return {
		tag_name: tag,
		published_at: publishedAt,
		assets: assetNames.map((name) => ({ name })),
	};
}

export function expandedAssets(tag, assetNames) {
	return assetNames
		.map((name) => `<a href="/markwylde/terminay/releases/download/${tag}/${name}">${name}</a>`)
		.join('\n');
}
