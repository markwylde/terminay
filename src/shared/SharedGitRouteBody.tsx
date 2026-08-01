import type {
	GitWorktreeReference,
	TerminayGitClient,
} from '@terminay/client-core';
import type { JsonValue } from '@terminay/protocol';
import { useEffect, useState } from 'react';

type GitState =
	| Readonly<{ status: 'loading' }>
	| Readonly<{ status: 'empty' | 'unavailable' | 'failed'; message: string }>
	| Readonly<{
			status: 'ready';
			worktrees: readonly Worktree[];
			bounded: boolean;
	  }>;

interface Worktree extends GitWorktreeReference {
	readonly branch?: string;
	readonly head?: string | null;
	readonly state: string;
	readonly changes: number;
	readonly main: boolean;
}

interface QuickPushProposal {
	readonly proposalId: string;
	readonly revision: JsonValue;
	readonly actionDigest: string;
	readonly targetBranch: string;
	readonly actions: readonly JsonValue[];
}

export interface SharedGitRouteBodyProps {
	readonly gitClient?: TerminayGitClient;
	readonly projectId?: string;
	readonly capabilityAvailable: boolean;
	readonly quickPushProvider?: string;
}

/** Server-driven Git/worktree actions; paths and provider credentials never enter this body. */
export function SharedGitRouteBody({
	gitClient,
	projectId,
	capabilityAvailable,
	quickPushProvider = 'codex',
}: SharedGitRouteBodyProps) {
	const [attempt, setAttempt] = useState(0);
	const [state, setState] = useState<GitState>(() =>
		capabilityAvailable
			? { status: 'loading' }
			: {
					status: 'unavailable',
					message: 'Git is unavailable on this server.',
				},
	);
	const [busy, setBusy] = useState<string>();
	const [actionMessage, setActionMessage] = useState<string>();
	const [actionError, setActionError] = useState<string>();
	const [removeCandidate, setRemoveCandidate] = useState<Worktree>();
	const [renameCandidate, setRenameCandidate] = useState<Worktree>();
	const [renameValue, setRenameValue] = useState('');
	const [proposal, setProposal] = useState<QuickPushProposal>();

	useEffect(() => {
		if (!capabilityAvailable) {
			setState({
				status: 'unavailable',
				message: 'Git is unavailable on this server.',
			});
			return;
		}
		if (gitClient === undefined || projectId === undefined) {
			setState({
				status: 'empty',
				message: 'Select a server project to view Git status.',
			});
			return;
		}
		let active = true;
		setState({ status: 'loading' });
		void gitClient
			.list({ projectId })
			.then((value) => {
				if (!active) return;
				const parsed = parseWorktreeList(value, projectId);
				setState(
					parsed.worktrees.length === 0
						? {
								status: 'empty',
								message: 'No Git worktrees were found for this project.',
							}
						: { status: 'ready', ...parsed },
				);
			})
			.catch((cause) => {
				if (active)
					setState({
						status: 'failed',
						message: errorMessage(
							cause,
							'Terminay could not load Git worktrees.',
						),
					});
			});
		return () => {
			active = false;
		};
	}, [attempt, capabilityAvailable, gitClient, projectId]);

	const run = async (
		key: string,
		operation: () => Promise<JsonValue>,
		success: string,
	) => {
		setBusy(key);
		setActionError(undefined);
		setActionMessage(undefined);
		try {
			await operation();
			setActionMessage(success);
			setAttempt((value) => value + 1);
		} catch (cause) {
			setActionError(errorMessage(cause, 'The Git action failed.'));
		} finally {
			setBusy(undefined);
		}
	};

	const proposeQuickPush = async (worktree: Worktree) => {
		if (gitClient === undefined) return;
		setBusy(`quick-push:${worktree.worktreeId}`);
		setActionError(undefined);
		setProposal(undefined);
		try {
			const value = await gitClient.proposeQuickPush({
				projectId: worktree.projectId,
				repositoryId: worktree.repositoryId,
				worktreeId: worktree.worktreeId,
				provider: quickPushProvider,
				...(worktree.branch === undefined
					? {}
					: { targetBranch: worktree.branch }),
			});
			setProposal(parseProposal(value));
		} catch (cause) {
			setActionError(
				errorMessage(cause, 'Terminay could not prepare Quick Push.'),
			);
		} finally {
			setBusy(undefined);
		}
	};

	const approveQuickPush = async () => {
		if (gitClient === undefined || proposal === undefined) return;
		const current = proposal;
		setBusy('quick-push-approve');
		setActionError(undefined);
		try {
			await gitClient.approveQuickPush(current);
			setProposal(undefined);
			setActionMessage('Quick Push completed.');
			setAttempt((value) => value + 1);
		} catch (cause) {
			setActionError(errorMessage(cause, 'Quick Push approval failed.'));
		} finally {
			setBusy(undefined);
		}
	};

	return (
		<main className="shared-production-route" data-shared-route-body="git">
			<header>
				<h1>Git worktrees</h1>
				<p>
					Server-owned repository status and reviewed actions for the selected
					project.
				</p>
			</header>
			{state.status === 'loading' && (
				<p role="status" aria-busy="true">
					Loading Git worktrees…
				</p>
			)}
			{(state.status === 'empty' || state.status === 'unavailable') && (
				<p role="status">{state.message}</p>
			)}
			{state.status === 'failed' && (
				<div role="alert">
					<p>{state.message}</p>
					<button
						type="button"
						onClick={() => setAttempt((value) => value + 1)}
					>
						Retry Git worktrees
					</button>
				</div>
			)}
			{state.status === 'ready' && (
				<>
					<ul aria-label="Git worktrees">
						{state.worktrees.map((worktree) => {
							const key = `${worktree.repositoryId}:${worktree.worktreeId}`;
							return (
								<li className="shared-production-route__card" key={key}>
									<strong>
										{worktree.branch ?? 'Detached worktree'}
										{worktree.main ? ' — main' : ''}
									</strong>
									<span>
										{worktree.state}; {worktree.changes} changed files
									</span>
									<button
										disabled={busy !== undefined}
										type="button"
										onClick={() =>
											void run(
												`pull:${key}`,
												() => gitClient!.pull(worktree),
												'Worktree updated.',
											)
										}
									>
										Pull
									</button>
									<button
										disabled={busy !== undefined}
										type="button"
										onClick={() => void proposeQuickPush(worktree)}
									>
										Prepare Quick Push
									</button>
									<button
										disabled={busy !== undefined}
										type="button"
										onClick={() => {
											setRenameCandidate(worktree);
											setRenameValue(worktree.branch ?? '');
										}}
									>
										Rename presentation
									</button>
									<button
										disabled={busy !== undefined || worktree.main}
										type="button"
										onClick={() => setRemoveCandidate(worktree)}
									>
										Remove worktree
									</button>
									{gitClient?.host.has('nativeWindows') === true && (
										<>
											<button
												disabled={busy !== undefined}
												type="button"
												onClick={() =>
													void run(
														`open:${key}`,
														() => gitClient.openTerminal(worktree),
														'Terminal opened.',
													)
												}
											>
												Open terminal
											</button>
											<button
												disabled={busy !== undefined}
												type="button"
												onClick={() =>
													void run(
														`switch:${key}`,
														() => gitClient.switchProject(worktree),
														'Project switched.',
													)
												}
											>
												Switch project
											</button>
											<button
												disabled={busy !== undefined}
												type="button"
												onClick={() =>
													void run(
														`reveal:${key}`,
														() => gitClient.reveal(worktree),
														'Worktree revealed.',
													)
												}
											>
												Reveal worktree
											</button>
										</>
									)}
									{gitClient?.host.has('clipboard') === true && (
										<button
											disabled={busy !== undefined}
											type="button"
											onClick={() =>
												void run(
													`copy:${key}`,
													() => gitClient.copy(worktree),
													'Worktree path copied.',
												)
											}
										>
											Copy worktree path
										</button>
									)}
								</li>
							);
						})}
					</ul>
					{state.bounded && (
						<p role="status">
							Additional worktrees were omitted by the server limit.
						</p>
					)}
				</>
			)}
			{busy !== undefined && (
				<p role="status" aria-busy="true">
					Applying Git action…
				</p>
			)}
			{actionMessage !== undefined && <p role="status">{actionMessage}</p>}
			{actionError !== undefined && <p role="alert">{actionError}</p>}
			{removeCandidate !== undefined && (
				<section
					aria-label="Confirm worktree removal"
					className="shared-production-route__card"
				>
					<strong>
						Remove {removeCandidate.branch ?? 'detached worktree'}?
					</strong>
					<p>This server action cannot be undone from Terminay.</p>
					<button
						disabled={busy !== undefined}
						type="button"
						onClick={() => {
							const candidate = removeCandidate;
							setRemoveCandidate(undefined);
							void run(
								`remove:${candidate.worktreeId}`,
								() => gitClient!.remove(candidate, candidate.head),
								'Worktree removed.',
							);
						}}
					>
						Confirm removal
					</button>
					<button type="button" onClick={() => setRemoveCandidate(undefined)}>
						Cancel
					</button>
				</section>
			)}
			{renameCandidate !== undefined && (
				<form
					aria-label="Rename worktree presentation"
					onSubmit={(event) => {
						event.preventDefault();
						const candidate = renameCandidate;
						setRenameCandidate(undefined);
						void run(
							`rename:${candidate.worktreeId}`,
							() => gitClient!.renamePresentation(candidate, renameValue),
							'Worktree presentation renamed.',
						);
					}}
				>
					<label>
						Presentation name
						<input
							value={renameValue}
							onChange={(event) => setRenameValue(event.target.value)}
						/>
					</label>
					<button type="submit">Save presentation name</button>
					<button type="button" onClick={() => setRenameCandidate(undefined)}>
						Cancel
					</button>
				</form>
			)}
			{proposal !== undefined && (
				<section
					aria-label="Quick Push confirmation"
					className="shared-production-route__card"
				>
					<strong>Review Quick Push to {proposal.targetBranch}</strong>
					<span>{proposal.actions.length} server-planned actions</span>
					<button
						disabled={busy !== undefined}
						type="button"
						onClick={() => void approveQuickPush()}
					>
						Approve Quick Push
					</button>
					<button type="button" onClick={() => setProposal(undefined)}>
						Cancel
					</button>
				</section>
			)}
		</main>
	);
}

