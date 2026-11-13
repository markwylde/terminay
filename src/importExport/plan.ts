/**
 * Review and apply. Review turns the selected rows into a plan of writes for
 * each target, with every clash left for the user to decide. Apply runs the
 * plan in dependency order through each target's own client, binding an
 * automation's references to what its dependencies actually produced.
 */

import {
	type ColumnSnapshot,
	type ImportExportClients,
	referenceKey,
	type RevisionDomain,
	revisionDomain,
	writeItem,
} from './kinds.ts';
import type { MatrixRow } from './matrix.ts';
import {
	classifyError,
	errorMessage,
	fingerprint,
	itemKey,
	type ItemKind,
	type NamedReference,
	nextFreeName,
	type ServerItem,
} from './model.ts';

export type Decision = 'replace' | 'keepBoth' | 'skip';

export type PlanNode = Readonly<{
	id: string;
	targetId: string;
	kind: ItemKind;
	key: string;
	name: string;
	source: ServerItem;
	/** add: missing on the target; clash: present and different; upToDate: the same. */
	status: 'add' | 'clash' | 'upToDate' | 'blocked';
	/** The target's items with this key. */
	existing: readonly ServerItem[];
	choices: readonly Decision[];
	/** Added because an automation needs it, not because the user chose it. */
	dependency: boolean;
	/** For each reference, the node it binds to, or the target id it binds to. */
	bindings: readonly Readonly<{ reference: NamedReference; nodeId?: string; existingId?: string }>[];
	blockedReason?: string;
}>;

export type TargetPlan = Readonly<{
	targetId: string;
	nodes: readonly PlanNode[];
	revisions: Readonly<Partial<Record<RevisionDomain, number>>>;
	/** Keys already taken on the target, for Keep both names. */
	takenKeys: ReadonlySet<string>;
}>;

export type Plan = Readonly<{ sourceId: string; targets: readonly TargetPlan[] }>;

const KIND_ORDER: readonly ItemKind[] = [
	'shellProfile',
	'macro',
	'workflowTemplate',
	'settingsCategory',
	'automation',
];

function choicesFor(kind: ItemKind): readonly Decision[] {
	return kind === 'settingsCategory' ? ['replace', 'skip'] : ['replace', 'keepBoth', 'skip'];
}

function targetItems(snapshot: ColumnSnapshot, kind: ItemKind): readonly ServerItem[] {
	const data = snapshot[kind];
	return data.state === 'ok' ? data.items : [];
}

function revisionsOf(snapshot: ColumnSnapshot): Partial<Record<RevisionDomain, number>> {
	const revisions: Partial<Record<RevisionDomain, number>> = {};
	for (const kind of KIND_ORDER) {
		const data = snapshot[kind];
		if (data.state === 'ok') revisions[revisionDomain(kind)] ??= data.revision;
	}
	return revisions;
}

