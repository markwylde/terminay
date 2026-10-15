import type { BrowseRootFoldersResult } from '@terminay/client-core';
import { startRefusalMessage } from './projectStart.ts';

export type RootFolderListing =
	| Readonly<{ state: 'loading'; previous?: BrowseRootFoldersResult }>
	| Readonly<{ state: 'ready'; folder: BrowseRootFoldersResult }>
	| Readonly<{
			state: 'error';
			message: string;
			previous?: BrowseRootFoldersResult;
	  }>;

/** The listing the browser is on, whatever it is doing now. */
export function listedFolder(
	listing: RootFolderListing,
): BrowseRootFoldersResult | undefined {
	return listing.state === 'ready' ? listing.folder : listing.previous;
}

/**
 * Moves the browser between folders. Only the newest request may land: a
 * slow answer for a folder the person has already left is dropped.
 */
export class RootFolderNavigator {
	private request = 0;
	private current: RootFolderListing = { state: 'loading' };

	private readonly browse: (path?: string) => Promise<BrowseRootFoldersResult>;
	private readonly onChange: (listing: RootFolderListing) => void;

	constructor(
		browse: (path?: string) => Promise<BrowseRootFoldersResult>,
		onChange: (listing: RootFolderListing) => void,
	) {
		this.browse = browse;
		this.onChange = onChange;
	}

	get listing(): RootFolderListing {
		return this.current;
	}

	/** Lists `path`, or the server account's home when it is absent. */
	async open(path?: string): Promise<void> {
		const request = ++this.request;
		this.set({ state: 'loading', previous: listedFolder(this.current) });
		try {
			const folder = await this.browse(path);
			if (request === this.request) this.set({ state: 'ready', folder });
		} catch (error) {
			if (request !== this.request) return;
			this.set({
				state: 'error',
				message: startRefusalMessage(error),
				previous: listedFolder(this.current),
			});
		}
	}

	/** Stop listening for answers. */
	dispose(): void {
		this.request += 1;
	}

	private set(listing: RootFolderListing): void {
		this.current = listing;
		this.onChange(listing);
	}
}
