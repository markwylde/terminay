import type { JsonValue } from '@terminay/protocol';
import type { QueryCommandTransport } from './queryCommand.js';
import type { CommandOptions, QueryOptions } from './types.js';

export const PROJECT_ENVIRONMENT_OPERATIONS = Object.freeze({
	snapshot: 'projectEnvironments.snapshot',
	createProject: 'projectEnvironments.createProject',
	createProfile: 'projectEnvironments.createProfile',
	updateProfile: 'projectEnvironments.updateProfile',
	testProfile: 'projectEnvironments.testProfile',
	removeProfile: 'projectEnvironments.removeProfile',
	invokeAction: 'projectEnvironments.invokeAction',
} as const);

export type ProjectEnvironmentClientStatus =
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
export interface ProjectEnvironmentFormOption {
	readonly value: string;
	readonly label: string;
	readonly description?: string;
	readonly disabledReason?: string;
}
export interface ProjectEnvironmentFormField {
	readonly id: string;
	readonly label: string;
	readonly type:
		| 'text'
		| 'url'
		| 'secret'
		| 'textarea'
		| 'number'
		| 'checkbox'
		| 'switch'
		| 'select'
		| 'preset-cards';
	readonly description?: string;
	readonly required?: boolean;
	readonly placeholder?: string;
	readonly options?: readonly ProjectEnvironmentFormOption[];
	readonly optionSource?: string;
	readonly searchable?: boolean;
	readonly visibleWhen?: Readonly<{
		fieldId: string;
		equals?: string | number | boolean | null;
		notEquals?: string | number | boolean | null;
	}>;
}
export interface ProjectEnvironmentForm {
	readonly id: string;
	readonly title: string;
	readonly description?: string;
	readonly sections: readonly Readonly<{
		id: string;
		title: string;
		description?: string;
		disclosure?: 'always' | 'expanded' | 'collapsed';
		fields: readonly ProjectEnvironmentFormField[];
	}>[];
	readonly submitLabel: string;
}
export interface ProjectEnvironmentProviderDescriptor {
	readonly providerId: string;
	readonly displayName: string;
	readonly description?: string;
	readonly profileForm?: ProjectEnvironmentForm;
	readonly createForm?: ProjectEnvironmentForm;
}
export interface ProjectEnvironmentAction {
	readonly id: string;
	readonly label: string;
	readonly kind?: 'primary' | 'secondary' | 'destructive';
	readonly disabledReason?: string;
	readonly confirmation?: Readonly<{
		title: string;
		message: string;
		kind: 'ordinary' | 'destructive';
		confirmLabel: string;
		expectedRevision: number;
	}>;
}
export interface ProjectEnvironmentStatusCard {
	readonly id: string;
	readonly title: string;
	readonly summary: string;
	readonly tone?: 'neutral' | 'positive' | 'warning' | 'danger';
	readonly facts: readonly Readonly<{ label: string; value: string }>[];
	readonly actions: readonly ProjectEnvironmentAction[];
}
export interface ProjectEnvironmentClientSummary {
	readonly id: string;
	readonly providerId: string;
	readonly profileId?: string;
	readonly providerLabel: string;
	readonly name: string;
	readonly endpointSummary: string;
	readonly defaultRoot?: string;
	readonly status: ProjectEnvironmentClientStatus;
	readonly referencedProjectCount: number;
	readonly isThisServer?: boolean;
	readonly isFavourite?: boolean;
	readonly lastUsedAt?: string;
	readonly statusCard?: ProjectEnvironmentStatusCard;
}
export interface ProjectEnvironmentClientSnapshot {
	readonly revision: number;
	readonly environments: readonly ProjectEnvironmentClientSummary[];
	readonly providers: readonly ProjectEnvironmentProviderDescriptor[];
}
export interface ProjectEnvironmentOperation {
	readonly operationId: string;
	readonly state: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
	readonly stage?: string;
	readonly progress?: number;
	readonly message?: string;
	readonly environmentId?: string;
	readonly projectId?: string;
}

