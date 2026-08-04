import type { FileCatalogEntry, FileViewerClient } from '@terminay/client-core';
import { useEffect, useState } from 'react';

type FolderState =
	| Readonly<{ status: 'loading' }>
	| Readonly<{ status: 'unavailable'; message: string }>
	| Readonly<{ status: 'failed'; message: string }>
	| Readonly<{
			status: 'ready' | 'empty';
			entries: readonly FileCatalogEntry[];
			truncated: boolean;
	  }>;

export interface SharedFolderRouteBodyProps {
	readonly client?: FileViewerClient;
	readonly projectId?: string;
	readonly loading?: boolean;
	readonly onOpenEntry?: (entry: FileCatalogEntry) => Promise<void> | void;
}

/** Project-scoped server catalog body shared by Desktop and browser hosts. */
export function SharedFolderRouteBody({
	client,
	projectId,
	loading = false,
	onOpenEntry,
}: SharedFolderRouteBodyProps) {
	const [attempt, setAttempt] = useState(0);
	const [selectedPath, setSelectedPath] = useState<string>();
	const [state, setState] = useState<FolderState>(() =>
		loading
			? { status: 'loading' }
			: {
					status: 'unavailable',
					message: 'Project files are unavailable for this connection.',
				},
	);

	useEffect(() => {
		if (loading) {
			setState({ status: 'loading' });
			return;
		}
		if (client === undefined || projectId === undefined) {
			setState({
				status: 'unavailable',
				message: 'Project files are unavailable for this connection.',
			});
			return;
		}
		let active = true;
		setState({ status: 'loading' });
		void client
			.listFolder('.', projectId)
			.then((page) => {
				if (!active) return;
				setState({
					status: page.entries.length === 0 ? 'empty' : 'ready',
					entries: page.entries,
					truncated: page.truncated,
				});
			})
			.catch((cause) => {
				if (active)
					setState({
						status: 'failed',
						message:
							cause instanceof Error
								? cause.message
								: 'Terminay could not load project files.',
					});
			});
		return () => {
			active = false;
		};
	}, [attempt, client, loading, projectId]);

	return (
		<main className="shared-production-route" data-shared-route-body="folder">
			<header>
				<h1>Project files</h1>
				<p>Server-owned files for the selected project.</p>
			</header>
			{state.status === 'loading' && (
				<p role="status" aria-busy="true">
					Loading project files…
				</p>
			)}
			{state.status === 'unavailable' && <p role="status">{state.message}</p>}
			{state.status === 'failed' && (
				<div role="alert">
					<p>{state.message}</p>
					<button
						type="button"
						onClick={() => setAttempt((value) => value + 1)}
					>
						Retry files
					</button>
				</div>
			)}
			{state.status === 'empty' && (
				<p role="status">This project folder is empty.</p>
			)}
			{state.status === 'ready' && (
				<>
					<div role="tree" aria-label="Project files">
						{state.entries.map((entry, index) => (
							<div
								key={entry.relativePath}
								role="treeitem"
								aria-selected={selectedPath === entry.relativePath}
								tabIndex={index === 0 ? 0 : -1}
								className="shared-production-route__card"
								onClick={() => {
									if (!entry.accessible) return;
									setSelectedPath(entry.relativePath);
									void onOpenEntry?.(entry);
								}}
								onKeyDown={(event) => {
									if (event.key !== 'Enter' && event.key !== ' ') return;
									event.preventDefault();
									if (!entry.accessible) return;
									setSelectedPath(entry.relativePath);
									void onOpenEntry?.(entry);
								}}
							>
								<strong>{entry.name}</strong>
								<span>
									{entry.kind === 'directory'
										? 'Folder'
										: entry.kind === 'file'
											? `${entry.size} bytes`
											: entry.kind}
								</span>
								{!entry.accessible && <span>Unavailable</span>}
							</div>
						))}
					</div>
					{state.truncated && (
						<p role="status">
							Additional files were omitted by the server limit.
						</p>
					)}
				</>
			)}
		</main>
	);
}
