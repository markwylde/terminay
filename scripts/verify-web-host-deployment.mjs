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
	expectedRevision,
	allowHttp = false,
} = {}) {
	const canonicalOrigin = new URL(origin);
	if (
		canonicalOrigin.origin !== origin ||
		(canonicalOrigin.protocol !== 'https:' &&
			!(allowHttp && canonicalOrigin.protocol === 'http:'))
	) {
		throw new WebHostDeploymentVerificationError(
			'web host origin must be an exact HTTPS origin',
		);
	}
	if (typeof fetchImpl !== 'function') {
		throw new WebHostDeploymentVerificationError('fetch is unavailable');
	}

	const health = await fetchImpl(`${origin}/healthz`, { redirect: 'error' });
	if (
		!health.ok ||
		!contentType(health).startsWith('application/json') ||
		(await health.text()).trim() !== '{"ok":true}'
	) {
		throw new WebHostDeploymentVerificationError(
			`web host health check failed (${health.status})`,
		);
	}

	const markerResponse = await fetchImpl(
		`${origin}/.well-known/terminay-release.json`,
		{ redirect: 'error' },
	);
	if (
		!markerResponse.ok ||
		!contentType(markerResponse).startsWith('application/json')
	) {
		throw new WebHostDeploymentVerificationError(
			`web host release marker failed (${markerResponse.status})`,
		);
	}
	let release;
	try {
		release = await markerResponse.json();
	} catch {
		throw new WebHostDeploymentVerificationError(
			'web host release marker is invalid JSON',
		);
	}
	if (
		release?.product !== 'terminay-web' ||
		release?.schemaVersion !== 1 ||
		!(
			/^[0-9a-f]{40}$/u.test(release?.sourceRevision) ||
			release?.sourceRevision === 'local'
		)
	) {
		throw new WebHostDeploymentVerificationError(
			'web host release marker is invalid',
		);
	}
	if (
		expectedRevision !== undefined &&
		release.sourceRevision !== expectedRevision
	) {
		throw new WebHostDeploymentVerificationError(
			'web host release revision does not match the selected image',
		);
	}

	const shell = await fetchImpl(`${origin}/`, { redirect: 'error' });
	const html = await shell.text();
	if (!shell.ok || !contentType(shell).startsWith('text/html')) {
		throw new WebHostDeploymentVerificationError(
			`web host shell failed (${shell.status})`,
		);
	}
	if (!/<title>Terminay Connections<\/title>/u.test(html)) {
		throw new WebHostDeploymentVerificationError(
			'web host shell is not the Terminay connection manager',
		);
	}
	if (/Terminay Remote/iu.test(html)) {
		throw new WebHostDeploymentVerificationError(
			'web host shell is the legacy Terminay Remote manager',
		);
	}
	requireHeader(shell, 'content-security-policy', /default-src/u);
	requireHeader(shell, 'cross-origin-opener-policy', /^same-origin$/u);
	requireHeader(shell, 'permissions-policy', /geolocation=\(\)/u);
	requireHeader(shell, 'referrer-policy', /^no-referrer$/u);
	requireHeader(shell, 'x-content-type-options', /^nosniff$/u);
	requireHeader(shell, 'x-frame-options', /^DENY$/u);
	requireHeader(shell, 'cache-control', /(?:^|,)\s*no-store\s*(?:,|$)/u);

	const assetPaths = [
		...html.matchAll(/(?:src|href)="(\/?assets\/[^"?]+)"/gu),
	].map((match) => new URL(match[1], origin).href);
	if (assetPaths.length === 0) {
		throw new WebHostDeploymentVerificationError(
			'web host shell declares no built assets',
		);
	}
	for (const assetUrl of new Set(assetPaths)) {
		if (
			!/[.-][0-9A-Za-z_-]{8,}\.(?:css|js)$/u.test(new URL(assetUrl).pathname)
		) {
			throw new WebHostDeploymentVerificationError(
				`web host asset is not content-hashed: ${assetUrl}`,
			);
		}
		const asset = await fetchImpl(assetUrl, { redirect: 'error' });
		if (!asset.ok)
			throw new WebHostDeploymentVerificationError(
				`web host asset failed (${asset.status}): ${assetUrl}`,
			);
		const assetType = contentType(asset);
		if (!/(?:javascript|text\/css)/u.test(assetType)) {
			throw new WebHostDeploymentVerificationError(
				`web host asset has an invalid content type: ${assetUrl}`,
			);
		}
	}

	return Object.freeze({
		origin,
		health: true,
		shell: true,
		assets: Object.freeze([...new Set(assetPaths)]),
		release: Object.freeze({ ...release }),
		verifiedAt: new Date().toISOString(),
	});
}

function contentType(response) {
	return response.headers.get('content-type')?.toLowerCase() ?? '';
}

function requireHeader(response, name, expected) {
	const value = response.headers.get(name) ?? '';
	if (!expected.test(value)) {
		throw new WebHostDeploymentVerificationError(
			`web host response header ${name} is missing or invalid`,
		);
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	try {
		console.log(
			JSON.stringify(
				await verifyWebHostDeployment({
					expectedRevision: process.env.TERMINAY_EXPECTED_WEB_REVISION,
				}),
				null,
				2,
			),
		);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
