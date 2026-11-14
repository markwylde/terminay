/**
 * An in-memory host for the bot AppArmor installer, so no test writes
 * `/etc/apparmor.d` or runs `apparmor_parser`.
 */
export function fakeAppArmorHost(overrides = {}) {
	const files = new Map(Object.entries(overrides.files ?? {}));
	const calls = [];
	const fail = overrides.fail ?? {};
	const present = new Set([
		'/sys/kernel/security/apparmor',
		'/usr/sbin/apparmor_parser',
	]);
	for (const path of overrides.absent ?? []) present.delete(path);
	return {
		uid: overrides.uid ?? 0,
		securityDirectory: '/sys/kernel/security/apparmor',
		profilePath: '/etc/apparmor.d/terminay-bot',
		pathDirectories: ['/usr/sbin'],
		files,
		calls,
		exists: async (path) => present.has(path) || files.has(path),
		readFile: async (path) => files.get(path)?.contents,
		stat: async (path) => {
			const file = files.get(path);
			return file === undefined
				? undefined
				: { uid: file.uid, gid: file.gid, mode: file.mode };
		},
		mkdir: async (path) => {
			calls.push(`mkdir ${path}`);
		},
		writeFile: async (path, contents) => {
			calls.push(`write ${path}`);
			if (fail.write) throw new Error('read-only file system');
			files.set(path, { contents, uid: 1000, gid: 1000, mode: 0o600 });
		},
		chown: async (path, uid, gid) => {
			calls.push(`chown ${uid}:${gid} ${path}`);
			if (fail.chown) throw new Error('operation not permitted');
			files.set(path, { ...files.get(path), uid, gid });
		},
		chmod: async (path, mode) => {
			calls.push(`chmod ${mode.toString(8)} ${path}`);
			if (fail.chmod) throw new Error('operation not permitted');
			files.set(path, { ...files.get(path), mode });
		},
		rename: async (from, to) => {
			calls.push(`rename ${from} ${to}`);
			files.set(to, files.get(from));
			files.delete(from);
		},
		remove: async (path) => {
			calls.push(`remove ${path}`);
			files.delete(path);
		},
		run: async (file, args) => {
			calls.push(`${file} ${args.join(' ')}`);
			if (fail.parser) {
				const error = new Error('Command failed');
				error.stderr = 'AppArmor parser error: syntax error\n';
				throw error;
			}
		},
	};
}

/** Commands that loaded the profile, in order. */
export const loads = (host) =>
	host.calls.filter((line) => line.includes('apparmor_parser'));
