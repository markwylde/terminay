/**
 * The per-kind adapters: how each kind is read from a server into portable
 * items, how a portable item is validated, and how it is written to a target
 * through that target's own client. Every write carries the revision the
 * review read, so a concurrent edit is refused rather than overwritten.
 */

import { terminalSettingsSections } from '../terminalSettings.ts';
import {
	classifyError,
	errorMessage,
	freshId,
	isRecord,
	type ItemKind,
	type Json,
	type JsonObject,
	type NamedReference,
	type PortableItem,
	type ServerItem,
} from './model.ts';

// ---------------------------------------------------------------------------
// The clients a column reads and writes through. They are the client-core
// classes, described structurally so this model runs without a connection.

type Guard = Readonly<{ expectedRevision?: number }>;

type RawMacro = Readonly<{
	id: string;
	title: string;
	description: string;
	category: string;
	fields: readonly Readonly<Record<string, unknown>>[];
	steps: readonly Readonly<Record<string, unknown>>[];
}>;
type RawMacroState = Readonly<{
	revision: number;
	categories: readonly string[];
	macros: readonly RawMacro[];
}>;
type RawTemplate = Readonly<{
	id: string;
	name: string;
	description: string;
	category: string;
	openingPrompt: string;
	steps: readonly Readonly<{ id: string; title: string; prompt: string; icon: string }>[];
}>;
type RawTemplateState = Readonly<{
	revision: number;
	categories: readonly string[];
	templates: readonly RawTemplate[];
}>;
type RawProfileEntry = Readonly<{ id: string; name: string; kind: string }>;
type RawProfileCatalogue = Readonly<{
	settingsRevision: number;
	entries: readonly RawProfileEntry[];
}>;
type RawProfile = Readonly<{
	id: string;
	name: string;
	target: unknown;
	args: readonly string[];
	startupMode: string;
	environment: Readonly<Record<string, string | null>>;
	icon?: string;
	color?: string;
}>;
type RawAutomation = Readonly<{
	id: string;
	name: string;
	enabled: boolean;
	trigger: unknown;
	action: Readonly<Record<string, unknown>>;
	settings: Readonly<Record<string, unknown>>;
}>;
type RawAutomationState = Readonly<{
	revision: number;
	automations: readonly RawAutomation[];
}>;

export type ImportExportClients = Readonly<{
	macros?: {
		get(): Promise<RawMacroState>;
		upsert(macro: unknown, options: Guard): Promise<RawMacroState>;
		replace(
			macros: readonly unknown[],
			options: Guard & { readonly categories?: readonly string[] },
		): Promise<RawMacroState>;
	};
	workflows?: {
		templates(): Promise<RawTemplateState>;
		upsertTemplate(template: never, options: Guard): Promise<RawTemplateState>;
		reorderTemplates(
			templateIds: readonly string[],
			categories: readonly string[] | undefined,
			options: Guard,
		): Promise<RawTemplateState>;
	};
	shellProfiles?: {
		catalogue(): Promise<RawProfileCatalogue>;
		detail(profileId: string): Promise<RawProfile>;
		create(profile: never, options: Guard): Promise<RawProfileCatalogue>;
		update(profile: never, options: Guard): Promise<RawProfileCatalogue>;
		validate(profile: never): Promise<Readonly<{ valid: boolean; issues: readonly { message: string }[] }>>;
	};
	automations?: {
		get(): Promise<RawAutomationState>;
		upsert(automation: never, options: Guard): Promise<RawAutomationState>;
	};
	settings?: {
		get(): Promise<unknown>;
		update(settings: never, options: Guard): Promise<unknown>;
	};
}>;

// ---------------------------------------------------------------------------
// Reading a column.

export type KindSnapshot =
	| Readonly<{ state: 'ok'; revision: number; items: readonly ServerItem[] }>
	| Readonly<{ state: 'unsupported' | 'denied' | 'failed'; message: string }>;

export type ColumnSnapshot = Readonly<Record<ItemKind, KindSnapshot>>;

