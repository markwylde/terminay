import { ClientError } from '@terminay/client-core';
import type { TerminalPanelClientContextValue } from '../components/TerminalPanel';
import type { ServerWorkspaceProject } from './serverWorkspaceReconciliation';

export type FeatureQueryScope = Readonly<{
	serverId: string;
	projectId: string;
	projectEnvironmentId: string;
	environmentRevision: number;
	projectRoot: string;
}>;

export type ProjectFeatureAuthority = Readonly<{
	applicationClient: NonNullable<TerminalPanelClientContextValue['applicationClient']>;
	agentStatusClient: NonNullable<TerminalPanelClientContextValue['agentStatusClient']>;
	fileObservationClient: NonNullable<TerminalPanelClientContextValue['fileObservationClient']>;
	fileViewerClient: NonNullable<TerminalPanelClientContextValue['fileViewerClient']>;
	gitClient: NonNullable<TerminalPanelClientContextValue['gitClient']>;
	recordingsClient: NonNullable<TerminalPanelClientContextValue['recordingsClient']>;
	scope: FeatureQueryScope;
}>;

export type FeatureAvailability =
	| Readonly<{ state: 'available'; authority: ProjectFeatureAuthority }>
	| Readonly<{ state: 'unavailable'; reason: string }>;

/**
 * Bind feature clients to an identity proven by the latest hydrated workspace
 * snapshot.  UI components must not manufacture project/environment scope from
 * tab labels or host state.
 */
export function resolveProjectFeatureAuthority(
	context: Omit<TerminalPanelClientContextValue, 'projectId'> | undefined,
	projectId: string,
): FeatureAvailability {
	if (context === undefined) {
		return { state: 'unavailable', reason: 'The selected server is not connected.' };
	}
	const snapshot = context.workspaceSnapshotStore?.snapshot;
	if (snapshot === null || snapshot === undefined) {
		return { state: 'unavailable', reason: 'The selected server workspace is still loading.' };
	}
	const project = snapshot.projects[projectId];
	if (project === undefined || project.serverId !== context.serverId) {
		return { state: 'unavailable', reason: 'The selected project is not available on this server.' };
	}
	const missing = missingFeatureClient(context);
	if (missing !== null) {
		return { state: 'unavailable', reason: `${missing} is unavailable on the selected server.` };
	}
	return {
		state: 'available',
		authority: {
			applicationClient: context.applicationClient!,
			agentStatusClient: context.agentStatusClient!,
			fileObservationClient: context.fileObservationClient!,
			fileViewerClient: context.fileViewerClient!,
			gitClient: context.gitClient!,
			recordingsClient: context.recordingsClient!,
			scope: scopeForProject(context.serverId, project),
		},
	};
}

export type FeatureFailure = Readonly<{
	title: string;
	detail: string;
	retryable: boolean;
	operation?: string;
}>;

/** Bounded, actionable copy for a failed server feature operation. */
export function describeFeatureFailure(
	feature: string,
	error: unknown,
	scope: Pick<FeatureQueryScope, 'serverId' | 'projectId'>,
): FeatureFailure {
	const operation = readOperation(error);
	const source = readOperation(error) !== undefined && typeof error === 'object' && error !== null && 'cause' in error && error.cause !== undefined
		? error.cause
		: error;
	const code = source instanceof ClientError ? source.code : undefined;
	const retryable = source instanceof ClientError ? source.retryable : false;
	const target = `project ${scope.projectId} on server ${scope.serverId}`;
	if (code === 'disconnected' || code === 'unavailable') {
		return {
			title: `${feature} is temporarily unavailable`,
			detail: `Reconnect to ${scope.serverId} and retry${operation === undefined ? '.' : ` ${operation}.`}`,
			retryable: true,
			...(operation === undefined ? {} : { operation }),
		};
	}
	if (code === 'unauthorized' || code === 'forbidden') {
		return {
			title: `${feature} access was denied`,
			detail: `The selected server account cannot access ${target}.`,
			retryable: false,
			...(operation === undefined ? {} : { operation }),
		};
	}
	if (code === 'not_found') {
		return {
			title: `${feature} scope is no longer available`,
			detail: `Refresh the workspace before retrying ${target}.`,
			retryable: true,
			...(operation === undefined ? {} : { operation }),
		};
	}
	const message = error instanceof Error ? error.message : String(error);
	return {
		title: `${feature} could not be loaded`,
		detail: `${operation === undefined ? 'The request' : operation} failed for ${target}: ${boundedText(message)}`,
		retryable,
		...(operation === undefined ? {} : { operation }),
	};
}

function scopeForProject(serverId: string, project: ServerWorkspaceProject): FeatureQueryScope {
	return {
		serverId,
		projectId: project.id,
		projectEnvironmentId: project.projectEnvironmentId,
		environmentRevision: project.environmentRevision,
		projectRoot: project.root,
	};
}

function missingFeatureClient(context: Omit<TerminalPanelClientContextValue, 'projectId'>): string | null {
	if (context.applicationClient === undefined) return 'Application queries';
	if (context.agentStatusClient === undefined) return 'Agent status';
	if (context.fileObservationClient === undefined) return 'File observation';
	if (context.fileViewerClient === undefined) return 'Explorer';
	if (context.gitClient === undefined) return 'Git';
	if (context.recordingsClient === undefined) return 'Recordings';
	return null;
}

function readOperation(error: unknown): string | undefined {
	if (typeof error !== 'object' || error === null || !('operation' in error)) return undefined;
	return typeof error.operation === 'string' ? error.operation : undefined;
}

function boundedText(value: string): string {
	const compact = value.replace(/\s+/g, ' ').trim();
	return compact.length <= 512 ? compact : `${compact.slice(0, 509)}…`;
}
