import { currentWindowsUserSid } from '../packages/server-core/src/processObservation/windows'
import type { SessionHolderAddressing } from '../packages/server-core/src/sessionHolder/paths'

let cachedSid: string | null | undefined

/**
 * The SID of the user Desktop runs as, on Windows. It names this user's holder
 * and control pipes (ADR-0083), and does not change while the process lives.
 */
export function currentUserSid(): string | undefined {
	if (process.platform !== 'win32') return undefined
	cachedSid ??= currentWindowsUserSid()
	return cachedSid ?? undefined
}

/** Where this Desktop's session holders listen. */
export function currentHolderAddressing(): SessionHolderAddressing {
	const userSid = currentUserSid()
	return userSid === undefined
		? { platform: process.platform }
		: { platform: process.platform, userSid }
}
