import { FEATURE_CAPABILITIES, type FeatureCapability } from '@terminay/protocol';

/**
 * Connection mechanics: health, liveness, event subscription, and the hello
 * itself. They are not features, so they are never advertised as a versioned
 * feature capability and never gate a feature client.
 */
export const CONNECTION_MECHANICS = 'connection.mechanics' as const;

export type OperationCapability =
	| FeatureCapability
	| typeof CONNECTION_MECHANICS;

/**
 * The operation namespace table. Every operation a composed server registers
 * belongs to exactly one declared capability; a namespace that cannot be
 * classified is a bug in this table, never a reason to leave the operation
 * unclassified.
 */
const OPERATION_NAMESPACES: ReadonlyMap<string, OperationCapability> = new Map<
	string,
	OperationCapability
>([
	['workspace', FEATURE_CAPABILITIES.workspace],
	['project', FEATURE_CAPABILITIES.workspace],
	['panel', FEATURE_CAPABILITIES.workspace],
	['view', FEATURE_CAPABILITIES.workspace],
	['terminal', FEATURE_CAPABILITIES.terminal],
	['terminals', FEATURE_CAPABILITIES.terminal],
	['files', FEATURE_CAPABILITIES.files],
	['file', FEATURE_CAPABILITIES.files],
	['docs', FEATURE_CAPABILITIES.files],
	['documentation', FEATURE_CAPABILITIES.files],
	['mdx', FEATURE_CAPABILITIES.files],
	['git', FEATURE_CAPABILITIES.git],
	['worktree', FEATURE_CAPABILITIES.git],
	['agent', FEATURE_CAPABILITIES.agents],
	['agents', FEATURE_CAPABILITIES.agents],
	['activity', FEATURE_CAPABILITIES.agents],
	['settings', FEATURE_CAPABILITIES.settings],
	['shell-profiles', FEATURE_CAPABILITIES.settings],
	['macros', FEATURE_CAPABILITIES.macros],
	['recordings', FEATURE_CAPABILITIES.recording],
	['recording', FEATURE_CAPABILITIES.recording],
	['ai', FEATURE_CAPABILITIES.dictation],
	['dictation', FEATURE_CAPABILITIES.dictation],
	['extensions', FEATURE_CAPABILITIES.extensions],
	['extension', FEATURE_CAPABILITIES.extensions],
	['language', FEATURE_CAPABILITIES.language],
	['server', CONNECTION_MECHANICS],
	['events', CONNECTION_MECHANICS],
	['connection', CONNECTION_MECHANICS],
]);

/**
 * The capability an operation belongs to, or `undefined` when the namespace is
 * unknown. Callers treat `undefined` as a composition error rather than as an
 * ungated operation.
 */
export function capabilityOf(operation: string): OperationCapability | undefined {
	if (typeof operation !== 'string' || operation.length === 0) return undefined;
	const namespace = operation.split('.', 1)[0] ?? '';
	return OPERATION_NAMESPACES.get(namespace);
}

/** True when the capability is a feature a server advertises in its hello. */
export function isFeatureCapability(
	capability: OperationCapability,
): capability is FeatureCapability {
	return capability !== CONNECTION_MECHANICS;
}
