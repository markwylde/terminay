import { createRequire } from 'node:module';
import type { WindowsProcessRow } from './windowsSelection.js';

/**
 * Win32 calls Node does not expose, bound through `koffi` (ADR-0080). Every
 * binding the server makes is declared in this module, with its types, and
 * `koffi` is loaded only when one of these functions is first called, which
 * happens only on Windows. A call that fails is an absent answer (`null`),
 * never a throw, so a caller reports `limited` rather than crashing.
 *
 * Everything here runs with the server's own token and asks for no privilege
 * it does not already have: it reads only the current user's processes.
 */

// biome-ignore lint/suspicious/noExplicitAny: koffi's function objects are untyped calls.
type Fn = (...args: any[]) => any;

interface Bindings {
	readonly koffi: typeof import('koffi');
	readonly CreateToolhelp32Snapshot: Fn;
	readonly Process32FirstW: Fn;
	readonly Process32NextW: Fn;
	readonly CloseHandle: Fn;
	readonly OpenProcess: Fn;
	readonly GetProcessTimes: Fn;
	readonly ReadProcessMemory: Fn;
	readonly NtQueryInformationProcess: Fn;
	readonly OpenProcessToken: Fn;
	readonly GetTokenInformation: Fn;
	readonly GetLengthSid: Fn;
	readonly CopySid: Fn;
	readonly ConvertStringSecurityDescriptorToSecurityDescriptorW: Fn;
	readonly SetFileSecurityW: Fn;
	readonly LocalFree: Fn;
	readonly processEntrySize: number;
	readonly basicInformationSize: number;
}

const TH32CS_SNAPPROCESS = 0x2;
const INVALID_HANDLE_VALUE = -1;
const PROCESS_VM_READ = 0x0010;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const TOKEN_QUERY = 0x0008;
const TOKEN_USER = 1;
const PROCESS_BASIC_INFORMATION_CLASS = 0;
const PROCESS_WOW64_INFORMATION_CLASS = 26;
const DACL_SECURITY_INFORMATION = 0x4;
const SDDL_REVISION_1 = 1;
/** FILETIME counts 100 ns ticks from 1601; the epoch is this many later. */
const FILETIME_UNIX_EPOCH = 116_444_736_000_000_000n;
/** No current directory a process can hold is longer than this, in bytes. */
const MAX_DIRECTORY_BYTES = 32_767 * 2;

const UTF16LE = new TextDecoder('utf-16le');

let bindings: Bindings | null | undefined;

