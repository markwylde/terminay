/**
 * Argument parsing for the `terminay` binary.
 *
 * The parser is strict on purpose: an operator typing an install command as
 * root should be told a flag is unknown rather than have it silently ignored,
 * because the ignored flag might have been the one choosing the account the
 * daemon's terminals run as.
 */

export type DaemonCommand =
	| 'install'
	| 'uninstall'
	| 'start'
	| 'stop'
	| 'status'
	| 'upgrade'
	| 'qr-code'
	| 'approvals'
	| 'approve'
	| 'deny'
	| 'reset-identity';

export type InstallScope = 'system' | 'user';
export type PairingMode = 'hosted' | 'direct';

export interface DaemonOptions {
	readonly scope?: InstallScope;
	readonly runAs?: string;
	readonly port?: number;
	readonly directOrigin?: string;
	/** An address and UDP port to offer as an additional ICE candidate. Empty
	 * string clears a previously configured one. */
	readonly advertiseAddress?: string;
	readonly hostedDomain?: string;
	readonly expose?: string;
	readonly projectRoot?: string;
	readonly allowDowngrade: boolean;
	readonly purge: boolean;
	readonly yes: boolean;
	readonly wait: boolean;
	readonly mode?: PairingMode;
}

export interface ParsedCommandLine {
	readonly command: DaemonCommand | 'help';
	/** `install` and `upgrade` take an optional version reference. */
	readonly ref?: string;
	/** `approve` and `deny` take a required approval id. */
	readonly approvalId?: string;
	readonly options: DaemonOptions;
}

const COMMANDS: readonly DaemonCommand[] = [
	'install',
	'uninstall',
	'start',
	'stop',
	'status',
	'upgrade',
	'qr-code',
	'approvals',
	'approve',
	'deny',
	'reset-identity',
];

/** `pairing-url` is the descriptive name; `qr-code` is what it renders. */
const ALIASES: Readonly<Record<string, DaemonCommand>> = Object.freeze({
	'pairing-url': 'qr-code',
});

const VALUE_FLAGS = Object.freeze([
	'--run-as',
	'--port',
	'--direct-origin',
	'--advertise-address',
	'--hosted-domain',
	'--expose',
	'--project-root',
	'--mode',
]);

/** Flags whose empty value means "remove what was configured before". */
const CLEARABLE_FLAGS = Object.freeze(['--advertise-address']);

const BOOLEAN_FLAGS = Object.freeze([
	'--system',
	'--user',
	'--allow-downgrade',
	'--purge',
	'--yes',
	'--no-wait',
]);

/**
 * Which flags each command accepts. A flag that does nothing for a command is
 * rejected rather than accepted and dropped, so `upgrade --purge` cannot read
 * as though it were understood.
 */
const ACCEPTED: Readonly<Record<DaemonCommand, readonly string[]>> =
	Object.freeze({
		install: [
			'--system',
			'--user',
			'--run-as',
			'--port',
			'--direct-origin',
			'--advertise-address',
			'--hosted-domain',
			'--expose',
			'--project-root',
		],
		upgrade: [
			'--system',
			'--user',
			'--allow-downgrade',
			// How a server is reached can change without changing its version,
			// and an upgrade is the moment an operator is already editing it.
			'--advertise-address',
		],
		uninstall: ['--system', '--user', '--purge', '--yes'],
		start: ['--system', '--user'],
		stop: ['--system', '--user'],
		status: ['--system', '--user'],
		'qr-code': ['--system', '--user', '--no-wait', '--mode'],
		approvals: ['--system', '--user'],
		approve: ['--system', '--user'],
		deny: ['--system', '--user'],
		'reset-identity': ['--system', '--user', '--yes'],
	});

const REF_COMMANDS: readonly DaemonCommand[] = ['install', 'upgrade'];
const APPROVAL_ID_COMMANDS: readonly DaemonCommand[] = ['approve', 'deny'];
const APPROVAL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export class UsageError extends Error {}

function fail(message: string): never {
	throw new UsageError(message);
}

function parsePort(raw: string): number {
	if (!/^\d{1,5}$/u.test(raw))
		fail('--port must be a whole number between 1 and 65535');
	const port = Number(raw);
	if (port < 1 || port > 65535)
		fail('--port must be a whole number between 1 and 65535');
	return port;
}

/**
 * Is this the address a machine uses to talk to itself?
 *
 * `127.0.0.0/8` and `::1` in every spelling. A peer decides for itself whether
 * a candidate is worth probing, and a loopback address names the peer's own
 * machine rather than this one, so it is within its rights to skip it.
 */
