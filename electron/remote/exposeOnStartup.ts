type StartupExposure = {
	getStatus(): Promise<{ isRunning: boolean }> | { isRunning: boolean };
	toggle(): Promise<unknown>;
};

/** The administrator's standing decision to expose at startup. Only exposes a
 * server that is not already exposed, because `toggle()` would otherwise stop
 * it. A failure lands in remote-access status exactly as a manual toggle's. */
export async function exposeOnStartup(
	enabled: boolean,
	exposure: StartupExposure,
): Promise<boolean> {
	if (!enabled) return false;
	if ((await exposure.getStatus()).isRunning) return false;
	await exposure.toggle();
	return true;
}
