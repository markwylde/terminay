/**
 * The Import & Export bundle file: a versioned JSON document of portable items.
 * It carries no server id, item id, revision, or vault secret, and references
 * between items travel by name (ADR-0111). A bundle is validated in full
 * before anything from it is shown.
 */

import type { ColumnSnapshot, KindSnapshot } from './kinds.ts';
import { referencesOf, validatePortable } from './kinds.ts';
import {
	ITEM_KINDS,
	isRecord,
	itemKey,
	type ItemKind,
	type PortableItem,
	type ServerItem,
} from './model.ts';

export const BUNDLE_FORMAT = 'terminay.import-export';
export const BUNDLE_VERSION = 1;
export const MAX_BUNDLE_BYTES = 4 * 1024 * 1024;

export type Bundle = Readonly<{
	format: typeof BUNDLE_FORMAT;
	version: typeof BUNDLE_VERSION;
	exportedAt: string;
	source: Readonly<{ label: string }>;
	items: readonly PortableItem[];
}>;

export class BundleError extends Error {
	override readonly name = 'BundleError';
}

/**
 * The selected items plus every item they reference, so that an automation
 * exported alone can still be restored.
 */
export function withDependencies(
	selected: readonly ServerItem[],
	all: readonly ServerItem[],
): ServerItem[] {
	const byKey = new Map(all.map((item) => [itemKey(item.portable.kind, item.portable.name), item]));
	const chosen = new Map<string, ServerItem>();
	const visit = (item: ServerItem) => {
		const key = itemKey(item.portable.kind, item.portable.name);
		if (chosen.has(key)) return;
		chosen.set(key, item);
		for (const reference of item.references) {
			const dependency = byKey.get(itemKey(reference.kind, reference.name));
			if (dependency) visit(dependency);
		}
	};
	for (const item of selected) visit(item);
	return [...chosen.values()];
}

export function encodeBundle(
	items: readonly ServerItem[],
	sourceLabel: string,
	now: Date = new Date(),
): string {
	const bundle: Bundle = {
		format: BUNDLE_FORMAT,
		version: BUNDLE_VERSION,
		exportedAt: now.toISOString(),
		source: { label: sourceLabel },
		items: items.map((item) => item.portable),
	};
	const text = `${JSON.stringify(bundle, null, 2)}\n`;
	if (new TextEncoder().encode(text).byteLength > MAX_BUNDLE_BYTES)
		throw new BundleError('The selection is larger than the 4 MiB bundle limit.');
	return text;
}

/** Parses and validates a bundle. Throws a BundleError with the reason. */
export function decodeBundle(text: string): Bundle {
	if (new TextEncoder().encode(text).byteLength > MAX_BUNDLE_BYTES)
		throw new BundleError('The file is larger than the 4 MiB bundle limit.');
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		throw new BundleError('The file is not valid JSON.');
	}
	if (!isRecord(value)) throw new BundleError('The file is not an Import & Export bundle.');
	if (value.format !== BUNDLE_FORMAT)
		throw new BundleError('The file is not an Import & Export bundle.');
	if (value.version !== BUNDLE_VERSION)
		throw new BundleError(`Bundle version ${String(value.version)} is not supported.`);
	for (const key of Object.keys(value)) {
		if (!['format', 'version', 'exportedAt', 'source', 'items'].includes(key))
			throw new BundleError(`The bundle has a field it may not carry: ${key}`);
	}
	if (typeof value.exportedAt !== 'string') throw new BundleError('The bundle has no export time.');
	if (!isRecord(value.source) || typeof value.source.label !== 'string')
		throw new BundleError('The bundle does not name its source.');
	if (!Array.isArray(value.items)) throw new BundleError('The bundle has no items.');

	const items: PortableItem[] = [];
	const keys = new Set<string>();
	for (const raw of value.items) {
		let item: PortableItem;
		try {
			item = validatePortable(raw);
		} catch (error) {
			throw new BundleError(error instanceof Error ? error.message : 'An item is invalid.');
		}
		const key = itemKey(item.kind, item.name);
		if (keys.has(key)) throw new BundleError(`Two items are named "${item.name}".`);
		keys.add(key);
		items.push(item);
	}
	for (const item of items) {
		for (const reference of referencesOf(item)) {
			if (!keys.has(itemKey(reference.kind, reference.name)))
				throw new BundleError(
					`"${item.name}" names "${reference.name}", which is not in the bundle.`,
				);
		}
	}
	return {
		format: BUNDLE_FORMAT,
		version: BUNDLE_VERSION,
		exportedAt: value.exportedAt,
		source: { label: value.source.label },
		items,
	};
}

/** A bundle as a read-only matrix column. */
export function bundleSnapshot(bundle: Bundle): ColumnSnapshot {
	const byKind = Object.fromEntries(
		ITEM_KINDS.map((kind) => [kind, [] as ServerItem[]]),
	) as Record<ItemKind, ServerItem[]>;
	for (const item of bundle.items) {
		byKind[item.kind].push({ portable: item, references: referencesOf(item), dangling: false });
	}
	return Object.fromEntries(
		ITEM_KINDS.map((kind): [ItemKind, KindSnapshot] => [
			kind,
			{ state: 'ok', revision: 0, items: byKind[kind] },
		]),
	) as ColumnSnapshot;
}
