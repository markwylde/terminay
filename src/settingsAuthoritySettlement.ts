export class SettingsAuthorityMutationError extends Error {
	readonly action: 'reset' | 'update';
	readonly authorities: readonly string[];
	readonly causes: readonly unknown[];

	constructor(
		action: 'reset' | 'update',
		authorities: readonly string[],
		causes: readonly unknown[],
	) {
		super(
			`Settings ${action} failed for ${authorities.join(' and ')} authority.`,
		);
		this.name = 'SettingsAuthorityMutationError';
		this.action = action;
		this.authorities = authorities;
		this.causes = causes;
	}
}

export async function settleSettingsAuthorities<T>(
	action: 'reset' | 'update',
	server: Promise<unknown>,
	device: Promise<T>,
): Promise<T> {
	const [serverResult, deviceResult] = await Promise.allSettled([
		server,
		device,
	]);
	const failed = [
		serverResult.status === 'rejected' ? 'server' : null,
		deviceResult.status === 'rejected' ? 'device' : null,
	].filter((authority): authority is string => authority !== null);
	if (failed.length > 0) {
		const causes = [
			serverResult.status === 'rejected' ? serverResult.reason : undefined,
			deviceResult.status === 'rejected' ? deviceResult.reason : undefined,
		].filter((cause) => cause !== undefined);
		throw new SettingsAuthorityMutationError(action, failed, causes);
	}
	return (deviceResult as PromiseFulfilledResult<T>).value;
}
