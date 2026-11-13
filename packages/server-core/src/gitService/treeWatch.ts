import { type Dir, type FSWatcher, watch as nodeWatch } from 'node:fs';
import { lstat as nodeLstat, opendir as nodeOpendir } from 'node:fs/promises';
import { join, sep } from 'node:path';
import type { GitWatchHandle, GitWatchOptions } from './types.js';

/**
 * A recursive watch built from one non-recursive `fs.watch` per directory, for
 * hosts whose kernel has no recursive watch (Linux).
 *
 * Node's own `recursive: true` on Linux re-walks the changed folder with
 * `readdirSync` on the main thread for every event, and descends into every
 * ignored tree. A build churning `dist/` in a large repository then holds the
 * event loop for minutes (ADR-0113). This watch never walks synchronously:
 * all discovery runs from a queue, one bounded step per macrotask, and the
 * caller's `filterDirectories` keeps it out of ignored trees.
 */

export interface TreeWatchFs {
	watch(
		path: string,
		options: { persistent: boolean },
		listener: (event: string, filename: string | Buffer | null) => void,
	): FSWatcher;
	lstat(path: string): Promise<{
		isDirectory(): boolean;
		readonly dev: number;
		readonly ino: number;
	}>;
	opendir(path: string, options: { bufferSize: number }): Promise<Dir>;
}

export interface TreeWatchLimits {
	/** Directory entries read per step. */
	readonly entriesPerStep: number;
	/** `fs.watch` calls (and the stats around them) per step. */
	readonly watchesPerStep: number;
	/** Candidates handed to the filter in one call. */
	readonly filterBatch: number;
	/** Directories one watch may hold before it fails. */
	readonly maxDirectories: number;
}

export const DEFAULT_TREE_WATCH_LIMITS: TreeWatchLimits = {
	entriesPerStep: 512,
	watchesPerStep: 64,
	filterBatch: 64,
	maxDirectories: 16_384,
};

const NODE_FS: TreeWatchFs = {
	watch: (path, options, listener) =>
		nodeWatch(path, options, (event, filename) => listener(event, filename)),
	lstat: (path) => nodeLstat(path),
	opendir: (path, options) => nodeOpendir(path, options),
};

export class TreeWatchError extends Error {
	readonly code: string;
	constructor(code: string, message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = 'TreeWatchError';
		this.code = code;
	}
}

interface WatchedDirectory {
	readonly watcher: FSWatcher;
	dev: number;
	ino: number;
	/** Child names the filter (or a nested `.git`) excluded. */
	readonly excluded: Set<string>;
	closing: boolean;
}

/** Why a directory is in front of the filter. */
type CandidateOrigin =
	/** First seen; `deliver` reports a change if it is kept. */
	| { readonly kind: 'new'; deliver: boolean }
	/** Excluded before; kept now means it is taken up. */
	| { readonly kind: 'excluded' }
	/** Watched now; dropped now means it is closed. */
	| { readonly kind: 'watched' };

interface Listing {
	readonly rel: string;
	readonly dir: Dir;
	readonly children: string[];
	sawGit: boolean;
	readonly report: boolean;
}

function isCode(error: unknown, ...codes: string[]): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		codes.includes(String((error as { code?: unknown }).code))
	);
}

function parentOf(rel: string): string {
	const at = rel.lastIndexOf(sep);
	return at < 0 ? '' : rel.slice(0, at);
}

function nameOf(rel: string): string {
	const at = rel.lastIndexOf(sep);
	return at < 0 ? rel : rel.slice(at + 1);
}

function within(rel: string, ancestor: string): boolean {
	return (
		ancestor === '' || rel === ancestor || rel.startsWith(`${ancestor}${sep}`)
	);
}

