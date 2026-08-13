import type { ConnectionProfile } from '@terminay/client-core';

const AUTO_RESTORE_PROFILE_STATUSES: ReadonlySet<ConnectionProfile['status']> =
	new Set([
		'connected',
		'connecting',
		'unreachable',
	] satisfies ConnectionProfile['status'][]);

export function isAutoRestorableProfile(profile: ConnectionProfile): boolean {
	return (
		profile.archived !== true &&
		profile.isLocal !== true &&
		AUTO_RESTORE_PROFILE_STATUSES.has(profile.status)
	);
}

export function isBrowserReconnectOrigin(origin: string): boolean {
	const parsed = new URL(origin);
	if (parsed.protocol === 'https:') return true;
	return (
		parsed.protocol === 'http:' &&
		(parsed.hostname === 'localhost' ||
			parsed.hostname.endsWith('.localhost') ||
			parsed.hostname === '127.0.0.1' ||
			parsed.hostname === '[::1]')
	);
}

export function reconnectNeedsFreshPairing(cause: unknown): boolean {
	if (!(cause instanceof Error)) return false;
	return (
		cause.message === 'reconnect proof request is invalid' ||
		cause.message === 'reconnect credential is unavailable for this server' ||
		cause.message === 'reconnect credential changed while signing' ||
		cause.message.includes('Saved reconnect credentials were rejected') ||
		/Server reconnect request failed \((?:400|401|403|404)\)/u.test(
			cause.message,
		)
	);
}
