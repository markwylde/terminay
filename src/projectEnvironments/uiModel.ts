export type ProjectEnvironmentStatus =
	| 'ready'
	| 'connecting'
	| 'reconnecting'
	| 'provisioning'
	| 'starting'
	| 'stopping'
	| 'offline'
	| 'authentication-required'
	| 'host-key-changed'
	| 'permission-denied'
	| 'extension-missing'
	| 'extension-disabled'
	| 'extension-incompatible'
	| 'unreachable'
	| 'failed';

/** Fixed renderer DTO. It intentionally contains presentation-safe data only. */
export type ProjectEnvironmentSummaryDto = Readonly<{
	id: string;
	providerId: string;
	providerLabel: string;
	name: string;
	endpointSummary: string;
	defaultRoot?: string;
	status: ProjectEnvironmentStatus;
	referencedProjectCount: number;
	isThisServer?: boolean;
	isFavourite?: boolean;
	lastUsedAt?: string;
}>;

export type ExtensionSummaryDto = Readonly<{
	id: string;
	packageName: string;
	displayName: string;
	description: string;
	version?: string;
	state: 'available' | 'installed' | 'disabled' | 'incompatible' | 'failed' | 'quarantined' | 'pending';
	official: boolean;
	permissions: readonly string[];
	dependants: readonly string[];
	provenance?: string;
}>;

export type DeclarativeFieldDto = Readonly<{
	id: string;
	label: string;
	kind: 'text' | 'number' | 'url' | 'secret' | 'checkbox' | 'switch' | 'textarea' | 'select';
	required?: boolean;
	description?: string;
	placeholder?: string;
	options?: readonly Readonly<{ label: string; value: string; description?: string }>[];
	visibleWhen?: Readonly<{ fieldId: string; equals: string | boolean }>;
}>;

export type DeclarativeSectionDto = Readonly<{
	id: string;
	title: string;
	description?: string;
	disclosure?: boolean;
	fields: readonly DeclarativeFieldDto[];
}>;

export type DeclarativeFormDto = Readonly<{
	id: string;
	title: string;
	description?: string;
	sections: readonly DeclarativeSectionDto[];
	submitLabel: string;
}>;

export const PROJECT_ENVIRONMENT_FIXTURES: readonly ProjectEnvironmentSummaryDto[] = Object.freeze([
	{
		id: 'terminay:this-server',
		providerId: 'terminay:this-server',
		providerLabel: 'This server',
		name: 'This server',
		endpointSummary: 'Local to the selected Terminay Server',
		status: 'ready',
		referencedProjectCount: 1,
		isThisServer: true,
		isFavourite: true,
	},
	{
		id: 'fixture.ssh.example-1',
		providerId: 'terminay.ssh',
		providerLabel: 'SSH',
		name: 'Example SSH 1',
		endpointSummary: 'dev@example.internal:22',
		defaultRoot: '/srv/projects',
		status: 'ready',
		referencedProjectCount: 0,
		isFavourite: true,
		lastUsedAt: '2026-08-12T09:00:00.000Z',
	},
	{
		id: 'fixture.puzed.vm-1',
		providerId: 'terminay.puzed',
		providerLabel: 'Puzed',
		name: 'Puzed VM 1',
		endpointSummary: 'Family · terminay-dev-1',
		defaultRoot: '/home/terminay',
		status: 'offline',
		referencedProjectCount: 0,
		lastUsedAt: '2026-08-11T09:00:00.000Z',
	},
]);

export const EXTENSION_FIXTURES: readonly ExtensionSummaryDto[] = Object.freeze([
	{
		id: 'terminay.ssh',
		packageName: 'terminay-plugin-ssh',
		displayName: 'SSH',
		description: 'Open projects on existing SSH servers.',
		state: 'available',
		official: true,
		permissions: ['Network access', 'Profile secrets', 'Remote terminal and files'],
		dependants: ['Puzed'],
		provenance: 'Official Terminay catalogue · npmjs.com',
	},
	{
		id: 'terminay.puzed',
		packageName: 'terminay-plugin-puzed',
		displayName: 'Puzed Platform',
		description: 'Create and manage project VMs on Puzed Platform.',
		state: 'available',
		official: true,
		permissions: ['Network access', 'Profile secrets', 'Infrastructure lifecycle'],
		dependants: [],
		provenance: 'Official Terminay catalogue · npmjs.com',
	},
]);

export const SSH_PROFILE_FORM_FIXTURE: DeclarativeFormDto = {
	id: 'terminay.ssh.profile',
	title: 'New SSH connection',
	description: 'The selected Terminay Server makes this connection.',
	submitLabel: 'Test connection',
	sections: [
		{
			id: 'connection',
			title: 'Connection',
			fields: [
				{ id: 'name', label: 'Name', kind: 'text', required: true },
				{ id: 'host', label: 'Host', kind: 'text', required: true },
				{ id: 'port', label: 'Port', kind: 'number', required: true, placeholder: '22' },
				{ id: 'username', label: 'Username', kind: 'text', required: true },
				{ id: 'privateKey', label: 'Private key', kind: 'secret', required: true },
			],
		},
		{
			id: 'defaults',
			title: 'Defaults and trust',
			disclosure: true,
			fields: [
				{ id: 'defaultRoot', label: 'Default root', kind: 'text', placeholder: '~' },
				{
					id: 'bypassFingerprint',
					label: 'Bypass fingerprint check',
					kind: 'checkbox',
					description: 'Unsafe. Use only when you cannot verify the server host key.',
				},
			],
		},
	],
};

export function statusLabel(status: ProjectEnvironmentStatus): string {
	return status.replaceAll('-', ' ');
}
