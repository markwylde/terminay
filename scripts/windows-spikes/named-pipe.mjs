// Spike 1.1 (native-windows-desktop): how libuv creates a named pipe on
// Windows. Records whether a second bind to a taken name fails, the pipe's
// default DACL, whether a second unprivileged local account can connect, and
// whether a client that connects through a machine name (the remote path, over
// SMB) is served. Run with Node on Windows; prints JSON. KOFFI_DIR names a
// directory where koffi is installed.
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { connect, createServer } from 'node:net';
import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const name = `terminay-spike-${process.pid}`;
const local = `\\\\.\\pipe\\${name}`;
const result = { node: process.version, uv: process.versions.uv, pipe: local };

const listen = (path) =>
	new Promise((resolve) => {
		// The DACL probe connects and leaves at once; its write may then fail.
		const server = createServer((socket) => {
			socket.on('error', () => {});
			socket.end('served\n');
		});
		server.once('error', (error) => resolve({ server: null, error: error.code ?? String(error) }));
		server.listen(path, () => resolve({ server, error: null }));
	});

const tryConnect = (path) =>
	new Promise((resolve) => {
		const socket = connect(path);
		const timer = setTimeout(() => {
			socket.destroy();
			resolve('timeout');
		}, 5_000);
		let data = '';
		socket.on('data', (chunk) => {
			data += chunk;
		});
		socket.on('end', () => {
			clearTimeout(timer);
			resolve(data.trim() === 'served' ? 'served' : `ended:${data.trim()}`);
		});
		socket.on('error', (error) => {
			clearTimeout(timer);
			resolve(`error:${error.code ?? String(error)}`);
		});
	});

// The pipe's owner and DACL as SDDL, read through a handle opened for
// READ_CONTROL only.
function pipeSddl(path) {
	try {
		const koffi = createRequire(`${process.env.KOFFI_DIR}/`)('koffi');
		const kernel32 = koffi.load('kernel32.dll');
		const advapi32 = koffi.load('advapi32.dll');
		const CreateFileW = kernel32.func(
			'intptr_t __stdcall CreateFileW(str16 name, uint32_t access, uint32_t share, void *security, uint32_t disposition, uint32_t flags, intptr_t template)',
		);
		const CloseHandle = kernel32.func('int __stdcall CloseHandle(intptr_t handle)');
		const GetSecurityInfo = advapi32.func(
			'uint32_t __stdcall GetSecurityInfo(intptr_t handle, int type, uint32_t info, _Out_ void **owner, _Out_ void **group, _Out_ void **dacl, _Out_ void **sacl, _Out_ void **descriptor)',
		);
		const ConvertSecurityDescriptorToStringSecurityDescriptorW = advapi32.func(
			'int __stdcall ConvertSecurityDescriptorToStringSecurityDescriptorW(void *descriptor, uint32_t revision, uint32_t info, _Out_ void **text, _Out_ uint32_t *length)',
		);
		const handle = CreateFileW(path, 0x00020000, 0, null, 3, 0, 0);
		if (handle === -1) return 'error: open';
		const descriptor = [null];
		const status = GetSecurityInfo(handle, 6, 0x5, [null], [null], [null], [null], descriptor);
		CloseHandle(handle);
		if (status !== 0) return `error: GetSecurityInfo ${status}`;
		const text = [null];
		if (!ConvertSecurityDescriptorToStringSecurityDescriptorW(descriptor[0], 1, 0x5, text, [0]))
			return 'error: convert';
		return koffi.decode(text[0], 'char16_t', -1);
	} catch (error) {
		return `error: ${String(error.message ?? error).slice(0, 300)}`;
	}
}

// Connect as a second, unprivileged local account, through a helper that
// writes what it saw to a file.
async function otherUserConnect(path) {
	const user = 'tpipespike';
	const password = `Tp1!${process.pid}xyzQ`;
	const client = fileURLToPath(new URL('./named-pipe-client.mjs', import.meta.url));
	const out = `C:\\Users\\Public\\pipe-other-user-${process.pid}.txt`;
	try {
		await run('net', ['user', user, password, '/add']);
		await run('powershell.exe', [
			'-NoProfile',
			'-Command',
			`$c = New-Object System.Management.Automation.PSCredential('${user}', (ConvertTo-SecureString '${password}' -AsPlainText -Force)); ` +
				`$p = Start-Process -FilePath '${process.execPath}' -ArgumentList '"${client}"','"${path}"','"${out}"' -Credential $c -WorkingDirectory 'C:\\Users\\Public' -PassThru; ` +
				`if (-not $p.WaitForExit(60000)) { $p.Kill(); throw 'second user client did not finish' }`,
		], { timeout: 90_000 });
		const { stdout } = await run('powershell.exe', ['-NoProfile', '-Command', `Get-Content -LiteralPath '${out}'`]);
		return stdout.trim();
	} catch (error) {
		return `error: ${String(error.message ?? error).slice(0, 400)}`;
	} finally {
		await run('net', ['user', user, '/delete']).catch(() => {});
	}
}

const first = await listen(local);
result.firstBind = first.error ?? 'ok';
const second = await listen(local);
result.secondBind = second.error ?? 'ok (FIRST_PIPE_INSTANCE not set)';
second.server?.close();

result.sddl = pipeSddl(local);
result.whoami = (await run('whoami', ['/user', '/fo', 'csv', '/nh'])).stdout.trim();
result.localClient = await tryConnect(local);
result.otherUserClient = await otherUserConnect(local);
result.loopbackClient = await tryConnect(`\\\\localhost\\pipe\\${name}`);
result.machineNameClient = await tryConnect(`\\\\${hostname()}\\pipe\\${name}`);
first.server?.close();

console.log(JSON.stringify(result, null, 2));