function view(bytes: Uint8Array): DataView {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function load(): Bindings | null {
	if (bindings !== undefined) return bindings;
	try {
		const koffi = createRequire(import.meta.url)(
			'koffi',
		) as typeof import('koffi');
		const kernel32 = koffi.load('kernel32.dll');
		const advapi32 = koffi.load('advapi32.dll');
		const ntdll = koffi.load('ntdll.dll');
		const entry = koffi.struct('TERMINAY_PROCESSENTRY32W', {
			dwSize: 'uint32',
			cntUsage: 'uint32',
			th32ProcessID: 'uint32',
			th32DefaultHeapID: 'uintptr_t',
			th32ModuleID: 'uint32',
			cntThreads: 'uint32',
			th32ParentProcessID: 'uint32',
			pcPriClassBase: 'int32',
			dwFlags: 'uint32',
			szExeFile: koffi.array('char16_t', 260, 'String'),
		});
		const basic = koffi.struct('TERMINAY_PROCESS_BASIC_INFORMATION', {
			ExitStatus: 'int32',
			PebBaseAddress: 'uint64',
			AffinityMask: 'uint64',
			BasePriority: 'int32',
			UniqueProcessId: 'uint64',
			InheritedFromUniqueProcessId: 'uint64',
		});
		// Handles are pointer-sized integers here, so INVALID_HANDLE_VALUE (-1)
		// compares as a number. Remote addresses are passed as integers: on x64
		// a pointer and a 64-bit integer travel in the same register.
		bindings = {
			koffi,
			CreateToolhelp32Snapshot: kernel32.func(
				'intptr_t __stdcall CreateToolhelp32Snapshot(uint32_t flags, uint32_t pid)',
			),
			Process32FirstW: kernel32.func(
				'int __stdcall Process32FirstW(intptr_t snapshot, _Inout_ TERMINAY_PROCESSENTRY32W *entry)',
			),
			Process32NextW: kernel32.func(
				'int __stdcall Process32NextW(intptr_t snapshot, _Inout_ TERMINAY_PROCESSENTRY32W *entry)',
			),
			CloseHandle: kernel32.func('int __stdcall CloseHandle(intptr_t handle)'),
			OpenProcess: kernel32.func(
				'intptr_t __stdcall OpenProcess(uint32_t access, int inherit, uint32_t pid)',
			),
			GetProcessTimes: kernel32.func(
				'int __stdcall GetProcessTimes(intptr_t process, _Out_ uint64_t *creation, _Out_ uint64_t *exit, _Out_ uint64_t *kernel, _Out_ uint64_t *user)',
			),
			ReadProcessMemory: kernel32.func(
				'int __stdcall ReadProcessMemory(intptr_t process, uint64_t address, _Out_ void *buffer, size_t size, _Out_ size_t *read)',
			),
			NtQueryInformationProcess: ntdll.func(
				'int32_t __stdcall NtQueryInformationProcess(intptr_t process, int32_t informationClass, _Out_ void *information, uint32_t length, _Out_ uint32_t *returned)',
			),
			OpenProcessToken: advapi32.func(
				'int __stdcall OpenProcessToken(intptr_t process, uint32_t access, _Out_ intptr_t *token)',
			),
			GetTokenInformation: advapi32.func(
				'int __stdcall GetTokenInformation(intptr_t token, int32_t informationClass, _Out_ void *information, uint32_t length, _Out_ uint32_t *returned)',
			),
			GetLengthSid: advapi32.func(
				'uint32_t __stdcall GetLengthSid(uint64_t sid)',
			),
			CopySid: advapi32.func(
				'int __stdcall CopySid(uint32_t length, _Out_ void *destination, uint64_t source)',
			),
			ConvertStringSecurityDescriptorToSecurityDescriptorW: advapi32.func(
				'int __stdcall ConvertStringSecurityDescriptorToSecurityDescriptorW(str16 sddl, uint32_t revision, _Out_ void **descriptor, void *size)',
			),
			SetFileSecurityW: advapi32.func(
				'int __stdcall SetFileSecurityW(str16 path, uint32_t information, void *descriptor)',
			),
			LocalFree: kernel32.func('void * __stdcall LocalFree(void *memory)'),
			processEntrySize: koffi.sizeof(entry),
			basicInformationSize: koffi.sizeof(basic),
		};
	} catch {
		bindings = null;
	}
	return bindings;
}

/** Whether the bindings could be loaded. On Windows, false is a startup failure. */
export function windowsBindingsAvailable(): boolean {
	return load() !== null;
}

/**
 * One snapshot of the process table, with each process's start time where it
 * can be read. A process whose start time cannot be read is still listed, with
 * a start time of 0, so it is never taken for a child of anything younger.
 */
export function readWindowsProcessTable(): WindowsProcessRow[] | null {
	const api = load();
	if (api === null) return null;
	const snapshot = Number(api.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0));
	if (snapshot === INVALID_HANDLE_VALUE) return null;
	const rows: WindowsProcessRow[] = [];
	try {
		const entry: Record<string, unknown> = { dwSize: api.processEntrySize };
		let more = api.Process32FirstW(snapshot, entry) !== 0;
		while (more) {
			const pid = Number(entry.th32ProcessID);
			rows.push({
				pid,
				ppid: Number(entry.th32ParentProcessID),
				exe: String(entry.szExeFile),
				createdAt: processCreatedAt(api, pid) ?? 0,
			});
			entry.dwSize = api.processEntrySize;
			more = api.Process32NextW(snapshot, entry) !== 0;
		}
	} finally {
		api.CloseHandle(snapshot);
	}
	return rows;
}