export class ProjectEnvironmentsClient {
	constructor(private readonly transport: QueryCommandTransport) {}
	async snapshot(
		options: QueryOptions = {},
	): Promise<ProjectEnvironmentClientSnapshot> {
		return parseSnapshot(
			await this.transport.query(
				PROJECT_ENVIRONMENT_OPERATIONS.snapshot,
				{},
				options,
			),
		);
	}
	async createProject(
		request: { environmentId: string; viewId: string; root?: string },
		options: CommandOptions = {},
	): Promise<ProjectEnvironmentOperation> {
		return parseOperation(
			await this.transport.command(
				PROJECT_ENVIRONMENT_OPERATIONS.createProject,
				boundedPayload(request),
				options,
			),
		);
	}
	async createProfile(
		providerId: string,
		values: Readonly<Record<string, string | boolean>>,
		options: CommandOptions = {},
	): Promise<ProjectEnvironmentOperation> {
		return parseOperation(
			await this.transport.command(
				PROJECT_ENVIRONMENT_OPERATIONS.createProfile,
				{ providerId: text(providerId, 256), values: formValues(values) },
				options,
			),
		);
	}
	async updateProfile(
		profileId: string,
		values: Readonly<Record<string, string | boolean>>,
		options: CommandOptions = {},
	): Promise<ProjectEnvironmentOperation> {
		return parseOperation(
			await this.transport.command(
				PROJECT_ENVIRONMENT_OPERATIONS.updateProfile,
				{ profileId: text(profileId, 256), values: formValues(values) },
				options,
			),
		);
	}
	async testProfile(
		profileId: string,
		options: CommandOptions = {},
	): Promise<ProjectEnvironmentOperation> {
		return parseOperation(
			await this.transport.command(
				PROJECT_ENVIRONMENT_OPERATIONS.testProfile,
				{ profileId: text(profileId, 256) },
				options,
			),
		);
	}
	async removeProfile(
		profileId: string,
		options: CommandOptions = {},
	): Promise<ProjectEnvironmentOperation> {
		return parseOperation(
			await this.transport.command(
				PROJECT_ENVIRONMENT_OPERATIONS.removeProfile,
				{ profileId: text(profileId, 256) },
				options,
			),
		);
	}
	async invokeAction(
		environmentId: string,
		actionId: string,
		values: Readonly<Record<string, string | boolean>> = {},
		options: CommandOptions = {},
	): Promise<ProjectEnvironmentOperation> {
		return parseOperation(
			await this.transport.command(
				PROJECT_ENVIRONMENT_OPERATIONS.invokeAction,
				{
					environmentId: text(environmentId, 256),
					actionId: text(actionId, 256),
					values: formValues(values),
				},
				options,
			),
		);
	}
}