/** Each kind's revision lives in one revision domain; shell profiles are settings. */
export type RevisionDomain = 'macro' | 'workflowTemplate' | 'automation' | 'settings';

export function revisionDomain(kind: ItemKind): RevisionDomain {
	if (kind === 'shellProfile' || kind === 'settingsCategory') return 'settings';
	return kind;
}

const UNSUPPORTED: KindSnapshot = Object.freeze({
	state: 'unsupported',
	message: 'This server does not offer this kind.',
});

async function guarded<T>(read: () => Promise<T>): Promise<
	Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; snapshot: KindSnapshot }>
> {
	try {
		return { ok: true, value: await read() };
	} catch (error) {
		const failure = classifyError(error);
		return {
			ok: false,
			snapshot: {
				state: failure === 'conflict' ? 'failed' : failure,
				message: errorMessage(error),
			},
		};
	}
}

function serverItem(
	portable: PortableItem,
	id?: string,
	references: readonly NamedReference[] = [],
	dangling = false,
): ServerItem {
	return Object.freeze({ ...(id === undefined ? {} : { id }), portable, references, dangling });
}

export function macroToPortable(macro: RawMacro): PortableItem {
	return {
		kind: 'macro',
		name: macro.title,
		content: {
			description: macro.description,
			category: macro.category,
			fields: macro.fields.map(({ id: _id, ...field }) => field as JsonObject),
			steps: macro.steps.map(({ id: _id, ...step }) => step as JsonObject),
		},
	};
}

export function templateToPortable(template: RawTemplate): PortableItem {
	return {
		kind: 'workflowTemplate',
		name: template.name,
		content: {
			description: template.description,
			category: template.category,
			openingPrompt: template.openingPrompt,
			steps: template.steps.map((step) => ({
				title: step.title,
				prompt: step.prompt,
				icon: step.icon,
			})),
		},
	};
}

export function profileToPortable(profile: RawProfile): PortableItem {
	return {
		kind: 'shellProfile',
		name: profile.name,
		content: {
			target: profile.target as Json,
			args: [...profile.args],
			startupMode: profile.startupMode,
			environment: { ...profile.environment },
			...(profile.icon === undefined ? {} : { icon: profile.icon }),
			...(profile.color === undefined ? {} : { color: profile.color }),
		},
	};
}

/** An automation with its macro and shell-profile ids turned into names. */
export function automationToPortable(
	automation: RawAutomation,
	macroNames: ReadonlyMap<string, string>,
	profileNames: ReadonlyMap<string, string>,
): Readonly<{ portable: PortableItem; references: NamedReference[]; dangling: boolean }> {
	const references: NamedReference[] = [];
	let dangling = false;
	const { macroId, shellProfileId, ...rest } = automation.action as Record<string, unknown>;
	const action: Record<string, Json> = { ...(rest as JsonObject) };
	if (typeof macroId === 'string') {
		const name = macroNames.get(macroId);
		if (name === undefined) dangling = true;
		action.macro = name ?? '';
		references.push({ kind: 'macro', name: name ?? '' });
	}
	if (typeof shellProfileId === 'string') {
		const name = profileNames.get(shellProfileId);
		if (name === undefined) dangling = true;
		action.shellProfile = name ?? '';
		references.push({ kind: 'shellProfile', name: name ?? '' });
	}
	return {
		portable: {
			kind: 'automation',
			name: automation.name,
			content: {
				enabled: automation.enabled,
				trigger: automation.trigger as Json,
				action,
				settings: automation.settings as JsonObject,
			},
		},
		references,
		dangling,
	};
}

export function referencesOf(item: PortableItem): NamedReference[] {
	if (item.kind !== 'automation') return [];
	const action = item.content.action;
	if (!isRecord(action)) return [];
	const references: NamedReference[] = [];
	if (typeof action.macro === 'string') references.push({ kind: 'macro', name: action.macro });
	if (typeof action.shellProfile === 'string')
		references.push({ kind: 'shellProfile', name: action.shellProfile });
	return references;
}