function processCreatedAt(api: Bindings, pid: number): number | null {
	if (pid === 0) return null;
	const handle = Number(
		api.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid),
	);
	if (handle === 0) return null;
	try {
		const creation = [0n];
		if (api.GetProcessTimes(handle, creation, [0n], [0n], [0n]) === 0)
			return null;
		return Number((BigInt(creation[0] ?? 0n) - FILETIME_UNIX_EPOCH) / 10_000n);
	} finally {
		api.CloseHandle(handle);
	}
}

/**
 * The current directory Windows records for a process, from its process
 * parameters (`PEB.ProcessParameters.CurrentDirectory.DosPath`). A 32-bit
 * process under WoW64 keeps its own 32-bit copy, which is the one it updates,
 * so that is the one read for it. Every read is bounded and every pointer
 * checked; anything unexpected is `null`.
 */
export function readWindowsProcessCwd(pid: number): string | null {
	const api = load();
	if (api === null || !Number.isSafeInteger(pid) || pid <= 0) return null;
	const handle = Number(
		api.OpenProcess(
			PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ,
			0,
			pid,
		),
	);
	if (handle === 0) return null;
	try {
		const wow64 = Buffer.alloc(8);
		const wow64Status = api.NtQueryInformationProcess(
			handle,
			PROCESS_WOW64_INFORMATION_CLASS,
			wow64,
			8,
			[0],
		);
		const peb32 = wow64Status === 0 ? view(wow64).getBigUint64(0, true) : 0n;
		if (peb32 !== 0n) return readCwd32(api, handle, peb32);
		const basic = Buffer.alloc(api.basicInformationSize);
		if (
			api.NtQueryInformationProcess(
				handle,
				PROCESS_BASIC_INFORMATION_CLASS,
				basic,
				api.basicInformationSize,
				[0],
			) !== 0
		)
			return null;
		// PROCESS_BASIC_INFORMATION: ExitStatus (4) + padding (4), then the PEB.
		return readCwd64(api, handle, view(basic).getBigUint64(8, true));
	} finally {
		api.CloseHandle(handle);
	}
}

function readCwd64(api: Bindings, handle: number, peb: bigint): string | null {
	// PEB.ProcessParameters at 0x20; CurrentDirectory.DosPath at 0x38 in the
	// parameters: Length (u16), MaximumLength (u16), padding, Buffer (u64).
	const parameters = readPointer64(api, handle, peb + 0x20n);
	if (parameters === null) return null;
	const dosPath = readRemote(api, handle, parameters + 0x38n, 16);
	if (dosPath === null) return null;
	return readPath(
		api,
		handle,
		view(dosPath).getUint16(0, true),
		view(dosPath).getBigUint64(8, true),
	);
}

function readCwd32(api: Bindings, handle: number, peb: bigint): string | null {
	// PEB32.ProcessParameters at 0x10; CurrentDirectory.DosPath at 0x24 in the
	// 32-bit parameters: Length (u16), MaximumLength (u16), Buffer (u32).
	const parameters = readRemote(api, handle, peb + 0x10n, 4);
	if (parameters === null) return null;
	const dosPath = readRemote(
		api,
		handle,
		BigInt(view(parameters).getUint32(0, true)) + 0x24n,
		8,
	);
	if (dosPath === null) return null;
	return readPath(
		api,
		handle,
		view(dosPath).getUint16(0, true),
		BigInt(view(dosPath).getUint32(4, true)),
	);
}

