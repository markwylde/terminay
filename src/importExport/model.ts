/**
 * The portable item model behind Settings > Import & Export.
 *
 * Every server owns its own macros, workflow templates, shell profiles,
 * automations, and settings, and identifies them by ids it assigned itself.
 * Copying between servers therefore matches items by kind and name, and
 * compares them by their portable content: the content with every id,
 * revision, and server-maintained field removed (ADR-0111).
 */

export type Json =
	| null
	| boolean
	| number
	| string
	| readonly Json[]
	| { readonly [key: string]: Json };

export type JsonObject = { readonly [key: string]: Json };

export const ITEM_KINDS = [
	'macro',
	'workflowTemplate',
	'shellProfile',
	'automation',
	'settingsCategory',
] as const;

export type ItemKind = (typeof ITEM_KINDS)[number];

export const ITEM_KIND_LABELS: Readonly<Record<ItemKind, { one: string; many: string }>> =
	Object.freeze({
		macro: { one: 'Macro', many: 'Macros' },
		workflowTemplate: { one: 'Workflow', many: 'Workflows' },
		shellProfile: { one: 'Shell profile', many: 'Shell profiles' },
		automation: { one: 'Automation', many: 'Automations' },
		settingsCategory: { one: 'Settings', many: 'Settings' },
	});

/** The kinds that a named reference can point at. */
export type ReferenceKind = 'macro' | 'shellProfile';

/** A reference that travels between servers by the name of what it names. */
export type NamedReference = Readonly<{ kind: ReferenceKind; name: string }>;

export type PortableItem = Readonly<{
	kind: ItemKind;
	/** The display name; a settings category's name is its category id. */
	name: string;
	content: JsonObject;
}>;

/** One item as one server holds it. */
export type ServerItem = Readonly<{
	/** The server's id for it; absent for a settings category. */
	id?: string;
	portable: PortableItem;
	/** References this item makes, by name. */
	references: readonly NamedReference[];
	/** True when a reference names nothing on its own server. */
	dangling: boolean;
}>;

/** The identity of an item across servers: its kind and its folded name. */
export function itemKey(kind: ItemKind, name: string): string {
	return `${kind}:${name.trim().toLocaleLowerCase('en-US')}`;
}

export function portableKey(item: PortableItem): string {
	return itemKey(item.kind, item.name);
}

/** JSON with object keys sorted, so equal content always encodes the same. */
export function canonicalJson(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record)
		.filter((key) => record[key] !== undefined)
		.sort();
	return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

/**
 * What decides "same" or "differs". It keeps case, because commands, paths
 * and prompts are case-sensitive, and leaves out an automation's enabled
 * state, because every copy of an automation is written disabled.
 */
export function fingerprint(item: PortableItem): string {
	if (item.kind === 'automation') {
		const { enabled: _enabled, ...rest } = item.content;
		return canonicalJson({ kind: item.kind, name: item.name.trim(), content: rest });
	}
	return canonicalJson({ kind: item.kind, name: item.name.trim(), content: item.content });
}

/** `<name> (n)` with the lowest n from 2 whose key is not taken. */
export function nextFreeName(
	kind: ItemKind,
	name: string,
	takenKeys: ReadonlySet<string>,
): string {
	const base = name.trim();
	for (let n = 2; n < 10_000; n += 1) {
		const candidate = `${base} (${n})`;
		if (!takenKeys.has(itemKey(kind, candidate))) return candidate;
	}
	throw new Error(`no free name for ${base}`);
}

/** A fresh id in a server's own id alphabet. */
export function freshId(prefix: string): string {
	const random =
		typeof globalThis.crypto?.randomUUID === 'function'
			? globalThis.crypto.randomUUID()
			: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
	return `${prefix}-${random}`;
}

/** How a server answered a read or write, as the matrix needs to know it. */
export type FailureKind = 'unsupported' | 'denied' | 'conflict' | 'failed';

export function classifyError(error: unknown): FailureKind {
	const code =
		typeof error === 'object' && error !== null && 'code' in error
			? String((error as { code: unknown }).code)
			: '';
	if (code === 'unauthorized' || code === 'forbidden') return 'denied';
	if (code === 'incompatible' || code === 'not_found') return 'unsupported';
	if (code === 'conflict') return 'conflict';
	return 'failed';
}

export function errorMessage(error: unknown): string {
	if (error instanceof Error && error.message) return error.message;
	if (typeof error === 'string' && error) return error;
	return 'The server refused the change.';
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
