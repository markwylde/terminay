import type { JsonValue } from './types.js';

export const EXTENSION_OPERATION_NAMES = [
	'extensions.list',
	'extensions.get',
	'extensions.enable',
	'extensions.disable',
	'extensions.restart',
	'extensions.remove',
	'extensions.preview-install',
	'extensions.install',
	'extensions.preview-update',
	'extensions.update',
	'extensions.rollback',
] as const;
export type ExtensionOperationName = (typeof EXTENSION_OPERATION_NAMES)[number];

export const EXTENSION_EVENT_NAMES = [
	'extensions.changed',
	'extensions.operation-changed',
] as const;
export type ExtensionEventName = (typeof EXTENSION_EVENT_NAMES)[number];

export type ExtensionPermissionPolicy = 'extensions:read' | 'extensions:manage';

export interface RevisionedRequest {
	expectedRevision: number;
}
export interface IdempotentRequest {
	idempotencyKey: string;
}
export interface BoundedRequest {
	deadlineAt: string;
}

export interface ExtensionSummary {
	extensionId: string;
	packageName: string;
	activeVersion?: string;
	pendingVersion?: string;
	displayName: string;
	official: boolean;
	enabled: boolean;
	compatible: boolean;
	runtimeState: 'stopped' | 'starting' | 'running' | 'failed' | 'quarantined';
	failureMessage?: string;
	revision: number;
}

export interface ExtensionInstallPreview {
	previewDigest: string;
	packageName: string;
	exactVersion: string;
	registryIntegrity: string;
	publisher?: string;
	maintainers: string[];
	repository?: string;
	extensionId: string;
	permissions: string[];
	dependencies: Array<{ name: string; exactVersion: string }>;
	provenance: 'verified' | 'unavailable' | 'failed';
	audit: { low: number; moderate: number; high: number; critical: number };
}

export interface InstallExtensionRequest
	extends RevisionedRequest,
		IdempotentRequest,
		BoundedRequest {
	previewDigest: string;
	confirmation: true;
}

export interface OrderedExtensionEvent<T = JsonValue> {
	event: ExtensionEventName;
	cursor: string;
	sequence: number;
	revision: number;
	occurredAt: string;
	payload: T;
}

export interface ProtocolOperation<Request = JsonValue, Response = JsonValue> {
	name: ExtensionOperationName;
	permission: ExtensionPermissionPolicy;
	request: Request;
	response: Response;
}

export const OPERATION_POLICIES: Readonly<
	Record<ExtensionOperationName, ExtensionPermissionPolicy>
> = Object.freeze({
	'extensions.list': 'extensions:read',
	'extensions.get': 'extensions:read',
	'extensions.enable': 'extensions:manage',
	'extensions.disable': 'extensions:manage',
	'extensions.restart': 'extensions:manage',
	'extensions.remove': 'extensions:manage',
	'extensions.preview-install': 'extensions:manage',
	'extensions.install': 'extensions:manage',
	'extensions.preview-update': 'extensions:manage',
	'extensions.update': 'extensions:manage',
	'extensions.rollback': 'extensions:manage',
});
