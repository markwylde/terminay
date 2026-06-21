import { useEffect, useId, useState } from 'react';
import type { JSX } from 'react';
import {
	AlertTriangle,
	Check,
	ChevronDown,
	ChevronRight,
	ExternalLink,
	GitCommit,
	X,
	Zap,
} from 'lucide-react';
import type {
	AiTabMetadataProvider,
	QuickPushAction,
	QuickPushApplyResult,
	QuickPushPlan,
} from '../types/terminay';
import './quickPushModal.css';

export interface QuickPushModalProps {
	action: QuickPushAction;
	provider: AiTabMetadataProvider;
	model: string;
	cwd: string;
	onClose: () => void;
}

type Phase = 'generating' | 'review' | 'applying' | 'done' | 'error';

const ACTION_LABELS: Record<QuickPushAction, string> = {
	current: 'Push to current branch',
	'current-pr': 'Push to current branch + PR',
	new: 'Push to new branch',
	'new-pr': 'Push to new branch + PR',
};

export function QuickPushModal({
	action,
	provider,
	model,
	cwd,
	onClose,
}: QuickPushModalProps): JSX.Element {
	const titleId = useId();
	const [phase, setPhase] = useState<Phase>('generating');
	const [plan, setPlan] = useState<QuickPushPlan | null>(null);
	const [result, setResult] = useState<QuickPushApplyResult | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [expanded, setExpanded] = useState<Set<number>>(new Set());

	useEffect(() => {
		let isMounted = true;

		void window.terminay
			.generateQuickPushPlan({ provider, model, action, cwd })
			.then((nextPlan) => {
				if (!isMounted) {
					return;
				}
				setPlan(nextPlan);
				setPhase('review');
			})
			.catch((generateError: unknown) => {
				if (!isMounted) {
					return;
				}
				setError(
					generateError instanceof Error
						? generateError.message
						: 'Failed to generate a commit plan.',
				);
				setPhase('error');
			});

		return () => {
			isMounted = false;
		};
	}, [action, provider, model, cwd]);

	const toggleExpanded = (index: number) => {
		setExpanded((previous) => {
			const next = new Set(previous);
			if (next.has(index)) {
				next.delete(index);
			} else {
				next.add(index);
			}
			return next;
		});
	};

	const approve = () => {
		if (!plan || plan.commits.length === 0) {
			return;
		}

		setPhase('applying');
		void window.terminay
			.applyQuickPush({
				cwd,
				action,
				branchName: plan.branchName,
				pullRequest: plan.pullRequest,
				commits: plan.commits,
			})
			.then((applyResult) => {
				setResult(applyResult);
				setPhase('done');
			})
			.catch((applyError: unknown) => {
				setError(
					applyError instanceof Error
						? applyError.message
						: 'Failed to apply the commit plan.',
				);
				setPhase('error');
			});
	};

	const canClose = phase !== 'applying';

	return (
		<div className="project-edit-modal-backdrop">
			<div
				className="project-edit-modal project-edit-modal--wide quick-push-modal"
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
			>
				<div className="project-edit-modal-titlebar">
					<h2 id={titleId} className="project-edit-modal-title">
						<Zap size={14} aria-hidden="true" className="quick-push-title-icon" />
						Quick Push
						<span className="quick-push-subtitle">{ACTION_LABELS[action]}</span>
					</h2>
					<button
						type="button"
						className="project-edit-modal-close"
						onClick={onClose}
						disabled={!canClose}
						aria-label="Close Quick Push"
						title="Close"
					>
						<X size={12} aria-hidden="true" />
					</button>
				</div>

				{phase === 'generating' ? (
					<div className="quick-push-status">
						<span className="quick-push-spinner" aria-hidden="true" />
						<span>Generating commit messages…</span>
					</div>
				) : null}

				{phase === 'error' ? (
					<div className="quick-push-error">
						<AlertTriangle size={16} aria-hidden="true" />
						<span>{error}</span>
					</div>
				) : null}

				{phase === 'review' && plan ? (
					<QuickPushReview plan={plan} expanded={expanded} onToggle={toggleExpanded} />
				) : null}

				{phase === 'applying' ? (
					<div className="quick-push-status">
						<span className="quick-push-spinner" aria-hidden="true" />
						<span>Committing &amp; pushing…</span>
					</div>
				) : null}

				{phase === 'done' && result ? <QuickPushResult result={result} /> : null}

				<div className="project-edit-actions">
					{phase === 'review' ? (
						<>
							<button type="button" onClick={onClose}>
								Cancel
							</button>
							<button
								type="button"
								className="quick-push-approve"
								onClick={approve}
								disabled={!plan || plan.commits.length === 0}
							>
								Approve &amp; push
							</button>
						</>
					) : (
						<button type="button" onClick={onClose} disabled={!canClose}>
							{phase === 'done' ? 'Done' : 'Close'}
						</button>
					)}
				</div>
			</div>
		</div>
	);
}