function parseSnapshot(input: JsonValue): ProjectEnvironmentClientSnapshot {
	const value = record(input);
	if (
		!uint(value.revision) ||
		!Array.isArray(value.environments) ||
		value.environments.length > 2048 ||
		!Array.isArray(value.providers) ||
		value.providers.length > 128
	)
		throw new TypeError('project environment snapshot is invalid');
	return Object.freeze({
		revision: value.revision,
		environments: Object.freeze(value.environments.map(parseSummary)),
		providers: Object.freeze(value.providers.map(parseProvider)),
	});
}
function parseSummary(input: JsonValue): ProjectEnvironmentClientSummary {
	const value = record(input);
	const statuses: readonly string[] = [
		'ready',
		'connecting',
		'reconnecting',
		'provisioning',
		'starting',
		'stopping',
		'offline',
		'authentication-required',
		'host-key-changed',
		'permission-denied',
		'extension-missing',
		'extension-disabled',
		'extension-incompatible',
		'unreachable',
		'failed',
	];
	if (
		!statuses.includes(String(value.status)) ||
		!uint(value.referencedProjectCount)
	)
		throw new TypeError('project environment summary is invalid');
	return Object.freeze({
		id: text(value.id, 256),
		providerId: text(value.providerId, 256),
		...(value.profileId === undefined
			? {}
			: { profileId: text(value.profileId, 256) }),
		providerLabel: text(value.providerLabel, 128),
		name: text(value.name, 128),
		endpointSummary: text(value.endpointSummary, 512, true),
		status: value.status as ProjectEnvironmentClientStatus,
		referencedProjectCount: value.referencedProjectCount,
		...(value.defaultRoot === undefined
			? {}
			: { defaultRoot: text(value.defaultRoot, 4096) }),
		...(typeof value.isThisServer === 'boolean'
			? { isThisServer: value.isThisServer }
			: {}),
		...(typeof value.isFavourite === 'boolean'
			? { isFavourite: value.isFavourite }
			: {}),
		...(value.lastUsedAt === undefined
			? {}
			: { lastUsedAt: text(value.lastUsedAt, 64) }),
		...(value.statusCard === undefined
			? {}
			: { statusCard: parseStatusCard(value.statusCard) }),
	});
}
function parseStatusCard(input: JsonValue): ProjectEnvironmentStatusCard {
	const value = record(input);
	const facts = value.facts ?? [],
		actions = value.actions ?? [];
	if (value.tone !== undefined && !['neutral', 'positive', 'warning', 'danger'].includes(String(value.tone))) throw new TypeError('environment status card tone is invalid');
	if (
		!Array.isArray(facts) ||
		facts.length > 32 ||
		!Array.isArray(actions) ||
		actions.length > 16
	)
		throw new TypeError('environment status card is invalid');
	return Object.freeze({
		id: text(value.id, 256),
		title: text(value.title, 256),
		summary: text(value.summary, 2048, true),
		...(value.tone === undefined
			? {}
			: { tone: text(value.tone, 16) as ProjectEnvironmentStatusCard['tone'] }),
		facts: Object.freeze(
			facts.map((item) => {
				const fact = record(item);
				return Object.freeze({
					label: text(fact.label, 128),
					value: text(fact.value, 1024, true),
				});
			}),
		),
		actions: Object.freeze(
			actions.map((item) => {
				const action = record(item);
				const confirmation =
					action.confirmation === undefined
						? undefined
						: record(action.confirmation);
				if (action.kind !== undefined && !['primary', 'secondary', 'destructive'].includes(String(action.kind))) throw new TypeError('environment action kind is invalid');
				if (confirmation !== undefined && !['ordinary', 'destructive'].includes(String(confirmation.kind))) throw new TypeError('environment confirmation kind is invalid');
				return Object.freeze({
					id: text(action.id, 256),
					label: text(action.label, 128),
					...(action.kind === undefined
						? {}
						: {
								kind: text(action.kind, 16) as ProjectEnvironmentAction['kind'],
							}),
					...(action.disabledReason === undefined
						? {}
						: { disabledReason: text(action.disabledReason, 1024, true) }),
					...(confirmation === undefined
						? {}
						: {
								confirmation: Object.freeze({
									title: text(confirmation.title, 256),
									message: text(confirmation.message, 2048, true),
									kind: text(confirmation.kind, 16) as
										| 'ordinary'
										| 'destructive',
									confirmLabel: text(confirmation.confirmLabel, 128),
									expectedRevision: uint(confirmation.expectedRevision)
										? confirmation.expectedRevision
										: (() => {
												throw new TypeError(
													'environment action revision is invalid',
												);
											})(),
								}),
							}),
				});
			}),
		),
	});
}
function parseProvider(input: JsonValue): ProjectEnvironmentProviderDescriptor {
	const value = record(input);
	return Object.freeze({
		providerId: text(value.providerId, 256),
		displayName: text(value.displayName, 128),
		...(value.description === undefined
			? {}
			: { description: text(value.description, 1024, true) }),
		...(value.profileForm === undefined
			? {}
			: { profileForm: parseForm(value.profileForm) }),
		...(value.createForm === undefined
			? {}
			: { createForm: parseForm(value.createForm) }),
	});
}
function parseForm(input: JsonValue): ProjectEnvironmentForm {
	const value = record(input);
	if (!Array.isArray(value.sections) || value.sections.length > 32)
		throw new TypeError('provider form is invalid');
	return Object.freeze({
		id: text(value.id, 256),
		title: text(value.title, 256),
		submitLabel: text(value.submitLabel, 128),
		...(value.description === undefined
			? {}
			: { description: text(value.description, 1024, true) }),
		sections: Object.freeze(
			value.sections.map((sectionInput) => {
				const section = record(sectionInput);
				if (!Array.isArray(section.fields) || section.fields.length > 64)
					throw new TypeError('provider form section is invalid');
				return Object.freeze({
					id: text(section.id, 256),
					title: text(section.title, 256),
					...(section.description === undefined
						? {}
						: { description: text(section.description, 1024, true) }),
					...(section.disclosure === undefined
						? {}
						: {
								disclosure: text(section.disclosure, 16) as
									| 'always'
									| 'expanded'
									| 'collapsed',
							}),
					fields: Object.freeze(section.fields.map(parseField)),
				});
			}),
		),
	});
}
function parseField(input: JsonValue): ProjectEnvironmentFormField {
	const value = record(input);
	const kinds = [
		'text',
		'url',
		'secret',
		'textarea',
		'number',
		'checkbox',
		'switch',
		'select',
		'preset-cards',
	];
	if (!kinds.includes(String(value.type)))
		throw new TypeError('provider form field is invalid');
	const options = value.options === undefined ? undefined : value.options;
	if (
		options !== undefined &&
		(!Array.isArray(options) || options.length > 256)
	)
		throw new TypeError('provider form options are invalid');
	return Object.freeze({
		id: text(value.id, 256),
		label: text(value.label, 256),
		type: value.type as ProjectEnvironmentFormField['type'],
		...(value.description === undefined
			? {}
			: { description: text(value.description, 1024, true) }),
		...(typeof value.required === 'boolean'
			? { required: value.required }
			: {}),
		...(value.placeholder === undefined
			? {}
			: { placeholder: text(value.placeholder, 512, true) }),
		...(options === undefined
			? {}
			: {
					options: Object.freeze(
						options.map((optionInput) => {
							const option = record(optionInput);
							return Object.freeze({
								value: text(option.value, 256),
								label: text(option.label, 256),
								...(option.description === undefined
									? {}
									: { description: text(option.description, 1024, true) }),
								...(option.disabledReason === undefined
									? {}
									: {
											disabledReason: text(option.disabledReason, 1024, true),
										}),
							});
						}),
					),
				}),
		...(value.optionSource === undefined
			? {}
			: { optionSource: text(value.optionSource, 256) }),
		...(typeof value.searchable === 'boolean'
			? { searchable: value.searchable }
			: {}),
	});
}
function parseOperation(input: JsonValue): ProjectEnvironmentOperation {
	const value = record(input);
	const states = ['pending', 'running', 'succeeded', 'failed', 'cancelled'];
	if (!states.includes(String(value.state)))
		throw new TypeError('project environment operation is invalid');
	return Object.freeze({
		operationId: text(value.operationId, 256),
		state: value.state as ProjectEnvironmentOperation['state'],
		...(value.stage === undefined ? {} : { stage: text(value.stage, 256) }),
		...(typeof value.progress === 'number' &&
		value.progress >= 0 &&
		value.progress <= 1
			? { progress: value.progress }
			: {}),
		...(value.message === undefined
			? {}
			: { message: text(value.message, 1024, true) }),
		...(value.environmentId === undefined
			? {}
			: { environmentId: text(value.environmentId, 256) }),
		...(value.projectId === undefined
			? {}
			: { projectId: text(value.projectId, 256) }),
	});
}
function boundedPayload(value: {
	environmentId: string;
	viewId: string;
	root?: string;
}): JsonValue {
	return {
		environmentId: text(value.environmentId, 256),
		viewId: text(value.viewId, 256),
		...(value.root === undefined ? {} : { root: text(value.root, 4096) }),
	};
}
function formValues(
	input: Readonly<Record<string, string | boolean>>,
): JsonValue {
	const entries = Object.entries(input);
	if (entries.length > 128) throw new TypeError('form exceeds field limit');
	return Object.fromEntries(
		entries.map(([key, value]) => [
			text(key, 256),
			typeof value === 'boolean' ? value : text(value, 16384, true),
		]),
	);
}
function record(value: unknown): Record<string, JsonValue> {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		throw new TypeError('expected object');
	return value as Record<string, JsonValue>;
}
function text(value: unknown, max: number, empty = false): string {
	if (
		typeof value !== 'string' ||
		value.length > max ||
		value.includes('\0') ||
		(!empty && value.length === 0)
	)
		throw new TypeError('invalid text');
	return value;
}
function uint(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
