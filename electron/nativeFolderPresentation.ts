/** Native presentation uses server/profile and view identities, never focus or
 * renderer-supplied titles. This module has no workspace mutation authority. */
export interface FolderLaunchWindow {
	readonly webContents: { readonly id: number };
	isDestroyed(): boolean;
	isMinimized(): boolean;
	restore(): void;
	show(): void;
	focus(): void;
	once(event: 'closed', callback: () => void): unknown;
	removeListener(event: 'closed', callback: () => void): unknown;
}

export async function presentLocalFolderLaunch<
	Window extends FolderLaunchWindow,
>(options: {
	readonly localProfileId: string;
	readonly viewId: string;
	readonly candidates: readonly {
		readonly window: Window;
		readonly profileId: string;
		readonly viewId: string | undefined;
		readonly auxiliary: boolean;
	}[];
	readonly createLocalWindow: (viewId: string) => Window | null;
	readonly present: (ownerId: number, signal: AbortSignal) => Promise<void>;
	readonly timeoutMs?: number;
}): Promise<void> {
	const target =
		options.candidates.find(
			(candidate) =>
				!candidate.auxiliary &&
				candidate.profileId === options.localProfileId &&
				candidate.viewId === options.viewId &&
				!candidate.window.isDestroyed(),
		)?.window ?? options.createLocalWindow(options.viewId);
	if (!target)
		throw new Error(
			'Desktop is closing. The new terminal remains in the Local terminal list.',
		);
	const abort = new AbortController();
	const timer = setTimeout(() => abort.abort(), options.timeoutMs ?? 10_000);
	const onClosed = () => abort.abort();
	target.once('closed', onClosed);
	try {
		await options.present(target.webContents.id, abort.signal);
		if (target.isDestroyed())
			throw new Error(
				'The local window closed. The new terminal remains in the Local terminal list.',
			);
		if (target.isMinimized()) target.restore();
		target.show();
		target.focus();
	} finally {
		clearTimeout(timer);
		target.removeListener('closed', onClosed);
	}
}
