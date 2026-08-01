const DEFAULT_ORIGIN = 'https://web.terminay.com';

export class WebHostDeploymentVerificationError extends Error {
	constructor(message) {
		super(message);
		this.name = 'WebHostDeploymentVerificationError';
	}
}

export async function verifyWebHostDeployment({
	origin = DEFAULT_ORIGIN,
	fetchImpl = globalThis.fetch,
} = {}) {
	const canonicalOrigin = new URL(origin);
	if (canonicalOrigin.origin !== origin || canonicalOrigin.protocol !== 'https:') {
		throw new WebHostDeploymentVerificationError('web host origin must be an exact HTTPS origin');
	}
	if (typeof fetchImpl !== 'function') {
		throw new WebHostDeploymentVerificationError('fetch is unavailable');
	}

	const health = await fetchImpl(`${origin}/healthz`, { redirect: 'error' });
	if (!health.ok || (await health.text()).trim() !== '{"ok":true}') {
		throw new WebHostDeploymentVerificationError(`web host health check failed (${health.status})`);
	}

	const shell = await fetchImpl(`${origin}/`, { redirect: 'error' });
	const html = await shell.text();
	if (!shell.ok || !contentType(shell).startsWith('text/html')) {
		throw new WebHostDeploymentVerificationError(`web host shell failed (${shell.status})`);
	}
	if (!/<title>Terminay Connections<\/title>/u.test(html)) {
		throw new WebHostDeploymentVerificationError('web host shell is not the Terminay connection manager');
	}
	requireHeader(shell, 'content-security-policy', /default-src/u);
	requireHeader(shell, 'cross-origin-opener-policy', /^same-origin$/u);
	requireHeader(shell, 'permissions-policy', /geolocation=\(\)/u);
	requireHeader(shell, 'referrer-policy', /^no-referrer$/u);
	requireHeader(shell, 'x-content-type-options', /^nosniff$/u);
	requireHeader(shell, 'x-frame-options', /^DENY$/u);

	const assetPaths = [...html.matchAll(/(?:src|href)="(\/?assets\/[^"?]+)"/gu)]
		.map(match => new URL(match[1], origin).href);
	if (assetPaths.length === 0) {
		throw new WebHostDeploymentVerificationError('web host shell declares no built assets');
	}
	for (const assetUrl of new Set(assetPaths)) {
		const asset = await fetchImpl(assetUrl, { redirect: 'error' });
		if (!asset.ok) throw new WebHostDeploymentVerificationError(`web host asset failed (${asset.status}): ${assetUrl}`);
	}

	return Object.freeze({
		origin,
		health: true,
		shell: true,
		assets: Object.freeze([...new Set(assetPaths)]),
		verifiedAt: new Date().toISOString(),
	});
}

function contentType(response) {
	return response.headers.get('content-type')?.toLowerCase() ?? '';
}

function requireHeader(response, name, expected) {
	const value = response.headers.get(name) ?? '';
	if (!expected.test(value)) {
		throw new WebHostDeploymentVerificationError(`web host response header ${name} is missing or invalid`);
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	try {
		console.log(JSON.stringify(await verifyWebHostDeployment(), null, 2));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
