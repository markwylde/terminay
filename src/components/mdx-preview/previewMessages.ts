export type MdxPreviewMessage =
	| { readonly version: 1; readonly kind: 'ready'; readonly runtimeId: string }
	| {
			readonly version: 1;
			readonly kind: 'resize';
			readonly runtimeId: string;
			readonly height: number;
	  }
	| {
			readonly version: 1;
			readonly kind: 'diagnostic';
			readonly runtimeId: string;
			readonly message: string;
	  }
	| {
			readonly version: 1;
			readonly kind: 'open-document';
			readonly runtimeId: string;
			readonly path: string;
	  }
	| {
			readonly version: 1;
			readonly kind: 'download';
			readonly runtimeId: string;
			readonly url: string;
			readonly filename?: string;
	  };

const KINDS = new Set([
	'ready',
	'resize',
	'diagnostic',
	'open-document',
	'download',
]);

export function isPreviewMessage(
	value: unknown,
	runtimeId: string,
): value is MdxPreviewMessage {
	if (typeof value !== 'object' || value === null) return false;
	const item = value as Record<string, unknown>;
	if (item.version !== 1 || item.runtimeId !== runtimeId) return false;
	if (typeof item.kind !== 'string' || !KINDS.has(item.kind)) return false;
	if (item.kind === 'ready') return true;
	if (item.kind === 'resize')
		return Number.isFinite(item.height) && (item.height as number) >= 0;
	if (item.kind === 'diagnostic')
		return typeof item.message === 'string' && item.message.length > 0;
	if (item.kind === 'open-document')
		return (
			typeof item.path === 'string' &&
			item.path.length > 0 &&
			!item.path.startsWith('/') &&
			!item.path.includes('..')
		);
	return (
		typeof item.url === 'string' &&
		/^https?:/iu.test(item.url) &&
		(item.filename === undefined || typeof item.filename === 'string')
	);
}

export function isPreviewStorageMutation(
	value: unknown,
	runtimeId: string,
): value is {
	readonly version: 1;
	readonly kind: 'storage';
	readonly runtimeId: string;
	readonly entries: Record<string, string>;
	readonly cookie: string;
} {
	if (typeof value !== 'object' || value === null) return false;
	const item = value as Record<string, unknown>;
	return (
		item.version === 1 &&
		item.runtimeId === runtimeId &&
		item.kind === 'storage' &&
		typeof item.cookie === 'string' &&
		typeof item.entries === 'object' &&
		item.entries !== null &&
		!Array.isArray(item.entries)
	);
}

export function isPreviewExternalUrl(
	value: unknown,
	runtimeId: string,
): value is {
	readonly version: 1;
	readonly kind: 'open-external';
	readonly runtimeId: string;
	readonly url: string;
} {
	if (typeof value !== 'object' || value === null) return false;
	const item = value as Record<string, unknown>;
	return (
		item.version === 1 &&
		item.runtimeId === runtimeId &&
		item.kind === 'open-external' &&
		typeof item.url === 'string' &&
		/^https?:/iu.test(item.url)
	);
}