function isLoopbackHost(host: string): boolean {
	const value = host.toLowerCase();
	// `::ffff:127.0.0.1` is loopback wearing an IPv6 spelling.
	const ipv4 = value.startsWith('::ffff:') ? value.slice(7) : value;
	if (/^127(?:\.[0-9]{1,3}){3}$/u.test(ipv4)) return true;
	if (!value.includes(':')) return false;
	// Expand the one `::` so `::1`, `0:0:0:0:0:0:0:1`, and `0::1` all compare
	// the same way.
	let groups: string[];
	if (value.includes('::')) {
		const [head = '', tail = ''] = value.split('::', 2);
		const left = head === '' ? [] : head.split(':');
		const right = tail === '' ? [] : tail.split(':');
		const filler = 8 - left.length - right.length;
		if (filler < 1) return false;
		groups = [...left, ...Array.from({ length: filler }, () => '0'), ...right];
	} else {
		groups = value.split(':');
	}
	if (groups.length !== 8) return false;
	return groups.every(
		(group, index) => Number.parseInt(group, 16) === (index === 7 ? 1 : 0),
	);
}

/**
 * Validate `<host>:<port>` before anything is written.
 *
 * Literal addresses only: an ICE candidate is where a peer sends connectivity
 * checks, and a hostname resolves on the peer's machine rather than naming the
 * address an operator forwarded. Empty passes through as the clearing form.
 */
function parseAdvertiseAddress(raw: string): string {
	if (raw === '') return raw;
	const bracketed = /^\[([0-9A-Fa-f:.]+)\]:(\d{1,5})$/u.exec(raw.trim());
	const plain = /^([0-9]{1,3}(?:\.[0-9]{1,3}){3}):(\d{1,5})$/u.exec(raw.trim());
	const match = bracketed ?? plain;
	if (match === null) {
		fail(
			`--advertise-address must be a literal address and port, such as 192.168.1.20:51000 or [2001:db8::20]:51000 (got ${raw}). An ICE candidate is a destination for the other side's connectivity checks, so a hostname cannot stand in for it.`,
		);
	}
	const port = Number(match[2]);
	if (port < 1 || port > 65535) {
		fail('--advertise-address port must be between 1 and 65535');
	}
	if (
		bracketed === null &&
		(match[1] as string).split('.').some((octet) => Number(octet) > 255)
	) {
		fail(`--advertise-address is not a valid IPv4 address: ${match[1]}`);
	}
	// Refused rather than warned about: the address is written here and the
	// failure it causes arrives minutes later, in a browser, as a message about
	// data channels. Firefox prunes a remote loopback candidate without sending
	// a single connectivity check, so such a server pairs from Chromium and
	// hangs everywhere else with nothing to read.
	if (isLoopbackHost(match[1] as string)) {
		fail(
			`--advertise-address cannot be a loopback address (got ${raw}). A browser need not send connectivity checks to a loopback candidate and Firefox does not, so this server would pair from some browsers and hang in others. Use this machine's routable address, such as 192.168.1.20:${port} — it is the address the forwarded port already answers on.`,
		);
	}
	return raw.trim();
}

function parseMode(raw: string): PairingMode {
	if (raw !== 'hosted' && raw !== 'direct')
		fail('--mode must be hosted or direct');
	return raw;
}