function parseWorktreeList(
	value: JsonValue,
	projectId: string,
): { worktrees: readonly Worktree[]; bounded: boolean } {
	if (!isRecord(value) || !Array.isArray(value.worktrees))
		throw new Error('The server returned an incompatible Git worktree list.');
	return {
		bounded: value.bounded === true,
		worktrees: value.worktrees.map((candidate) => {
			if (
				!isRecord(candidate) ||
				typeof candidate.id !== 'string' ||
				typeof candidate.repositoryId !== 'string'
			) {
				throw new Error('The server returned an incompatible Git worktree.');
			}
			return {
				projectId,
				repositoryId: candidate.repositoryId,
				worktreeId: candidate.id,
				...(typeof candidate.branch === 'string'
					? { branch: candidate.branch }
					: {}),
				head:
					typeof candidate.head === 'string' || candidate.head === null
						? candidate.head
						: undefined,
				state:
					typeof candidate.state === 'string' ? candidate.state : 'unknown',
				changes: Array.isArray(candidate.entries)
					? candidate.entries.length
					: 0,
				main: candidate.isMain === true,
			};
		}),
	};
}

function parseProposal(value: JsonValue): QuickPushProposal {
	if (
		!isRecord(value) ||
		typeof value.proposalId !== 'string' ||
		typeof value.actionDigest !== 'string' ||
		typeof value.targetBranch !== 'string' ||
		!isRecord(value.revision) ||
		!Array.isArray(value.actions)
	)
		throw new Error('The server returned an incompatible Quick Push proposal.');
	return {
		proposalId: value.proposalId,
		revision: value.revision,
		actionDigest: value.actionDigest,
		targetBranch: value.targetBranch,
		actions: value.actions,
	};
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(cause: unknown, fallback: string): string {
	return cause instanceof Error ? cause.message : fallback;
}
