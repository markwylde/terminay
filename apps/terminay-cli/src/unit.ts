import type { InstallLayout } from './layout.js';

/**
 * The unit and environment file the installer writes.
 *
 * Both are generated from these templates on every install and upgrade, with
 * one exception: the server id is written once and never rewritten, because it
 * is the identity paired devices know the machine by. Rewriting it on upgrade
 * would silently unpair every device.
 *
 * Neither file ever carries a vault passphrase, a device key, or pairing
 * material. Those live in the data root, which is the trust boundary; a unit
 * file is world-readable on most systems and an environment file is visible to
 * anything that can read the service's configuration.
 */

export interface ServiceConfiguration {
	readonly serverId: string;
	readonly dataRoot: string;
	readonly projectRoot: string;
	readonly port: number;
	readonly healthPort: number;
	readonly expose: string;
	readonly hostedDomain: string;
	readonly directOrigin?: string;
	readonly advertiseAddress?: string;
	readonly uiBundle: string;
}

export function renderEnvironmentFile(
	configuration: ServiceConfiguration,
): string {
	const lines = [
		'# Written by `terminay daemon install`. Edit and restart the service to change it.',
		'# No passphrase, device key, or pairing token belongs in this file.',
		`TERMINAY_SERVER_ID=${configuration.serverId}`,
		`TERMINAY_DATA_ROOT=${configuration.dataRoot}`,
		`TERMINAY_PROJECT_ROOT=${configuration.projectRoot}`,
		'TERMINAY_HTTP_HOST=0.0.0.0',
		`TERMINAY_HTTP_PORT=${configuration.port}`,
		// Health and readiness stay on loopback: they are an operator surface,
		// not part of what the server exposes to devices.
		'TERMINAY_HEALTH_HOST=127.0.0.1',
		`TERMINAY_HEALTH_PORT=${configuration.healthPort}`,
		`TERMINAY_EXPOSE=${configuration.expose}`,
		`TERMINAY_HOSTED_DOMAIN=${configuration.hostedDomain}`,
		...(configuration.directOrigin === undefined
			? []
			: [`TERMINAY_DIRECT_ORIGIN=${configuration.directOrigin}`]),
		// Written even when empty: an empty variable is how a cleared address
		// reaches the server, and it reads as unset there.
		...(configuration.advertiseAddress === undefined
			? []
			: [
					`TERMINAY_WEBRTC_ADVERTISE_ADDRESS=${configuration.advertiseAddress}`,
				]),
		'TERMINAY_AGENT_INTEGRATION=enabled',
		'TERMINAY_AI_PROVIDERS=disabled',
		'TERMINAY_LOG_SINK=journal',
		`TERMINAY_UI_BUNDLE=${configuration.uiBundle}`,
	];
	return `${lines.join('\n')}\n`;
}

/**
 * Parse an existing environment file so a reinstall can keep the values it is
 * not being asked to change — the server id above all.
 */
export function parseEnvironmentFile(
	contents: string,
): Readonly<Record<string, string>> {
	const values: Record<string, string> = {};
	for (const line of contents.split('\n')) {
		const trimmed = line.trim();
		if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
		const equals = trimmed.indexOf('=');
		if (equals <= 0) continue;
		values[trimmed.slice(0, equals)] = trimmed.slice(equals + 1);
	}
	return Object.freeze(values);
}

/**
 * Set or remove one variable in an existing environment file, leaving every
 * other line as it was.
 *
 * The file is documented as editable, so an upgrade that only needs to change
 * one value edits that value rather than regenerating the file and discarding
 * whatever the operator put there.
 */
export function withEnvironmentValue(
	contents: string,
	key: string,
	value: string | undefined,
): string {
	const lines = contents.split('\n');
	const kept = lines.filter((line) => !line.trimStart().startsWith(`${key}=`));
	if (value === undefined) {
		return kept.join('\n');
	}
	// Appended before the trailing blank the file ends with, so the result keeps
	// exactly one terminating newline.
	const trailing =
		kept.length > 0 && kept[kept.length - 1] === '' ? kept.pop() : undefined;
	kept.push(`${key}=${value}`);
	if (trailing !== undefined) kept.push(trailing);
	return kept.join('\n');
}

export interface UnitConfiguration {
	readonly layout: InstallLayout;
	readonly runAs: string;
	readonly workingDirectory: string;
}

export function renderUnit(configuration: UnitConfiguration): string {
	const { layout } = configuration;
	// System scope names the account explicitly; a user unit already runs as
	// its owner, and User=/Group= are rejected there.
	const account =
		layout.scope === 'system'
			? [`User=${configuration.runAs}`, `Group=${configuration.runAs}`]
			: [];
	return `[Unit]
Description=Terminay Server
Documentation=https://terminay.com/docs/installation
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
${account.join('\n')}${account.length > 0 ? '\n' : ''}WorkingDirectory=${configuration.workingDirectory}
EnvironmentFile=${layout.environmentFile}
ExecStart=${layout.currentLink}/bin/terminay-server
Restart=on-failure
RestartSec=5s
KillSignal=SIGTERM
TimeoutStopSec=15s
NoNewPrivileges=true
PrivateTmp=true
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=${layout.scope === 'system' ? 'multi-user.target' : 'default.target'}
`;
}