export function buildPlan(input: Readonly<{
	sourceId: string;
	source: ColumnSnapshot;
	rows: readonly MatrixRow[];
	selectedKeys: ReadonlySet<string>;
	targets: readonly Readonly<{ id: string; snapshot: ColumnSnapshot }>[];
}>): Plan {
	const sourceByKey = new Map<string, ServerItem[]>();
	for (const kind of KIND_ORDER) {
		for (const item of targetItems(input.source, kind)) {
			const key = itemKey(kind, item.portable.name);
			sourceByKey.set(key, [...(sourceByKey.get(key) ?? []), item]);
		}
	}
	const selectedRows = input.rows.filter(
		(row) => input.selectedKeys.has(row.key) && row.sourceItem !== undefined,
	);

	const targets = input.targets.map((target): TargetPlan => {
		const nodes: PlanNode[] = [];
		const nodeByKey = new Map<string, PlanNode>();
		const takenKeys = new Set<string>();
		for (const kind of KIND_ORDER)
			for (const item of targetItems(target.snapshot, kind))
				takenKeys.add(itemKey(kind, item.portable.name));

		const targetByKey = (key: string, kind: ItemKind) =>
			targetItems(target.snapshot, kind).filter(
				(item) => itemKey(kind, item.portable.name) === key,
			);

		const addNode = (source: ServerItem, dependency: boolean): PlanNode => {
			const kind = source.portable.kind;
			const key = itemKey(kind, source.portable.name);
			const existing = targetByKey(key, kind);
			const unsupported = target.snapshot[kind].state !== 'ok';
			const status: PlanNode['status'] = unsupported
				? 'blocked'
				: existing.length === 0
					? 'add'
					: existing.length === 1 &&
							fingerprint(existing[0].portable) === fingerprint(source.portable)
						? 'upToDate'
						: 'clash';
			const node: PlanNode = {
				id: `${target.id}|${key}`,
				targetId: target.id,
				kind,
				key,
				name: source.portable.name.trim(),
				source,
				status,
				existing,
				choices: status === 'clash' ? choicesFor(kind) : [],
				dependency,
				bindings: [],
				...(unsupported ? { blockedReason: 'This server cannot take this kind.' } : {}),
			};
			nodeByKey.set(key, node);
			nodes.push(node);
			return node;
		};

		for (const row of selectedRows) {
			if (!nodeByKey.has(row.key)) addNode(row.sourceItem!, false);
		}

		// Resolve every automation's references, adding missing dependencies.
		for (const node of [...nodes]) {
			if (node.kind !== 'automation') continue;
			const bindings: PlanNode['bindings'][number][] = [];
			let blockedReason = node.blockedReason;
			for (const reference of node.source.references) {
				const key = referenceKey(reference);
				const bound = nodeByKey.get(key);
				if (bound) {
					bindings.push({ reference, nodeId: bound.id });
					continue;
				}
				const existing = targetByKey(key, reference.kind);
				if (existing.length === 1 && existing[0].id !== undefined) {
					bindings.push({ reference, existingId: existing[0].id });
					continue;
				}
				if (existing.length > 1) {
					blockedReason ??= `More than one ${reference.kind === 'macro' ? 'macro' : 'shell profile'} is named "${reference.name}" on this server.`;
					continue;
				}
				const sourceItems = sourceByKey.get(key) ?? [];
				if (sourceItems.length !== 1 || reference.name.trim() === '') {
					blockedReason ??= `"${reference.name || 'A referenced item'}" cannot be found on the source.`;
					continue;
				}
				const dependency = addNode(sourceItems[0], true);
				bindings.push({ reference, nodeId: dependency.id });
			}
			if (node.source.dangling) blockedReason ??= 'It names an item its own server no longer has.';
			const updated: PlanNode = {
				...node,
				bindings,
				...(blockedReason ? { status: 'blocked' as const, choices: [], blockedReason } : {}),
			};
			nodes[nodes.indexOf(node)] = updated;
			nodeByKey.set(node.key, updated);
		}

		nodes.sort(
			(a, b) =>
				KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
				a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }),
		);
		return { targetId: target.id, nodes, revisions: revisionsOf(target.snapshot), takenKeys };
	});
	return { sourceId: input.sourceId, targets };
}

export type Decisions = ReadonlyMap<string, Decision>;
/** For Replace on a duplicate target: the id of the one item to replace. */
export type ReplacePicks = ReadonlyMap<string, string>;

export function nodeNeedsPick(node: PlanNode, decision: Decision | undefined): boolean {
	return decision === 'replace' && node.existing.length > 1;
}

/** Apply is available once every clash has a choice and every needed pick is made. */
export function planIsDecided(plan: Plan, decisions: Decisions, picks: ReplacePicks): boolean {
	return plan.targets.every((target) =>
		target.nodes.every((node) => {
			if (node.status !== 'clash') return true;
			const decision = decisions.get(node.id);
			if (decision === undefined) return false;
			return !nodeNeedsPick(node, decision) || picks.has(node.id);
		}),
	);
}

export function undecidedCount(plan: Plan, decisions: Decisions, picks: ReplacePicks): number {
	let count = 0;
	for (const target of plan.targets)
		for (const node of target.nodes) {
			if (node.status !== 'clash') continue;
			const decision = decisions.get(node.id);
			if (decision === undefined || (nodeNeedsPick(node, decision) && !picks.has(node.id)))
				count += 1;
		}
	return count;
}

export type Outcome =
	| 'added'
	| 'replaced'
	| 'skipped'
	| 'upToDate'
	| 'changedSinceReview'
	| 'blockedByDependency'
	| 'failed';

