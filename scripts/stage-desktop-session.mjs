// The desktop session's files travel with @terminay/remote-desktop's compiled
// output, so anything that ships the package's `dist` ships them too: the
// standalone release archive, the official image, and the embedded server.
//
// The session script itself is kept in the bot image's build context, which
// has to be complete as it stands in the repository, and is copied from
// there: one file, used by both desktops.
import { chmod, cp, mkdir, readdir, rm } from 'node:fs/promises';

const target = new URL(
	'../packages/remote-desktop/dist/session-assets/',
	import.meta.url,
);
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
for (const source of [
	'../docker/terminay-bot/session/',
	'../packages/remote-desktop/session/',
])
	await cp(new URL(source, import.meta.url), target, { recursive: true });
for (const name of await readdir(target)) await chmod(new URL(name, target), 0o755);
