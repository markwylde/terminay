/** `details.reason` of a command the server's storage refused (ADR-0150).
 * Clients show such a failure's message as sent. */
export const STORAGE_FAILURE_REASONS = Object.freeze({
	full: 'storage_full',
	quotaExceeded: 'storage_quota_exceeded',
	readOnly: 'storage_read_only',
	permission: 'storage_permission',
} as const);
export type StorageFailureReason =
	(typeof STORAGE_FAILURE_REASONS)[keyof typeof STORAGE_FAILURE_REASONS];