/** The settings categories that may be copied, and only these. */
export const PORTABLE_SETTINGS_CATEGORIES = Object.freeze([
	'appearance',
	'theme',
	'cursor',
	'interaction',
	'keyboard',
	'scrolling',
	'accessibility',
	'files',
	'ai',
] as const);

export type PortableSettingsCategory = (typeof PORTABLE_SETTINGS_CATEGORIES)[number];

/** Every field key the Settings window draws under a category. */
export function settingsCategoryKeys(categoryId: string): readonly string[] {
	const keys = new Set<string>();
	for (const section of terminalSettingsSections) {
		if (section.categoryId !== categoryId) continue;
		for (const field of section.fields) keys.add(field.key);
	}
	return [...keys].sort();
}

function readPath(root: unknown, path: string): unknown {
	let value: unknown = root;
	for (const segment of path.split('.')) {
		if (!isRecord(value)) return undefined;
		value = value[segment];
	}
	return value;
}

/** The server settings snapshot, as `settings.get` returns it. */
function settingsParts(raw: unknown): Readonly<{
	revision: number;
	settings: unknown;
	secretKeys: ReadonlySet<string>;
}> {
	if (!isRecord(raw)) throw new TypeError('settings snapshot is invalid');
	const revision = typeof raw.revision === 'number' ? raw.revision : 0;
	const settings = isRecord(raw.settings) ? raw.settings : raw;
	const secretKeys = new Set(isRecord(raw.secretReferences) ? Object.keys(raw.secretReferences) : []);
	return { revision, settings, secretKeys };
}

export function settingsCategoriesToPortable(raw: unknown): Readonly<{
	revision: number;
	items: PortableItem[];
}> {
	const { revision, settings, secretKeys } = settingsParts(raw);
	const items: PortableItem[] = [];
	for (const categoryId of PORTABLE_SETTINGS_CATEGORIES) {
		const values: Record<string, Json> = {};
		for (const key of settingsCategoryKeys(categoryId)) {
			// A key backed by a vault secret is never copied.
			if (secretKeys.has(key)) continue;
			const value = readPath(settings, key);
			if (value !== undefined) values[key] = value as Json;
		}
		if (Object.keys(values).length > 0)
			items.push({ kind: 'settingsCategory', name: categoryId, content: { values } });
	}
	return { revision, items };
}

/** Reads every kind from one column. A kind the server cannot or will not
 * serve says so instead of failing the column. */
export async function readColumn(clients: ImportExportClients): Promise<ColumnSnapshot> {
	const macros = clients.macros
		? await guarded(() => clients.macros!.get())
		: ({ ok: false, snapshot: UNSUPPORTED } as const);
	const templates = clients.workflows
		? await guarded(() => clients.workflows!.templates())
		: ({ ok: false, snapshot: UNSUPPORTED } as const);
	const profiles = clients.shellProfiles
		? await guarded(async () => {
				const catalogue = await clients.shellProfiles!.catalogue();
				const custom = catalogue.entries.filter((entry) => entry.kind === 'custom');
				const details = await Promise.all(
					custom.map((entry) => clients.shellProfiles!.detail(entry.id)),
				);
				return { catalogue, details };
			})
		: ({ ok: false, snapshot: UNSUPPORTED } as const);
	const automations = clients.automations
		? await guarded(() => clients.automations!.get())
		: ({ ok: false, snapshot: UNSUPPORTED } as const);
	const settings = clients.settings
		? await guarded(async () => settingsCategoriesToPortable(await clients.settings!.get()))
		: ({ ok: false, snapshot: UNSUPPORTED } as const);

	const macroNames = new Map<string, string>();
	if (macros.ok) for (const macro of macros.value.macros) macroNames.set(macro.id, macro.title);
	const profileNames = new Map<string, string>();
	if (profiles.ok)
		for (const entry of profiles.value.catalogue.entries) profileNames.set(entry.id, entry.name);

	return Object.freeze({
		macro: macros.ok
			? {
					state: 'ok',
					revision: macros.value.revision,
					items: macros.value.macros.map((macro) => serverItem(macroToPortable(macro), macro.id)),
				}
			: macros.snapshot,
		workflowTemplate: templates.ok
			? {
					state: 'ok',
					revision: templates.value.revision,
					items: templates.value.templates.map((template) =>
						serverItem(templateToPortable(template), template.id),
					),
				}
			: templates.snapshot,
		shellProfile: profiles.ok
			? {
					state: 'ok',
					revision: profiles.value.catalogue.settingsRevision,
					items: profiles.value.details.map((profile) =>
						serverItem(profileToPortable(profile), profile.id),
					),
				}
			: profiles.snapshot,
		automation: automations.ok
			? {
					state: 'ok',
					revision: automations.value.revision,
					items: automations.value.automations.map((automation) => {
						const converted = automationToPortable(automation, macroNames, profileNames);
						return serverItem(
							converted.portable,
							automation.id,
							converted.references,
							converted.dangling,
						);
					}),
				}
			: automations.snapshot,
		settingsCategory: settings.ok
			? {
					state: 'ok',
					revision: settings.value.revision,
					items: settings.value.items.map((item) => serverItem(item)),
				}
			: settings.snapshot,
	});
}