export function createTreeWatch(
	root: string,
	options: GitWatchOptions,
	deps: { fs?: TreeWatchFs; limits?: Partial<TreeWatchLimits> } = {},
): GitWatchHandle {
	const fs = deps.fs ?? NODE_FS;
	const limits = { ...DEFAULT_TREE_WATCH_LIMITS, ...deps.limits };
	const controller = new AbortController();
	const { signal } = controller;

	const dirs = new Map<string, WatchedDirectory>();
	/** Changed entries waiting to be classified. */
	const events = new Set<string>();
	/**
	 * Watched directories whose own watcher reported something: confirm they
	 * still exist, so a deletion is seen even if the parent's event is lost.
	 */
	const selfChecks = new Set<string>();
	/** Directories waiting for the filter, by relative path. */
	const candidates = new Map<string, CandidateOrigin>();
	/** Directories the filter kept, waiting to be armed; value: report a change once listed. */
	const arms = new Map<string, boolean>();
	/** Armed directories waiting to be listed. */
	const lists: { rel: string; report: boolean }[] = [];
	let listing: Listing | undefined;
	let generation = 0;
	let scheduled = false;
	let running = false;
	let settled = false;
	let done = false;

	const abs = (rel: string) => (rel === '' ? root : join(root, rel));

	const deliver = (rel: string | null) => {
		if (!signal.aborted) options.onChange(rel);
	};

	const closeAll = () => {
		for (const entry of dirs.values()) {
			entry.closing = true;
			entry.watcher.close();
		}
		dirs.clear();
		events.clear();
		selfChecks.clear();
		candidates.clear();
		arms.clear();
		lists.length = 0;
		const open = listing;
		listing = undefined;
		open?.dir.close().catch(() => undefined);
	};

	const fail = (error: unknown) => {
		if (done) return;
		done = true;
		controller.abort();
		closeAll();
		options.onError(error);
	};

	/** Forget `rel` and everything beneath it: it was removed or replaced. */
	const closeSubtree = (rel: string) => {
		if (rel === '') {
			fail(new TreeWatchError('ENOENT', 'the watched path went away'));
			return;
		}
		for (const [path, entry] of [...dirs])
			if (within(path, rel)) {
				entry.closing = true;
				entry.watcher.close();
				dirs.delete(path);
			}
		for (const path of [...candidates.keys()])
			if (within(path, rel)) candidates.delete(path);
		for (const path of [...arms.keys()])
			if (within(path, rel)) arms.delete(path);
		for (let index = lists.length - 1; index >= 0; index--)
			if (within(lists[index]?.rel ?? '', rel)) lists.splice(index, 1);
		if (listing !== undefined && within(listing.rel, rel)) {
			listing.dir.close().catch(() => undefined);
			listing = undefined;
		}
	};

	const schedule = () => {
		if (scheduled || running || signal.aborted) return;
		scheduled = true;
		setImmediate(() => {
			scheduled = false;
			void run();
		});
	};

	const hasWork = () =>
		events.size > 0 ||
		selfChecks.size > 0 ||
		candidates.size > 0 ||
		arms.size > 0 ||
		lists.length > 0 ||
		listing !== undefined;

	const run = async () => {
		if (signal.aborted) return;
		running = true;
		try {
			await step();
		} catch (error) {
			fail(error);
		} finally {
			running = false;
		}
		if (signal.aborted) return;
		if (hasWork()) schedule();
		else settled = true;
	};

	const onWatchEvent = (rel: string, filename: string | Buffer | null) => {
		if (signal.aborted) return;
		if (filename === null) {
			deliver(null);
			return;
		}
		const name = String(filename);
		selfChecks.add(rel);
		if (name !== '' && !dirs.get(rel)?.excluded.has(name))
			events.add(rel === '' ? name : join(rel, name));
		schedule();
	};

	/** Confirm that watched directories which reported something still exist. */
	const checkSelves = async () => {
		const batch = [...selfChecks].slice(0, limits.watchesPerStep);
		for (const rel of batch) selfChecks.delete(rel);
		const stats = await Promise.all(
			batch.map((rel) =>
				fs.lstat(abs(rel)).then(
					(stat) => ({ rel, stat, error: undefined }),
					(error: unknown) => ({ rel, stat: undefined, error }),
				),
			),
		);
		for (const { rel, stat, error } of stats) {
			if (signal.aborted) return;
			const entry = dirs.get(rel);
			if (entry === undefined || entry.dev === -1) continue;
			if (error !== undefined) {
				if (!isCode(error, 'ENOENT', 'ENOTDIR')) throw error;
			} else if (
				stat?.isDirectory() &&
				stat.dev === entry.dev &&
				stat.ino === entry.ino
			)
				continue;
			closeSubtree(rel);
			if (rel !== '') deliver(rel);
		}
	};

	const onWatcherTrouble = (
		rel: string,
		entry: WatchedDirectory,
		error: unknown,
	) => {
		// A replaced directory's old watcher closing is not about the new one.
		if (signal.aborted || entry.closing || dirs.get(rel) !== entry) return;
		// Removal is confirmed by the path being gone; anything else means this
		// part of the tree stopped observing, and the whole watch fails.
		fs.lstat(abs(rel)).then(
			(stat) => {
				if (signal.aborted || dirs.get(rel) !== entry) return;
				if (
					stat.isDirectory() &&
					stat.dev === entry.dev &&
					stat.ino === entry.ino
				)
					fail(
						error ??
							new TreeWatchError('EWATCHCLOSED', 'a directory watch stopped'),
					);
				else {
					closeSubtree(rel);
					deliver(rel);
				}
			},
			(statError) => {
				if (signal.aborted || dirs.get(rel) !== entry) return;
				if (isCode(statError, 'ENOENT', 'ENOTDIR')) {
					closeSubtree(rel);
					if (rel !== '') deliver(rel);
				} else fail(statError);
			},
		);
	};

	/** Classify up to one budget of changed entries (design Decision 2). */
	const classify = async () => {
		const batch = [...events].slice(0, limits.watchesPerStep);
		for (const rel of batch) events.delete(rel);
		const stats = await Promise.all(
			batch.map((rel) =>
				fs.lstat(abs(rel)).then(
					(stat) => ({ rel, stat, error: undefined }),
					(error: unknown) => ({ rel, stat: undefined, error }),
				),
			),
		);
		for (const { rel, stat, error } of stats) {
			if (signal.aborted) return;
			const parent = dirs.get(parentOf(rel));
			const name = nameOf(rel);
			const watched = dirs.get(rel);
			if (watched !== undefined) {
				if (error !== undefined) {
					if (!isCode(error, 'ENOENT', 'ENOTDIR')) throw error;
					closeSubtree(rel);
				} else if (
					!stat?.isDirectory() ||
					stat.dev !== watched.dev ||
					stat.ino !== watched.ino
				) {
					// Replaced at the same path: what we watch is not what is there.
					closeSubtree(rel);
					if (stat?.isDirectory())
						candidates.set(rel, { kind: 'new', deliver: false });
				}
				deliver(rel);
				continue;
			}
			// The parent closed in the meantime, or excluded this name since.
			if (parent === undefined || parent.excluded.has(name)) continue;
			if (error !== undefined) {
				if (!isCode(error, 'ENOENT', 'ENOTDIR')) throw error;
				deliver(rel);
				continue;
			}
			if (!stat?.isDirectory() || name === '.git') {
				deliver(rel);
				continue;
			}
			const pending = candidates.get(rel);
			if (pending === undefined && !arms.has(rel))
				candidates.set(rel, { kind: 'new', deliver: true });
			else if (pending?.kind === 'new') pending.deliver = true;
		}
	};

	/** Ask the filter about one batch of candidates. */
	const filter = async () => {
		const batch: [string, CandidateOrigin][] = [];
		for (const [rel, origin] of candidates) {
			if (batch.length >= limits.filterBatch) break;
			batch.push([rel, origin]);
		}
		for (const [rel] of batch) candidates.delete(rel);
		const live = batch.filter(([rel]) => dirs.has(parentOf(rel)));
		if (live.length === 0) return;
		const asked = generation;
		const paths = live.map(([rel]) => rel);
		const kept =
			options.filterDirectories === undefined
				? paths
				: await options.filterDirectories(paths, signal);
		if (signal.aborted) return;
		if (asked !== generation) {
			// The rules changed while Git was answering: ask again.
			for (const [rel, origin] of live)
				if (!candidates.has(rel)) candidates.set(rel, origin);
			return;
		}
		const keep = new Set(kept);
		for (const path of keep)
			if (!paths.includes(path))
				throw new TreeWatchError(
					'EFILTER',
					'the directory filter returned a path it was not asked about',
				);
		for (const [rel, origin] of live) {
			const parent = dirs.get(parentOf(rel));
			if (parent === undefined) continue;
			const name = nameOf(rel);
			if (keep.has(rel)) {
				if (origin.kind === 'watched') continue;
				parent.excluded.delete(name);
				if (!dirs.has(rel)) arms.set(rel, settled);
				if (origin.kind === 'excluded' || origin.deliver) deliver(rel);
			} else {
				parent.excluded.add(name);
				if (origin.kind === 'watched') {
					closeSubtree(rel);
					deliver(rel);
				}
			}
		}
	};

	/** Open the watches the filter kept: arm first, then list (Decision 1). */
	const arm = async () => {
		const batch: [string, boolean][] = [];
		for (const entry of arms) {
			if (batch.length >= limits.watchesPerStep) break;
			batch.push(entry);
		}
		const opened: [string, WatchedDirectory, boolean][] = [];
		for (const [rel, report] of batch) {
			arms.delete(rel);
			if (signal.aborted) return;
			if (dirs.has(rel)) continue;
			if (rel !== '' && !dirs.has(parentOf(rel))) continue;
			if (dirs.size >= limits.maxDirectories)
				throw new TreeWatchError(
					'ETOOMANYDIRS',
					`more than ${limits.maxDirectories} directories to watch`,
				);
			let watcher: FSWatcher;
			try {
				watcher = fs.watch(abs(rel), { persistent: false }, (_event, name) =>
					onWatchEvent(rel, name),
				);
			} catch (error) {
				// Gone before it could be watched: its parent's event covers it.
				if (rel !== '' && isCode(error, 'ENOENT', 'ENOTDIR')) continue;
				throw error;
			}
			const entry: WatchedDirectory = {
				watcher,
				dev: -1,
				ino: -1,
				excluded: new Set(),
				closing: false,
			};
			watcher.on('error', (error) => onWatcherTrouble(rel, entry, error));
			watcher.on('close', () => onWatcherTrouble(rel, entry, undefined));
			dirs.set(rel, entry);
			opened.push([rel, entry, report]);
		}
		const stats = await Promise.all(
			opened.map(([rel]) =>
				fs.lstat(abs(rel)).then(
					(stat) => ({ stat, error: undefined }),
					(error: unknown) => ({ stat: undefined, error }),
				),
			),
		);
		for (const [index, [rel, entry, report]] of opened.entries()) {
			if (signal.aborted) return;
			if (dirs.get(rel) !== entry) continue;
			const { stat, error } = stats[index] ?? {};
			if (error !== undefined || !stat?.isDirectory()) {
				if (error !== undefined && !isCode(error, 'ENOENT', 'ENOTDIR'))
					throw error;
				closeSubtree(rel);
				continue;
			}
			entry.dev = stat.dev;
			entry.ino = stat.ino;
			lists.push({ rel, report });
		}
	};

	/** Read up to one budget of entries from armed directories. */
	const list = async () => {
		let budget = limits.entriesPerStep;
		while (budget > 0 && !signal.aborted) {
			if (listing === undefined) {
				const next = lists.shift();
				if (next === undefined) return;
				if (!dirs.has(next.rel)) continue;
				let dir: Dir;
				try {
					dir = await fs.opendir(abs(next.rel), { bufferSize: 64 });
				} catch (error) {
					if (!isCode(error, 'ENOENT', 'ENOTDIR')) throw error;
					if (dirs.has(next.rel)) {
						closeSubtree(next.rel);
						if (next.rel !== '') deliver(next.rel);
					}
					continue;
				}
				if (signal.aborted) {
					await dir.close().catch(() => undefined);
					return;
				}
				listing = {
					rel: next.rel,
					dir,
					children: [],
					sawGit: false,
					report: next.report,
				};
			}
			const current = listing;
			const entry = await current.dir.read();
			if (listing !== current) return;
			if (entry === null) {
				listing = undefined;
				await current.dir.close().catch(() => undefined);
				finishListing(current);
				continue;
			}
			budget--;
			if (entry.name === '.git') {
				current.sawGit = true;
				continue;
			}
			if (entry.isDirectory()) current.children.push(entry.name);
		}
	};

	const finishListing = (finished: Listing) => {
		const watched = dirs.get(finished.rel);
		if (watched === undefined) return;
		if (finished.sawGit && finished.rel !== '') {
			// A nested repository (submodule or similar) is its own boundary.
			closeSubtree(finished.rel);
			dirs.get(parentOf(finished.rel))?.excluded.add(nameOf(finished.rel));
			return;
		}
		for (const name of finished.children) {
			if (watched.excluded.has(name)) continue;
			const rel = finished.rel === '' ? name : join(finished.rel, name);
			if (dirs.has(rel) || arms.has(rel) || candidates.has(rel)) continue;
			candidates.set(rel, { kind: 'new', deliver: false });
		}
		// Anything written between this directory's creation and its arm.
		if (finished.report) deliver(finished.rel);
	};

	const step = async () => {
		if (selfChecks.size > 0) await checkSelves();
		if (signal.aborted) return;
		if (events.size > 0) await classify();
		if (signal.aborted) return;
		if (candidates.size > 0) await filter();
		if (signal.aborted) return;
		if (arms.size > 0) await arm();
		if (signal.aborted) return;
		await list();
	};

	arms.set('', false);
	schedule();

	return {
		close() {
			if (done) return;
			done = true;
			controller.abort();
			closeAll();
		},
		refilter(kind) {
			if (signal.aborted) return;
			generation++;
			for (const [rel, entry] of dirs) {
				for (const name of entry.excluded) {
					const child = rel === '' ? name : join(rel, name);
					if (!candidates.has(child))
						candidates.set(child, { kind: 'excluded' });
				}
				if (kind === 'rules' && rel !== '' && !candidates.has(rel))
					candidates.set(rel, { kind: 'watched' });
			}
			schedule();
		},
	};
}
