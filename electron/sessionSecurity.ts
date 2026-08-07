export interface SecureSessionLike {
	setPermissionCheckHandler(
		handler: (
			webContents: unknown,
			permission: unknown,
			requestingOrigin: string,
			details: unknown,
		) => boolean,
	): void;
	setPermissionRequestHandler(
		handler: (
			webContents: unknown,
			permission: unknown,
			callback: (allowed: boolean) => void,
			details: unknown,
		) => void,
	): void;
	on(
		event: 'will-download',
		listener: (
			event: { preventDefault(): void },
			item: { cancel(): void },
		) => void,
	): void;
}

const permissionSecuredSessions = new WeakSet<object>();
const downloadSecuredSessions = new WeakSet<object>();

export type SessionPermissionPolicy = (
	webContents: unknown,
	permission: unknown,
	details: unknown,
) => boolean;

/** Session policy is owned once per Session, never once per BrowserWindow.
 * Duplicate will-download listeners on Electron's shared default session can
 * wedge auxiliary WebContents teardown on macOS. */
export function secureSession(
	session: SecureSessionLike,
	allowPermission: SessionPermissionPolicy = () => false,
): void {
	const identity = session as object;
	if (!permissionSecuredSessions.has(identity)) {
		session.setPermissionCheckHandler(
			(webContents, permission, _requestingOrigin, details) =>
				allowPermission(webContents, permission, details),
		);
		session.setPermissionRequestHandler(
			(webContents, permission, callback, details) =>
				callback(allowPermission(webContents, permission, details)),
		);
		permissionSecuredSessions.add(identity);
	}
	if (!downloadSecuredSessions.has(identity)) {
		session.on('will-download', (event, item) => {
			event.preventDefault();
			item.cancel();
		});
		downloadSecuredSessions.add(identity);
	}
}
