/**
 * Presentation rules for one server file-catalog entry. The server reports a
 * symlink as its own kind so the client can see the link, and reports what the
 * link resolves to separately. Both are needed here: a link to a directory is a
 * folder to the person reading the sidebar, and presenting it as a file leaves
 * an expandable directory looking like a leaf that cannot be opened.
 */
export function isDirectoryEntry(entry: {
	readonly kind: string;
	readonly targetKind?: string;
	readonly accessible?: boolean;
}): boolean {
	if (entry.kind === 'directory') return true;
	return (
		entry.kind === 'symlink' &&
		entry.targetKind === 'directory' &&
		entry.accessible !== false
	);
}
