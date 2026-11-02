/** Group 5 snapshots the selected sign-in's stable key with each session.
 * Compare it before session/load, including for ended sessions. */
export function assertBotSessionSignIn(
	recordedKey: string,
	currentKey: string,
): void {
	if (!recordedKey || !currentKey || recordedKey !== currentKey) {
		throw Object.assign(new Error('session sign-in differs from bot sign-in'), {
			code: 'bot-sign-in-changed',
		});
	}
}
