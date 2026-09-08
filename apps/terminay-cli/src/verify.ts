import { createPublicKey, verify } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { hashFile } from './download.js';

/**
 * The boundary this crosses is "release pipeline → operator's machine", and
 * the embedded key is the only thing that makes the download trustworthy. So
 * there is no skip flag and no environment override: if verification cannot
 * pass, the install does not happen. A release that cannot be signed is a
 * release to block, not a check to relax.
 */

export const RELEASE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAYC52lwOqFefLXCpv9GcplfMj8/+QDjA1Rh95vEZlLcg=
-----END PUBLIC KEY-----
`;

export class VerificationError extends Error {}

/** The sidecar is `<sha256>  <filename>`, as `release-checksum.mjs` writes it. */
export function parseChecksumSidecar(contents: string): string {
	const match = /^([0-9a-f]{64})\s/u.exec(contents.trim());
	if (match?.[1] === undefined)
		throw new VerificationError(
			'the published checksum sidecar is not readable',
		);
	return match[1];
}

export function releasePublicKey(pem: string = RELEASE_PUBLIC_KEY_PEM) {
	const key = createPublicKey(pem);
	if (key.asymmetricKeyType !== 'ed25519')
		throw new VerificationError(
			'the embedded release key is not an Ed25519 key',
		);
	return key;
}

export interface VerifyArchiveInput {
	readonly archivePath: string;
	readonly sidecar: string;
	readonly signature: Buffer;
	/** Present when the archive was already hashed while downloading. */
	readonly digest?: string;
	readonly publicKeyPem?: string;
}

export async function verifyArchive(
	input: VerifyArchiveInput,
): Promise<{ readonly sha256: string }> {
	const expected = parseChecksumSidecar(input.sidecar);
	const actual = input.digest ?? (await hashFile(input.archivePath));
	if (actual !== expected) {
		throw new VerificationError(
			`the downloaded archive does not match its published checksum (expected ${expected}, got ${actual})`,
		);
	}
	// Signing the archive bytes, not the sidecar, is what stops an attacker who
	// can replace both the asset and its checksum. Ed25519 signs a whole
	// message, so the archive is read in full here, exactly as the release
	// pipeline reads it when signing.
	const payload = await readFile(input.archivePath);
	if (
		!verify(
			null,
			payload,
			releasePublicKey(input.publicKeyPem),
			input.signature,
		)
	) {
		throw new VerificationError(
			'the downloaded archive is not signed by the Terminay release key',
		);
	}
	return Object.freeze({ sha256: actual });
}
