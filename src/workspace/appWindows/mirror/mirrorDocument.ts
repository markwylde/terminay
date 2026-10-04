/**
 * Builds the document an observer's window shows in place of a view: a mirror
 * (ADR-0039). It goes into the same sandbox proxy as a view (ADR-0038).
 *
 * The document holds one script, the replica, allowed by a nonce. Its policy
 * allows no other script, so nothing a recording carries can run: not a script
 * element, not an inline handler, not a `javascript:` link. Subresources follow
 * the mirrored window's own policy, so a mirror can load exactly the styles,
 * images, and fonts the view could.
 */
import { MIRROR_REPLICA_SCRIPT } from './bundles.generated.ts';
import { type ViewCsp, type ViewSource, viewContentSecurityPolicy } from '../viewDocument.ts';

/** Directives a mirror takes from the view's policy unchanged. */
const INHERITED = new Set(['style-src', 'img-src', 'font-src']);

/** The policy for a mirror of a view from `source`. */
export function mirrorContentSecurityPolicy(source: ViewSource, csp: ViewCsp | undefined, nonce: string): string {
	if (!/^[A-Za-z0-9+/=_-]{16,}$/u.test(nonce)) throw new TypeError('mirror nonce is invalid');
	const inherited = viewContentSecurityPolicy(source, csp)
		.split('; ')
		.filter((directive) => INHERITED.has(directive.split(' ')[0] ?? ''));
	return [
		"default-src 'none'",
		`script-src 'nonce-${nonce}'`,
		...inherited,
		"media-src 'none'",
		"connect-src 'none'",
		"frame-src 'none'",
		"worker-src 'none'",
		"object-src 'none'",
		"base-uri 'none'",
		"form-action 'none'",
	].join('; ');
}

function randomNonce(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(18));
	return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_');
}

export function buildMirrorDocument(
	source: ViewSource,
	csp: ViewCsp | undefined,
	nonce: string = randomNonce(),
): string {
	const policy = mirrorContentSecurityPolicy(source, csp, nonce).replaceAll('&', '&amp;').replaceAll('"', '&quot;');
	return (
		`<!doctype html><meta http-equiv="Content-Security-Policy" content="${policy}">` +
		`<meta charset="utf-8"><script nonce="${nonce}">${MIRROR_REPLICA_SCRIPT}</script>`
	);
}