interface QuickPushReviewProps {
	plan: QuickPushPlan;
	expanded: Set<number>;
	onToggle: (index: number) => void;
}

function QuickPushReview({ plan, expanded, onToggle }: QuickPushReviewProps): JSX.Element {
	return (
		<div className="quick-push-review">
			{plan.branchName ? (
				<div className="quick-push-meta">
					<span className="quick-push-meta-label">New branch</span>
					<code className="quick-push-meta-value">{plan.branchName}</code>
				</div>
			) : null}

			{plan.commits.length === 0 ? (
				<div className="quick-push-empty">The AI did not propose any commits.</div>
			) : (
				<ul className="quick-push-commits">
					{plan.commits.map((commit, index) => {
						const isOpen = expanded.has(index);
						return (
							<li key={`${commit.message}-${index}`} className="quick-push-commit">
								<button
									type="button"
									className="quick-push-commit-header"
									onClick={() => onToggle(index)}
									aria-expanded={isOpen}
								>
									{isOpen ? (
										<ChevronDown size={14} aria-hidden="true" />
									) : (
										<ChevronRight size={14} aria-hidden="true" />
									)}
									<GitCommit size={14} aria-hidden="true" className="quick-push-commit-icon" />
									<span className="quick-push-commit-message">{commit.message}</span>
									<span className="quick-push-commit-count">
										{commit.files.length} {commit.files.length === 1 ? 'file' : 'files'}
									</span>
								</button>
								{isOpen ? (
									<ul className="quick-push-files">
										{commit.files.map((file) => (
											<li key={file} className="quick-push-file">
												{file}
											</li>
										))}
									</ul>
								) : null}
							</li>
						);
					})}
				</ul>
			)}

			{plan.pullRequest ? (
				<div className="quick-push-pr">
					<span className="quick-push-meta-label">Pull request</span>
					<span className="quick-push-pr-title">{plan.pullRequest.title}</span>
					{plan.pullRequest.body ? (
						<pre className="quick-push-pr-body">{plan.pullRequest.body}</pre>
					) : null}
				</div>
			) : null}

			{plan.uncoveredFiles.length > 0 ? (
				<div className="quick-push-warning">
					<AlertTriangle size={14} aria-hidden="true" />
					<div>
						<strong>
							{plan.uncoveredFiles.length} changed{' '}
							{plan.uncoveredFiles.length === 1 ? 'file' : 'files'} won't be committed:
						</strong>
						<div className="quick-push-warning-files">{plan.uncoveredFiles.join(', ')}</div>
					</div>
				</div>
			) : null}

			{plan.warnings.length > 0 ? (
				<ul className="quick-push-notes">
					{plan.warnings.map((warning) => (
						<li key={warning}>{warning}</li>
					))}
				</ul>
			) : null}
		</div>
	);
}

function QuickPushResult({ result }: { result: QuickPushApplyResult }): JSX.Element {
	return (
		<div className="quick-push-review">
			<ul className="quick-push-steps">
				{result.steps.map((step, index) => (
					<li
						key={`${step.label}-${index}`}
						className={`quick-push-step${step.ok ? '' : ' quick-push-step--failed'}`}
					>
						<span className="quick-push-step-icon" aria-hidden="true">
							{step.ok ? <Check size={14} /> : <X size={14} />}
						</span>
						<div className="quick-push-step-copy">
							<span className="quick-push-step-label">{step.label}</span>
							{step.output ? (
								<pre className="quick-push-step-output">{step.output}</pre>
							) : null}
						</div>
					</li>
				))}
			</ul>

			{result.error ? (
				<div className="quick-push-error">
					<AlertTriangle size={16} aria-hidden="true" />
					<span>{result.error}</span>
				</div>
			) : null}

			{result.pullRequestUrl ? (
				<button
					type="button"
					className="quick-push-pr-link"
					onClick={() => void window.terminay.openExternal(result.pullRequestUrl as string)}
				>
					<ExternalLink size={14} aria-hidden="true" />
					{result.pullRequestUrlLabel ?? 'View pull request'}
				</button>
			) : result.ok && result.pushed ? (
				<div className="quick-push-success">
					<Check size={16} aria-hidden="true" />
					<span>Pushed{result.branch ? ` to ${result.branch}` : ''}.</span>
				</div>
			) : null}
		</div>
	);
}
