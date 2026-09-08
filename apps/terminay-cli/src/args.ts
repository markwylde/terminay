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
	'--hosted-domain',
	'--expose',
	'--project-root',
	'--mode',
]);

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
			'--hosted-domain',
			'--expose',
			'--project-root',
		],
		upgrade: ['--system', '--user', '--allow-downgrade'],
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
			if (value.length === 0) fail(`${name} requires a value`);
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