// ---------------------------------------------------------------------------
// Validating a portable item, as a bundle supplies it.

const MAX_NAME = 200;
const MAX_TEXT = 16_384;
const MAX_PROMPT = 32_768;

export class PortableItemError extends Error {
	override readonly name = 'PortableItemError';
}

function text(value: unknown, label: string, max: number, allowEmpty = true): string {
	if (typeof value !== 'string') throw new PortableItemError(`${label} must be text`);
	if (!allowEmpty && value.trim().length === 0)
		throw new PortableItemError(`${label} must not be empty`);
	if (value.length > max) throw new PortableItemError(`${label} is longer than ${max}`);
	if (value.includes('\0')) throw new PortableItemError(`${label} contains a NUL character`);
	return value;
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
	for (const key of Object.keys(value)) {
		if (!allowed.includes(key)) throw new PortableItemError(`${label} has a field it may not carry: ${key}`);
	}
}

const FORBIDDEN_KEYS = new Set(['id', 'revision', 'cursor', 'evaluatedThrough', 'schemaVersion']);

function rejectIds(value: unknown, label: string): void {
	if (Array.isArray(value)) {
		for (const entry of value) rejectIds(entry, label);
		return;
	}
	if (!isRecord(value)) return;
	for (const [key, entry] of Object.entries(value)) {
		if (FORBIDDEN_KEYS.has(key) || key === 'macroId' || key === 'shellProfileId')
			throw new PortableItemError(`${label} carries a server id or revision (${key})`);
		rejectIds(entry, label);
	}
}

