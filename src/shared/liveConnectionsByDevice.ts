/**
 * Live remote connections, as a person thinks of them: by device.
 *
 * A device holds one connection for each window it has open, so the raw list
 * has a row per window. The lists that show who is connected show each device
 * once, with how many windows it has.
 */
export type LiveConnection = Readonly<{
	attachedSessionCount: number;
	connectionId: string;
	deviceId: string;
	deviceName: string;
}>;

export type LiveDevice = Readonly<{
	deviceId: string;
	deviceName: string;
	windowCount: number;
	attachedSessionCount: number;
	/** One of the device's connections. Closing it closes the device's windows. */
	connectionId: string;
}>;

export function groupLiveConnectionsByDevice(
	connections: readonly LiveConnection[],
): readonly LiveDevice[] {
	const devices = new Map<string, LiveDevice>();
	for (const connection of connections) {
		const existing = devices.get(connection.deviceId);
		devices.set(
			connection.deviceId,
			existing === undefined
				? {
						deviceId: connection.deviceId,
						deviceName: connection.deviceName,
						windowCount: 1,
						attachedSessionCount: connection.attachedSessionCount,
						connectionId: connection.connectionId,
					}
				: {
						...existing,
						windowCount: existing.windowCount + 1,
						attachedSessionCount:
							existing.attachedSessionCount + connection.attachedSessionCount,
					},
		);
	}
	return [...devices.values()];
}

/** Shown beside a device's name only when it has more than one window. */
export function liveWindowsLabel(windowCount: number): string {
	return windowCount > 1 ? `${windowCount} windows` : '';
}