export const OUTCOME_TEXT: Readonly<Record<Outcome, string>> = Object.freeze({
	added: 'Added',
	replaced: 'Replaced',
	skipped: 'Skipped',
	upToDate: 'Up to date',
	changedSinceReview: 'Changed since review',
	blockedByDependency: 'Blocked by dependency',
	failed: 'Failed',
});

export type ApplyResult = Readonly<{
	nodeId: string;
	targetId: string;
	kind: ItemKind;
	name: string;
	outcome: Outcome;
	message?: string;
}>;

/**
 * Runs the plan. Each target's nodes run in order; nothing rolls back. A
 * stale revision is reported as changed since review, and every later write
 * in that revision domain on that target is reported the same way rather
 * than sent.
 */
export async function applyPlan(
	plan: Plan,
	decisions: Decisions,
	picks: ReplacePicks,
	clientsFor: (targetId: string) => ImportExportClients | undefined,
	onResult?: (result: ApplyResult) => void,
): Promise<ApplyResult[]> {
	const results: ApplyResult[] = [];
	const report = (node: PlanNode, outcome: Outcome, message?: string) => {
		const result: ApplyResult = {
			nodeId: node.id,
			targetId: node.targetId,
			kind: node.kind,
			name: node.name,
			outcome,
			...(message === undefined ? {} : { message }),
		};
		results.push(result);
		onResult?.(result);
	};

	for (const target of plan.targets) {
		const clients = clientsFor(target.targetId);
		const revisions: Partial<Record<RevisionDomain, number>> = { ...target.revisions };
		const staleDomains = new Set<RevisionDomain>();
		const produced = new Map<string, Readonly<{ outcome: Outcome; id?: string }>>();
		const takenKeys = new Set(target.takenKeys);

		for (const node of target.nodes) {
			const finish = (outcome: Outcome, id?: string, message?: string) => {
				produced.set(node.id, { outcome, ...(id === undefined ? {} : { id }) });
				report(node, outcome, message);
			};
			if (node.status === 'blocked') {
				finish('blockedByDependency', undefined, node.blockedReason);
				continue;
			}
			if (node.status === 'upToDate') {
				finish('upToDate', node.existing[0]?.id);
				continue;
			}
			const decision: Decision | 'add' = node.status === 'add' ? 'add' : decisions.get(node.id)!;
			if (decision === 'skip') {
				finish('skipped', node.existing.length === 1 ? node.existing[0].id : undefined);
				continue;
			}
			if (clients === undefined) {
				finish('failed', undefined, 'The server is no longer connected.');
				continue;
			}
			const domain = revisionDomain(node.kind);
			if (staleDomains.has(domain)) {
				finish('changedSinceReview');
				continue;
			}

			const references = new Map<string, string>();
			let blocked: string | undefined;
			for (const binding of node.bindings) {
				if (binding.existingId !== undefined) {
					references.set(referenceKey(binding.reference), binding.existingId);
					continue;
				}
				const dependency = binding.nodeId ? produced.get(binding.nodeId) : undefined;
				if (
					dependency?.id === undefined ||
					!['added', 'replaced', 'skipped', 'upToDate'].includes(dependency.outcome)
				) {
					blocked = `"${binding.reference.name}" was not written.`;
					break;
				}
				references.set(referenceKey(binding.reference), dependency.id);
			}
			if (blocked) {
				finish('blockedByDependency', undefined, blocked);
				continue;
			}

			const name =
				decision === 'keepBoth' ? nextFreeName(node.kind, node.name, takenKeys) : node.name;
			const targetItemId =
				decision === 'replace'
					? node.existing.length > 1
						? picks.get(node.id)
						: node.existing[0]?.id
					: undefined;
			try {
				const written = await writeItem(clients, {
					item: node.source.portable,
					mode: decision,
					name,
					...(targetItemId === undefined ? {} : { targetId: targetItemId }),
					references,
					expectedRevision: revisions[domain] ?? 0,
				});
				revisions[domain] = written.revision;
				takenKeys.add(itemKey(node.kind, name));
				finish(decision === 'replace' ? 'replaced' : 'added', written.id);
			} catch (error) {
				if (classifyError(error) === 'conflict') {
					staleDomains.add(domain);
					finish('changedSinceReview');
				} else {
					finish('failed', undefined, errorMessage(error));
				}
			}
		}
	}
	return results;
}
