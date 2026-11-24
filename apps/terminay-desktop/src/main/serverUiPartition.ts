import { createHash } from 'node:crypto';

/** The Chromium storage partition a server's workspace documents use for one
 * remembered profile. */
export function serverUiPartitionKey(
	serverId: string,
	profileId: string,
): string {
	return createHash('sha256')
		.update(`${serverId}\0${profileId}`)
		.digest('base64url');
}