function encodedBytes(value: unknown): number {
	return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

/** Throws a PortableItemError naming the first thing wrong with the item. */
export function validatePortable(value: unknown): PortableItem {
	if (!isRecord(value)) throw new PortableItemError('an item is not an object');
	onlyKeys(value, ['kind', 'name', 'content'], 'an item');
	const kind = value.kind;
	const name = text(value.name, 'an item name', MAX_NAME, false);
	const label = `"${name}"`;
	if (!isRecord(value.content)) throw new PortableItemError(`${label} has no content`);
	const content = value.content;
	rejectIds(content, label);
	switch (kind) {
		case 'macro': {
			onlyKeys(content, ['description', 'category', 'fields', 'steps'], label);
			text(content.description, `${label} description`, MAX_TEXT);
			text(content.category, `${label} category`, 64);
			if (!Array.isArray(content.fields) || content.fields.length > 128)
				throw new PortableItemError(`${label} fields are invalid`);
			if (!Array.isArray(content.steps) || content.steps.length > 256)
				throw new PortableItemError(`${label} steps are invalid`);
			for (const step of content.steps) {
				if (!isRecord(step) || typeof step.type !== 'string')
					throw new PortableItemError(`${label} has an invalid step`);
				if (encodedBytes(step) > MAX_TEXT + 1024)
					throw new PortableItemError(`${label} has a step over its size bound`);
			}
			for (const field of content.fields) {
				if (!isRecord(field) || typeof field.name !== 'string')
					throw new PortableItemError(`${label} has an invalid field`);
			}
			break;
		}
		case 'workflowTemplate': {
			onlyKeys(content, ['description', 'category', 'openingPrompt', 'steps'], label);
			text(name, `${label} name`, 120, false);
			text(content.description, `${label} description`, MAX_TEXT);
			text(content.category, `${label} category`, 64);
			text(content.openingPrompt, `${label} opening prompt`, 8192);
			if (!Array.isArray(content.steps) || content.steps.length < 1 || content.steps.length > 50)
				throw new PortableItemError(`${label} must have 1 to 50 steps`);
			for (const step of content.steps) {
				if (!isRecord(step)) throw new PortableItemError(`${label} has an invalid step`);
				onlyKeys(step, ['title', 'prompt', 'icon'], `${label} step`);
				text(step.title, `${label} step title`, 120, false);
				text(step.prompt, `${label} step prompt`, 8192);
				text(step.icon, `${label} step icon`, 64);
			}
			if (encodedBytes(content) > 56 * 1024)
				throw new PortableItemError(`${label} is over the workflow size bound`);
			break;
		}
		case 'shellProfile': {
			onlyKeys(content, ['target', 'args', 'startupMode', 'environment', 'icon', 'color'], label);
			text(name, `${label} name`, 128, false);
			if (!isRecord(content.target) || typeof content.target.kind !== 'string')
				throw new PortableItemError(`${label} target is invalid`);
			if (!Array.isArray(content.args)) throw new PortableItemError(`${label} arguments are invalid`);
			for (const arg of content.args) text(arg, `${label} argument`, 4096);
			text(content.startupMode, `${label} startup mode`, 32, false);
			if (!isRecord(content.environment))
				throw new PortableItemError(`${label} environment is invalid`);
			for (const [key, entry] of Object.entries(content.environment)) {
				text(key, `${label} environment key`, 256, false);
				if (entry !== null) text(entry, `${label} environment value`, 16_384);
			}
			if (encodedBytes(content) > 16_384)
				throw new PortableItemError(`${label} is over the shell profile size bound`);
			break;
		}
		case 'automation': {
			onlyKeys(content, ['enabled', 'trigger', 'action', 'settings'], label);
			text(name, `${label} name`, MAX_NAME, false);
			if (typeof content.enabled !== 'boolean')
				throw new PortableItemError(`${label} enabled state is invalid`);
			if (!isRecord(content.trigger) || typeof content.trigger.kind !== 'string')
				throw new PortableItemError(`${label} trigger is invalid`);
			if (!isRecord(content.action) || typeof content.action.kind !== 'string')
				throw new PortableItemError(`${label} action is invalid`);
			if (!isRecord(content.settings)) throw new PortableItemError(`${label} settings are invalid`);
			const action = content.action;
			if (action.kind === 'runMacro') text(action.macro, `${label} macro reference`, 256, false);
			if (action.shellProfile !== undefined)
				text(action.shellProfile, `${label} shell profile reference`, 128, false);
			for (const key of ['command', 'text'] as const)
				if (action[key] !== undefined) text(action[key], `${label} ${key}`, MAX_TEXT);
			if (action.prompt !== undefined) text(action.prompt, `${label} prompt`, MAX_PROMPT);
			if (action.cwd !== undefined) text(action.cwd, `${label} working directory`, 4096);
			break;
		}
		case 'settingsCategory': {
			onlyKeys(content, ['values'], label);
			if (!(PORTABLE_SETTINGS_CATEGORIES as readonly string[]).includes(name))
				throw new PortableItemError(`${label} is not a settings category that can be copied`);
			if (!isRecord(content.values)) throw new PortableItemError(`${label} values are invalid`);
			const allowed = new Set(settingsCategoryKeys(name));
			for (const key of Object.keys(content.values)) {
				if (!allowed.has(key))
					throw new PortableItemError(`${label} has a setting outside its category: ${key}`);
			}
			if (encodedBytes(content) > 256 * 1024)
				throw new PortableItemError(`${label} is over its size bound`);
			break;
		}
		default:
			throw new PortableItemError(`an item has an unknown kind: ${String(kind)}`);
	}
	return { kind, name, content: content as JsonObject };
}

// ---------------------------------------------------------------------------
// Writing to a target.

export type WriteMode = 'add' | 'replace' | 'keepBoth';

export type WriteRequest = Readonly<{
	item: PortableItem;
	mode: WriteMode;
	/** The name to write under: the source's, or the Keep both name. */
	name: string;
	/** For Replace: the target's id of the item being replaced. */
	targetId?: string;
	/** Named references resolved to target ids. */
	references: ReadonlyMap<string, string>;
	/** The revision of this item's domain the write must find on the target. */
	expectedRevision: number;
}>;

export type WriteResult = Readonly<{ id?: string; revision: number }>;

export function referenceKey(reference: NamedReference): string {
	return `${reference.kind}:${reference.name.trim().toLocaleLowerCase('en-US')}`;
}

class ChangedSinceReview extends Error {
	readonly code = 'conflict';
	constructor() {
		super('The target changed after review.');
	}
}

function guard(expected: number, actual: number): void {
	if (expected !== actual) throw new ChangedSinceReview();
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
	const segments = path.split('.');
	let node = target;
	for (const segment of segments.slice(0, -1)) {
		if (!isRecord(node[segment])) node[segment] = {};
		node = node[segment] as Record<string, unknown>;
	}
	node[segments[segments.length - 1]] = value;
}

function macroDefinition(request: WriteRequest, id: string): Record<string, unknown> {
	const content = request.item.content;
	return {
		id,
		title: request.name,
		description: content.description,
		category: content.category,
		fields: (content.fields as readonly JsonObject[]).map((field) => ({
			...field,
			id: freshId('field'),
		})),
		steps: (content.steps as readonly JsonObject[]).map((step) => ({
			...step,
			id: freshId('step'),
		})),
	};
}

function automationDraft(request: WriteRequest): Record<string, unknown> {
	const content = request.item.content;
	const { macro, shellProfile, ...action } = content.action as Record<string, unknown>;
	const resolve = (kind: 'macro' | 'shellProfile', name: unknown): string => {
		const id = request.references.get(referenceKey({ kind, name: String(name) }));
		if (id === undefined) throw new Error(`The ${kind === 'macro' ? 'macro' : 'shell profile'} "${String(name)}" is not on this server.`);
		return id;
	};
	return {
		...(request.mode === 'replace' && request.targetId !== undefined ? { id: request.targetId } : {}),
		name: request.name,
		enabled: false,
		trigger: content.trigger,
		action: {
			...action,
			...(macro === undefined ? {} : { macroId: resolve('macro', macro) }),
			...(shellProfile === undefined ? {} : { shellProfileId: resolve('shellProfile', shellProfile) }),
		},
		settings: content.settings,
	};
}

/** Writes one item to one target. Throws on refusal; a stale revision throws
 * an error whose code is `conflict`. */
export async function writeItem(
	clients: ImportExportClients,
	request: WriteRequest,
): Promise<WriteResult> {
	const guardOptions = { expectedRevision: request.expectedRevision };
	switch (request.item.kind) {
		case 'macro': {
			const api = clients.macros;
			if (!api) throw new Error('This server does not offer macros.');
			const current = await api.get();
			guard(request.expectedRevision, current.revision);
			const id =
				request.mode === 'replace' && request.targetId !== undefined
					? request.targetId
					: freshId('macro');
			const definition = macroDefinition(request, id);
			const category = String(request.item.content.category ?? '');
			if (category && !current.categories.includes(category)) {
				const macros = current.macros.filter((macro) => macro.id !== id);
				const state = await api.replace([...macros, definition], {
					...guardOptions,
					categories: [...current.categories, category],
				});
				return { id, revision: state.revision };
			}
			const state = await api.upsert(definition, guardOptions);
			return { id, revision: state.revision };
		}
		case 'workflowTemplate': {
			const api = clients.workflows;
			if (!api) throw new Error('This server does not offer workflow templates.');
			const current = await api.templates();
			guard(request.expectedRevision, current.revision);
			let revision = current.revision;
			const category = String(request.item.content.category ?? '');
			if (category && !current.categories.includes(category)) {
				const state = await api.reorderTemplates(
					current.templates.map((template) => template.id),
					[...current.categories, category],
					{ expectedRevision: revision },
				);
				revision = state.revision;
			}
			const id =
				request.mode === 'replace' && request.targetId !== undefined
					? request.targetId
					: freshId('tpl');
			const content = request.item.content;
			const template = {
				id,
				name: request.name,
				description: content.description,
				category,
				openingPrompt: content.openingPrompt,
				steps: (content.steps as readonly JsonObject[]).map((step) => ({
					title: step.title,
					prompt: step.prompt,
					icon: step.icon,
				})),
			};
			const state = await api.upsertTemplate(template as never, { expectedRevision: revision });
			return { id, revision: state.revision };
		}
		case 'shellProfile': {
			const api = clients.shellProfiles;
			if (!api) throw new Error('This server does not offer shell profiles.');
			const content = request.item.content;
			const profile = {
				name: request.name,
				target: content.target,
				args: content.args,
				startupMode: content.startupMode,
				environment: content.environment,
				...(content.icon === undefined ? {} : { icon: content.icon }),
				...(content.color === undefined ? {} : { color: content.color }),
			};
			if (request.mode === 'replace' && request.targetId !== undefined) {
				const state = await api.update({ ...profile, id: request.targetId } as never, guardOptions);
				return { id: request.targetId, revision: state.settingsRevision };
			}
			const before = await api.catalogue();
			guard(request.expectedRevision, before.settingsRevision);
			const known = new Set(before.entries.map((entry) => entry.id));
			const state = await api.create(profile as never, guardOptions);
			const created = state.entries.find(
				(entry) => !known.has(entry.id) && entry.name === request.name,
			);
			return { ...(created ? { id: created.id } : {}), revision: state.settingsRevision };
		}
		case 'automation': {
			const api = clients.automations;
			if (!api) throw new Error('This server does not offer automations.');
			const before = await api.get();
			guard(request.expectedRevision, before.revision);
			const known = new Set(before.automations.map((automation) => automation.id));
			const state = await api.upsert(automationDraft(request) as never, guardOptions);
			const written =
				request.mode === 'replace' && request.targetId !== undefined
					? request.targetId
					: state.automations.find(
							(automation) => !known.has(automation.id) && automation.name === request.name,
						)?.id;
			return { ...(written ? { id: written } : {}), revision: state.revision };
		}
		case 'settingsCategory': {
			const api = clients.settings;
			if (!api) throw new Error('This server does not offer settings.');
			const patch: Record<string, unknown> = {};
			const values = request.item.content.values as JsonObject;
			for (const key of settingsCategoryKeys(request.item.name)) {
				if (key in values) setPath(patch, key, values[key]);
			}
			const state = await api.update(patch as never, guardOptions);
			const revision = isRecord(state) && typeof state.revision === 'number' ? state.revision : request.expectedRevision + 1;
			return { revision };
		}
	}
}

/** What review warns about for one write. */
export async function reviewWarnings(
	clients: ImportExportClients,
	item: PortableItem,
): Promise<string[]> {
	const warnings: string[] = [];
	if (item.kind === 'automation') {
		warnings.push('Arrives disabled.');
		const action = item.content.action;
		if (isRecord(action) && typeof action.cwd === 'string' && action.cwd)
			warnings.push(`Working directory "${action.cwd}" is a path on the target's machine.`);
	}
	if (item.kind === 'shellProfile' && clients.shellProfiles) {
		try {
			const result = await clients.shellProfiles.validate({
				id: 'profile:import-export-check',
				name: item.name,
				...item.content,
			} as never);
			if (!result.valid)
				warnings.push(
					`Unavailable on this server: ${result.issues.map((issue) => issue.message).join('; ') || 'its shell was not found'}.`,
				);
		} catch {
			warnings.push('This server could not check the profile.');
		}
	}
	return warnings;
}
