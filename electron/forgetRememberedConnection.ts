/**
 * Forget one remembered server on this device.
 *
 * Kept apart from Electron so its ordering is testable. Forget removes this
 * device's credential and metadata for the server and changes nothing on the
 * server itself: the device stays authorized there until it is revoked.
 */
export async function forgetRememberedConnection<
	Profile extends Readonly<{ id: string; origin: string }>,
>(
	options: Readonly<{
		profileId: string;
		localProfileId: string;
		profiles: ReadonlyMap<string, Profile>;
		/** Every open window's primary profile and its detach. */
		windows: readonly Readonly<{
			primaryProfileId: string;
			detach: (profileId: string) => Promise<void>;
		}>[];
		removeCredential: (origin: string) => Promise<void>;
		/** Drop the profile from the remembered set and write the set. */
		removeProfile: (profileId: string) => void;
	}>,
): Promise<boolean> {
	const { profileId, profiles, windows } = options;
	if (profileId === options.localProfileId)
		throw new Error('Local cannot be forgotten.');
	const profile = profiles.get(profileId);
	if (profile === undefined) return false;
	if (windows.some((window) => window.primaryProfileId === profileId))
		throw new Error(
			'A window is showing this server. Switch that window to another server, then forget it.',
		);
	for (const window of windows) await window.detach(profileId);
	// The credential goes first: a profile that is still listed can be
	// forgotten again, a credential with no profile could never be found.
	const originStillRemembered = [...profiles.values()].some(
		(other) => other.id !== profileId && other.origin === profile.origin,
	);
	if (!originStillRemembered) await options.removeCredential(profile.origin);
	options.removeProfile(profileId);
	return true;
}
