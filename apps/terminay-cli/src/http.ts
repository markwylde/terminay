import { get, type RequestOptions } from 'node:https';
import type { IncomingMessage } from 'node:http';

/**
 * The CLI talks to exactly one host family (github.com) over TLS and reads
 * bounded documents. `node:https` covers that without a client library, which
 * keeps the dependency an operator runs as root down to the QR renderer.
 */

const USER_AGENT = 'terminay-cli';
const MAX_REDIRECTS = 5;
const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;

/** Sentinel for `openStream`: return the redirect itself rather than follow it. */
export const NO_REDIRECT = -1;

export interface HttpResponse {
	readonly status: number;
	readonly headers: Readonly<Record<string, string | string[] | undefined>>;
	readonly body: string;
}

function headers(accept: string): Record<string, string> {
	const value: Record<string, string> = { 'user-agent': USER_AGENT, accept };
	// An authenticated request lifts the anonymous rate limit that an `npx`
	// install on a busy network can otherwise hit.
	const token = process.env.GITHUB_TOKEN;
	if (typeof token === 'string' && token.length > 0) value.authorization = `Bearer ${token}`;
	return value;
}

export function openStream(
	url: string,
	accept = '*/*',
	redirectsLeft: number = MAX_REDIRECTS,
	extraHeaders?: Readonly<Record<string, string>>,
): Promise<IncomingMessage> {
	return new Promise((resolve, reject) => {
		const parsed = new URL(url);
		if (parsed.protocol !== 'https:') {
			reject(new Error(`refusing a non-HTTPS download: ${url}`));
			return;
		}
		const options: RequestOptions = { headers: { ...headers(accept), ...extraHeaders } };
		const request = get(parsed, options, (response) => {
			const status = response.statusCode ?? 0;
			const location = response.headers.location;
			if (status >= 300 && status < 400 && typeof location === 'string') {
				// A caller passing NO_REDIRECT wants the hop itself, not its target.
				if (redirectsLeft === NO_REDIRECT) {
					resolve(response);
					return;
				}
				response.resume();
				if (redirectsLeft <= 0) {
					reject(new Error(`too many redirects fetching ${url}`));
					return;
				}
				// A redirect to a signed asset host must not carry the GitHub
				// token onward, so the next hop is a fresh request.
				resolve(openStream(new URL(location, parsed).toString(), accept, redirectsLeft - 1, extraHeaders));
				return;
			}
			resolve(response);
		});
		request.setTimeout(REQUEST_TIMEOUT_MS, () => request.destroy(new Error(`timed out fetching ${url}`)));
		request.on('error', reject);
	});
}

export async function request(url: string, accept = '*/*', followRedirects = true): Promise<HttpResponse> {
	// A caller that needs to read where a redirect points — `releases/latest`
	// names the newest tag only in its Location — asks not to be followed.
	const response = await openStream(url, accept, followRedirects ? MAX_REDIRECTS : NO_REDIRECT);
	const chunks: Buffer[] = [];
	let total = 0;
	for await (const chunk of response) {
		total += (chunk as Buffer).length;
		if (total > MAX_DOCUMENT_BYTES) {
			response.destroy();
			throw new Error(`response from ${url} is larger than the ${MAX_DOCUMENT_BYTES}-byte limit`);
		}
		chunks.push(chunk as Buffer);
	}
	return Object.freeze({
		status: response.statusCode ?? 0,
		headers: response.headers,
		body: Buffer.concat(chunks).toString('utf8'),
	});
}

export async function requestJson(url: string): Promise<unknown> {
	const response = await request(url, 'application/vnd.github+json');
	if (response.status !== 200) throw new Error(`GitHub returned ${response.status} for ${url}`);
	try {
		return JSON.parse(response.body);
	} catch {
		throw new Error(`GitHub returned an unreadable document for ${url}`);
	}
}
