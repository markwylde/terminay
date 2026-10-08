import assert from 'node:assert/strict';
import {
	chmod,
	lstat,
	mkdir,
	mkdtemp,
	rm,
	symlink,
	writeFile,
} from 'node:fs/promises';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

/**
 * Where the control endpoint's socket goes (ADR-0054): in the data directory
 * when its path fits a Unix socket, and otherwise in a runtime directory that
 * is the user's own and closed to everyone else.
 */

const {
	CONTROL_SOCKET_MAX_PATH_BYTES,
	ControlCapabilityStore,
	ControlSocketPlacementError,
	controlSocketRuntimeDirectory,
	createControlEndpoint,
	describeControlSocketPlacementFailure,
	placeControlSocket,
	prepareControlSocketRuntimeDirectory,
	resolveControlSocketPlacement,
} = await import('../dist/index.js');

const SHORT = '/home/mark/.local/share/Terminay';
const LONG = `/home/mark/${'deep-directory/'.repeat(8)}Terminay`;
const base = { platform: 'linux', temporaryDirectory: '/tmp' };
const resolve = (options) =>
	resolveControlSocketPlacement({ ...base, ...options });

async function scratch(run) {
	const directory = await mkdtemp(join(tmpdir(), 'tcsp-'));
	try {
		await run(directory);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

const mode = async (path) => (await lstat(path)).mode & 0o777;

test('a socket that fits stays in the data directory', () => {
	assert.deepEqual(resolve({ dataDirectory: SHORT }), {
		location: 'data-directory',
		path: `${SHORT}/terminay-mcp-control.sock`,
	});
});

test('a socket that does not fit goes in a runtime directory named for the data directory', () => {
	const placement = resolve({ dataDirectory: LONG });
	assert.equal(placement.location, 'runtime-directory');
	assert.match(placement.directory, /^\/tmp\/terminay-[a-f0-9]{12}$/);
	assert.equal(placement.path, `${placement.directory}/control.sock`);
	assert.ok(Buffer.byteLength(placement.path) <= CONTROL_SOCKET_MAX_PATH_BYTES);
});

test('the boundary is the limit itself: one byte over moves the socket', () => {
	const suffix = '/terminay-mcp-control.sock';
	const atLimit = `/${'a'.repeat(CONTROL_SOCKET_MAX_PATH_BYTES - suffix.length - 1)}`;
	assert.equal(resolve({ dataDirectory: atLimit }).location, 'data-directory');
	assert.equal(
		resolve({ dataDirectory: `${atLimit}a` }).location,
		'runtime-directory',
	);
});

test('one data directory always has one address, and two have two', () => {
	const first = resolve({ dataDirectory: LONG });
	assert.deepEqual(resolve({ dataDirectory: LONG }), first);
	// The same directory named less tidily is still that directory.
	assert.deepEqual(resolve({ dataDirectory: `${LONG}/../Terminay/` }), first);
	const other = resolve({ dataDirectory: `${LONG}-other` });
	assert.equal(other.location, 'runtime-directory');
	assert.notEqual(other.path, first.path);
});

test("the user's runtime directory is preferred when it is absolute, and ignored when it is not", () => {
	assert.match(
		resolve({ dataDirectory: LONG, runtimeDirectory: '/run/user/1000' }).path,
		/^\/run\/user\/1000\/terminay-[a-f0-9]{12}\/control\.sock$/,
	);
	assert.match(
		resolve({ dataDirectory: LONG, runtimeDirectory: 'run/user' }).path,
		/^\/tmp\/terminay-/,
	);
	assert.equal(
		controlSocketRuntimeDirectory({
			dataDirectory: LONG,
			temporaryDirectory: '/tmp',
			runtimeDirectory: '/run/user/1000',
		}),
		resolve({ dataDirectory: LONG, runtimeDirectory: '/run/user/1000' })
			.directory,
	);
});

test('the limit is counted in bytes, not characters', () => {
	// 60 characters of three bytes each: short in characters, long in bytes.
	const dataDirectory = `/home/mark/${'文'.repeat(60)}`;
	const socketPath = `${dataDirectory}/terminay-mcp-control.sock`;
	assert.ok(socketPath.length <= CONTROL_SOCKET_MAX_PATH_BYTES);
	assert.ok(Buffer.byteLength(socketPath) > CONTROL_SOCKET_MAX_PATH_BYTES);
	assert.equal(resolve({ dataDirectory }).location, 'runtime-directory');
});

test('a runtime directory that is also too deep is a failure that carries what was tried', () => {
	const temporaryDirectory = `/var/${'x'.repeat(100)}`;
	assert.throws(
		() => resolve({ dataDirectory: LONG, temporaryDirectory }),
		(error) => {
			assert.ok(error instanceof ControlSocketPlacementError);
			const { failure } = error;
			assert.equal(failure.dataDirectory, LONG);
			assert.equal(failure.socketPath, `${LONG}/terminay-mcp-control.sock`);
			assert.equal(
				failure.socketPathBytes,
				Buffer.byteLength(failure.socketPath),
			);
			assert.equal(failure.limitBytes, CONTROL_SOCKET_MAX_PATH_BYTES);
			assert.ok(
				failure.runtimeDirectory.startsWith(`${temporaryDirectory}/terminay-`),
			);
			assert.ok(failure.runtimeSocketPathBytes > failure.limitBytes);
			assert.equal(failure.refusal, undefined);
			return true;
		},
	);
});

test('Windows uses its named pipe, which has no such limit', () => {
	assert.deepEqual(resolve({ dataDirectory: LONG, platform: 'win32' }), {
		location: 'named-pipe',
		path: '\\\\.\\pipe\\terminay-control',
	});
});

test('an absent runtime directory is created closed to everyone else', async () => {
	await scratch(async (root) => {
		const directory = join(root, 'terminay-abc');
		assert.deepEqual(await prepareControlSocketRuntimeDirectory(directory), {
			ok: true,
		});
		assert.equal(await mode(directory), 0o700);
		// And is accepted as it stands the next time.
		assert.deepEqual(await prepareControlSocketRuntimeDirectory(directory), {
			ok: true,
		});
	});
});

test('a runtime directory someone else could have prepared is refused and left as it was', async () => {
	await scratch(async (root) => {
		const open = join(root, 'open');
		await mkdir(open);
		await chmod(open, 0o755);
		assert.deepEqual(await prepareControlSocketRuntimeDirectory(open), {
			ok: false,
			reason: 'other users can access it',
		});
		assert.equal(await mode(open), 0o755);

		const target = join(root, 'target');
		await mkdir(target, { mode: 0o700 });
		const link = join(root, 'link');
		await symlink(target, link);
		assert.deepEqual(await prepareControlSocketRuntimeDirectory(link), {
			ok: false,
			reason: 'it is a symbolic link',
		});
		assert.ok((await lstat(link)).isSymbolicLink());

		const file = join(root, 'file');
		await writeFile(file, 'not a directory', { mode: 0o600 });
		assert.deepEqual(await prepareControlSocketRuntimeDirectory(file), {
			ok: false,
			reason: 'it is not a directory',
		});
		assert.ok((await lstat(file)).isFile());

		// Ours by every other measure, and owned by somebody else.
		const theirs = join(root, 'theirs');
		await mkdir(theirs, { mode: 0o700 });
		assert.deepEqual(
			await prepareControlSocketRuntimeDirectory(theirs, {
				userId: process.getuid() + 1,
			}),
			{ ok: false, reason: 'it is not owned by the current user' },
		);
		assert.equal(await mode(theirs), 0o700);
	});
});

test('placing the socket prepares the runtime directory, and a refused one is the failure', async () => {
	await scratch(async (root) => {
		const options = {
			dataDirectory: LONG,
			platform: 'linux',
			temporaryDirectory: root,
		};
		const placement = await placeControlSocket(options);
		assert.equal(placement.location, 'runtime-directory');
		assert.equal(await mode(placement.directory), 0o700);

		await chmod(placement.directory, 0o755);
		await assert.rejects(placeControlSocket(options), (error) => {
			assert.ok(error instanceof ControlSocketPlacementError);
			assert.equal(error.failure.runtimeDirectory, placement.directory);
			assert.equal(error.failure.refusal, 'other users can access it');
			return true;
		});
		assert.equal(await mode(placement.directory), 0o755);

		// A data directory that fits never touches a runtime directory.
		const fits = await placeControlSocket({ ...options, dataDirectory: SHORT });
		assert.equal(fits.location, 'data-directory');
	});
});

test('the message says what is wrong, the numbers, the remedy, and the paths, and no token', () => {
	const tooDeep = describeControlSocketPlacementFailure({
		dataDirectory: LONG,
		socketPath: `${LONG}/terminay-mcp-control.sock`,
		socketPathBytes: 172,
		limitBytes: 103,
		runtimeDirectory: '/very/long/tmp/terminay-0123456789ab',
		runtimeSocketPathBytes: 140,
	});
	assert.match(
		tooDeep,
		/data directory is at a path too long for a local socket/,
	);
	assert.match(tooDeep, /172 bytes and the limit is 103/);
	assert.match(tooDeep, /Start Terminay with a shorter data directory/);
	assert.ok(tooDeep.includes(`Data directory: ${LONG}.`));
	assert.match(
		tooDeep,
		/terminay-0123456789ab, is also at a path too long \(140 bytes\)/,
	);

	const refused = describeControlSocketPlacementFailure({
		dataDirectory: LONG,
		socketPath: `${LONG}/terminay-mcp-control.sock`,
		socketPathBytes: 172,
		limitBytes: 103,
		runtimeDirectory: '/tmp/terminay-0123456789ab',
		runtimeSocketPathBytes: 39,
		refusal: 'it is not owned by the current user',
	});
	assert.match(
		refused,
		/\/tmp\/terminay-0123456789ab, cannot be used: it is not owned by the current user\./,
	);
	for (const message of [tooDeep, refused])
		assert.doesNotMatch(message, /token/i);
	// The error's own message is the same text.
	assert.equal(
		new ControlSocketPlacementError({
			dataDirectory: LONG,
			socketPath: `${LONG}/terminay-mcp-control.sock`,
			socketPathBytes: 172,
			limitBytes: 103,
			runtimeDirectory: '/tmp/terminay-0123456789ab',
			runtimeSocketPathBytes: 39,
			refusal: 'it is not owned by the current user',
		}).message,
		refused,
	);
});

test('an endpoint in a runtime directory listens there and leaves the directory as it found it', async () => {
	await scratch(async (root) => {
		const placement = await placeControlSocket({
			dataDirectory: LONG,
			platform: 'linux',
			temporaryDirectory: root,
		});
		const endpoint = createControlEndpoint({
			socketPath: placement.path,
			tightenParentDirectory: false,
			capabilities: new ControlCapabilityStore(),
			dispatch: async () => ({ ok: true }),
		});
		await endpoint.start();
		try {
			assert.equal(endpoint.listening, true);
			assert.equal(await mode(placement.path), 0o600);
			assert.equal(await mode(placement.directory), 0o700);
			await new Promise((done, fail) => {
				const socket = connect(placement.path);
				socket.once('connect', () => {
					socket.destroy();
					done();
				});
				socket.once('error', fail);
			});
		} finally {
			await endpoint.stop();
		}
	});
});

test('an endpoint told not to tighten its directory does not change that directory', async () => {
	await scratch(async (root) => {
		const directory = join(root, 'open');
		await mkdir(directory);
		await chmod(directory, 0o755);
		const untouched = createControlEndpoint({
			socketPath: join(directory, 'control.sock'),
			tightenParentDirectory: false,
			capabilities: new ControlCapabilityStore(),
			dispatch: async () => ({ ok: true }),
		});
		await untouched.start();
		await untouched.stop();
		assert.equal(await mode(directory), 0o755);

		// The default, for a data directory, still closes it.
		const tightened = createControlEndpoint({
			socketPath: join(directory, 'control.sock'),
			capabilities: new ControlCapabilityStore(),
			dispatch: async () => ({ ok: true }),
		});
		await tightened.start();
		await tightened.stop();
		assert.equal(await mode(directory), 0o700);
	});
});