function readPath(
	api: Bindings,
	handle: number,
	length: number,
	address: bigint,
): string | null {
	if (length === 0 || length % 2 !== 0 || length > MAX_DIRECTORY_BYTES)
		return null;
	if (address === 0n) return null;
	const bytes = readRemote(api, handle, address, length);
	if (bytes === null) return null;
	const path = UTF16LE.decode(bytes);
	// Windows keeps a trailing separator on every current directory; a drive
	// root (`C:\`) keeps it, everything else is reported without it.
	return /^[A-Za-z]:\\$/u.test(path) ? path : path.replace(/\\+$/u, '');
}

function readPointer64(
	api: Bindings,
	handle: number,
	address: bigint,
): bigint | null {
	const bytes = readRemote(api, handle, address, 8);
	if (bytes === null) return null;
	const pointer = view(bytes).getBigUint64(0, true);
	return pointer === 0n ? null : pointer;
}

function readRemote(
	api: Bindings,
	handle: number,
	address: bigint,
	size: number,
): Buffer | null {
	if (address === 0n) return null;
	const buffer = Buffer.alloc(size);
	const read = [0];
	if (api.ReadProcessMemory(handle, address, buffer, size, read) === 0)
		return null;
	return Number(read[0]) === size ? buffer : null;
}

/**
 * The SID of the user this process runs as, from its own token, in string
 * form (`S-1-5-21-…`). Not `%USERNAME%`, which any parent can set.
 */
export function currentWindowsUserSid(): string | null {
	const api = load();
	if (api === null) return null;
	const token = [0];
	// -1 is the pseudo-handle for the current process.
	if (api.OpenProcessToken(-1, TOKEN_QUERY, token) === 0) return null;
	const tokenHandle = Number(token[0]);
	try {
		const information = Buffer.alloc(256);
		if (
			api.GetTokenInformation(
				tokenHandle,
				TOKEN_USER,
				information,
				information.byteLength,
				[0],
			) === 0
		)
			return null;
		// TOKEN_USER starts with SID_AND_ATTRIBUTES, whose first field is the
		// SID's address. The SID is copied out rather than read in place.
		const sidAddress = view(information).getBigUint64(0, true);
		if (sidAddress === 0n) return null;
		const length = Number(api.GetLengthSid(sidAddress));
		if (length < 8 || length > 68) return null;
		const sid = Buffer.alloc(length);
		if (api.CopySid(length, sid, sidAddress) === 0) return null;
		return formatSid(sid);
	} finally {
		api.CloseHandle(tokenHandle);
	}
}

/** A binary SID in its string form. Exported for tests. */
export function formatSid(sid: Uint8Array): string | null {
	if (sid.byteLength < 8) return null;
	const revision = view(sid).getUint8(0);
	const count = view(sid).getUint8(1);
	if (sid.byteLength !== 8 + count * 4) return null;
	// The identifier authority is a 48-bit big-endian value.
	const authority =
		view(sid).getUint16(2, false) * 2 ** 32 + view(sid).getUint32(4, false);
	const parts = [`S-${revision}-${authority}`];
	for (let index = 0; index < count; index += 1)
		parts.push(String(view(sid).getUint32(8 + index * 4, true)));
	return parts.join('-');
}

/**
 * Give a directory a protected DACL that names only the user, SYSTEM, and
 * Administrators, replacing whatever it inherited (ADR-0079 §2). Applied on
 * every start, so a directory whose DACL was widened is closed again.
 */
export function protectWindowsDirectory(
	path: string,
	userSid: string,
): boolean {
	const api = load();
	if (api === null || !/^S-1-\d+(?:-\d+)+$/u.test(userSid)) return false;
	const sddl = `D:P(A;OICI;FA;;;${userSid})(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)`;
	const descriptor: unknown[] = [null];
	if (
		api.ConvertStringSecurityDescriptorToSecurityDescriptorW(
			sddl,
			SDDL_REVISION_1,
			descriptor,
			null,
		) === 0
	)
		return false;
	try {
		return (
			api.SetFileSecurityW(path, DACL_SECURITY_INFORMATION, descriptor[0]) !== 0
		);
	} finally {
		api.LocalFree(descriptor[0]);
	}
}
