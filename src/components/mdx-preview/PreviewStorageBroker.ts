const PREFIX = 'terminay.mdx.preview.';
const MAX_ENTRIES = 256;
const MAX_KEY_LENGTH = 256;
const MAX_VALUE_LENGTH = 4_096;

export type PreviewStorageSnapshot = Readonly<{ entries: Record<string, string>; cookie: string }>;

/** Host-owned project storage for opaque previews. The preview receives only a
 * copied snapshot and can mutate it only through the validated message union. */
export class PreviewStorageBroker {
	private readonly storage: Storage;
	constructor(storage: Storage) { this.storage = storage; }
	snapshot(projectKey: string): PreviewStorageSnapshot {
		try { const raw = this.storage.getItem(`${PREFIX}${projectKey}`); return raw ? normalize(JSON.parse(raw)) : empty(); }
		catch { return empty(); }
	}
	persist(projectKey: string, value: unknown): void {
		try { this.storage.setItem(`${PREFIX}${projectKey}`, JSON.stringify(normalize(value))); }
		catch { /* Quota failures leave the current isolated preview usable. */ }
	}
}

function normalize(value: unknown): PreviewStorageSnapshot {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return empty();
	const item = value as Record<string, unknown>;
	if (typeof item.cookie !== 'string' || typeof item.entries !== 'object' || item.entries === null || Array.isArray(item.entries)) return empty();
	return Object.freeze({ cookie: item.cookie.slice(0, MAX_VALUE_LENGTH), entries: Object.fromEntries(Object.entries(item.entries).filter(([key, entry]) => key.length <= MAX_KEY_LENGTH && typeof entry === 'string' && entry.length <= MAX_VALUE_LENGTH).slice(0, MAX_ENTRIES)) as Record<string, string> });
}
function empty(): PreviewStorageSnapshot { return Object.freeze({ entries: {}, cookie: '' }); }