export function parseCommandLine(argv: readonly string[]): ParsedCommandLine {
	const noOptions: DaemonOptions = Object.freeze({
		allowDowngrade: false,
		purge: false,
		yes: false,
		wait: true,
	});
	if (argv.length === 0 || argv[0] === '--help' || argv[0] === 'help') {
		return Object.freeze({ command: 'help', options: noOptions });
	}
	if (argv[0] !== 'daemon')
		fail(`unknown command: ${argv[0]}. The only command group is \`daemon\`.`);

	const rest = argv.slice(1);
	if (rest.length === 0)
		return Object.freeze({ command: 'help', options: noOptions });
	if (rest.includes('--help'))
		return Object.freeze({ command: 'help', options: noOptions });

	const requested = rest[0] as string;
	const command =
		ALIASES[requested] ??
		(COMMANDS.includes(requested as DaemonCommand)
			? (requested as DaemonCommand)
			: undefined);
	if (command === undefined) {
		fail(
			`unknown daemon command: ${requested}. Expected one of: ${[...COMMANDS, ...Object.keys(ALIASES)].join(', ')}.`,
		);
	}

	const accepted = ACCEPTED[command];
	const positional: string[] = [];
	const values = new Map<string, string>();
	const booleans = new Set<string>();

	for (let index = 1; index < rest.length; index += 1) {
		const token = rest[index] as string;
		if (!token.startsWith('-')) {
			positional.push(token);
			continue;
		}
		const equals = token.indexOf('=');
		const name = equals < 0 ? token : token.slice(0, equals);
		if (VALUE_FLAGS.includes(name)) {
			if (!accepted.includes(name))
				fail(`${name} is not accepted by \`daemon ${command}\``);
			let value: string;
			if (equals >= 0) {
				value = token.slice(equals + 1);
			} else {
				const next = rest[index + 1];
				if (next === undefined || next.startsWith('-'))
					fail(`${name} requires a value`);
				value = next;
				index += 1;
			}
			// An empty value is a usage error everywhere except the advertised
			// address, where it is how an operator removes one they set earlier.
			if (value.length === 0 && !CLEARABLE_FLAGS.includes(name)) {
				fail(`${name} requires a value`);
			}
			if (values.has(name)) fail(`${name} was given more than once`);
			values.set(name, value);
			continue;
		}
		if (BOOLEAN_FLAGS.includes(name)) {
			if (equals >= 0) fail(`${name} does not take a value`);
			if (!accepted.includes(name))
				fail(`${name} is not accepted by \`daemon ${command}\``);
			booleans.add(name);
			continue;
		}
		fail(`unknown flag: ${name}`);
	}

	if (booleans.has('--system') && booleans.has('--user'))
		fail('--system and --user cannot both be given');

	let ref: string | undefined;
	let approvalId: string | undefined;
	if (REF_COMMANDS.includes(command)) {
		if (positional.length > 1)
			fail(`\`daemon ${command}\` takes at most one version reference`);
		ref = positional[0];
	} else if (APPROVAL_ID_COMMANDS.includes(command)) {
		if (positional.length !== 1)
			fail(`\`daemon ${command}\` requires exactly one approval id`);
		approvalId = positional[0] as string;
		if (!APPROVAL_ID.test(approvalId))
			fail('approval id is not a valid identifier');
	} else if (positional.length > 0) {
		fail(`\`daemon ${command}\` takes no arguments`);
	}

	const port = values.get('--port');
	const mode = values.get('--mode');
	const scope = booleans.has('--system')
		? 'system'
		: booleans.has('--user')
			? 'user'
			: undefined;

	const options: DaemonOptions = Object.freeze({
		...(scope === undefined ? {} : { scope }),
		...(values.has('--run-as')
			? { runAs: values.get('--run-as') as string }
			: {}),
		...(port === undefined ? {} : { port: parsePort(port) }),
		...(values.has('--advertise-address')
			? {
					advertiseAddress: parseAdvertiseAddress(
						values.get('--advertise-address') as string,
					),
				}
			: {}),
		...(values.has('--direct-origin')
			? { directOrigin: values.get('--direct-origin') as string }
			: {}),
		...(values.has('--hosted-domain')
			? { hostedDomain: values.get('--hosted-domain') as string }
			: {}),
		...(values.has('--expose')
			? { expose: values.get('--expose') as string }
			: {}),
		...(values.has('--project-root')
			? { projectRoot: values.get('--project-root') as string }
			: {}),
		allowDowngrade: booleans.has('--allow-downgrade'),
		purge: booleans.has('--purge'),
		yes: booleans.has('--yes'),
		wait: !booleans.has('--no-wait'),
		...(mode === undefined ? {} : { mode: parseMode(mode) }),
	});

	return Object.freeze({
		command,
		...(ref === undefined ? {} : { ref }),
		...(approvalId === undefined ? {} : { approvalId }),
		options,
	});
}

export const HELP_TEXT = `terminay — install and control a headless Terminay Server

Usage:
  npx terminay daemon <command> [arguments] [flags]

Commands:
  install [ref]        Install and start the server. \`ref\` is a tag such as
                       v4.1.1, \`main\` for the rolling channel, or a branch or
                       commit to build from source. Defaults to the latest tag.
  upgrade [ref]        Upgrade, following the installed channel by default.
  uninstall            Stop and remove the service and installed versions.
  start | stop         Start or stop the service.
  status               Report unit state, version, channel, and exposure.
  qr-code              Show a scannable pairing code and approve the device
                       that scans it. Alias: pairing-url.
  approvals            List pending device approvals.
  approve <id>         Approve a pending device.
  deny <id>            Deny a pending device.
  reset-identity       Rotate the host key and revoke every paired device.

Flags:
  --system, --user     Install scope. Prompted when a terminal is attached.
  --run-as <user>      Account the server and its terminals run as.
  --port <port>        Port the server listens on.
  --direct-origin <o>  Origin devices reach directly, such as
                       https://box.example.com:8443.
  --advertise-address <addr:port>
                       An address and UDP port to offer as an extra connection
                       candidate, for a server reachable only at a forwarded
                       address — a container, or behind a port forward. Use the
                       machine's routable address, such as 192.168.1.20:51000;
                       a loopback address is refused because a browser need not
                       send connectivity checks to one. That port and the three
                       above it must be forwarded to this machine. Pass an
                       empty value to remove one set earlier.
  --hosted-domain <d>  Hosted signalling domain.
  --expose <modes>     off, hosted, direct, or hosted,direct.
  --project-root <p>   Directory the server opens projects from.
  --allow-downgrade    Permit upgrade to an older version.
  --purge              Also remove the data root on uninstall.
  --yes                Skip confirmation prompts.
  --no-wait            Print pairing URLs and exit without waiting.
  --mode <m>           Render the hosted or direct pairing URL.
  --help               Show this help.
`;
