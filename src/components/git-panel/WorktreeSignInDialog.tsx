import { KeyRound, X } from 'lucide-react';
import { type JSX, useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { openExternalUrl } from '../../host/nativeActions';
import type { WorktreeSignInPrompt } from '../../types/terminay';

export type WorktreeSignInChoice = 'accept' | 'later' | 'never';

export type WorktreeSignInDialogProps = {
	prompt: WorktreeSignInPrompt;
	onRespond: (choice: WorktreeSignInChoice, token?: string) => Promise<void>;
};

/**
 * Terminay's prompt for a forge credential an extension asked for. The
 * extension supplies only the provider, origin, and token page; the token goes
 * to the server vault and never to the extension's own storage.
 */
export function WorktreeSignInDialog({
	prompt,
	onRespond,
}: WorktreeSignInDialogProps): JSX.Element {
	const titleId = useId();
	const tokenId = useId();
	const [step, setStep] = useState<'ask' | 'token'>('ask');
	const [token, setToken] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const host = new URL(prompt.origin).host;

	const respond = async (choice: WorktreeSignInChoice, value?: string) => {
		setBusy(true);
		setError(null);
		try {
			await onRespond(choice, value);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
			setBusy(false);
		}
	};

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape' && !busy) {
				event.preventDefault();
				void respond('later');
			}
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	});

	return createPortal(
		<div className="project-edit-modal-backdrop">
			<div
				className="project-edit-modal worktree-sign-in-dialog"
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				data-terminay-worktree-sign-in="true"
			>
				<div className="project-edit-modal-titlebar">
					<h2 id={titleId} className="project-edit-modal-title">
						<KeyRound size={14} aria-hidden="true" />
						{prompt.provider} detected
					</h2>
					<button
						type="button"
						className="project-edit-modal-close"
						disabled={busy}
						onClick={() => void respond('later')}
						aria-label="Close, ask again later"
						title="Close"
					>
						<X size={12} aria-hidden="true" />
					</button>
				</div>
				{step === 'ask' ? (
					<p className="worktree-sign-in-dialog__text">
						We have detected this project is a {prompt.provider} project ({host}
						) that we support showing more detailed information in the sidebar.
						We need to authenticate you.
					</p>
				) : (
					<form
						className="worktree-sign-in-dialog__form"
						onSubmit={(event) => {
							event.preventDefault();
							if (token.trim().length > 0) void respond('accept', token.trim());
						}}
					>
						<label htmlFor={tokenId} className="worktree-sign-in-dialog__label">
							{prompt.provider} access token for {host}
						</label>
						<input
							id={tokenId}
							type="password"
							autoComplete="off"
							spellCheck={false}
							autoFocus
							value={token}
							disabled={busy}
							onChange={(event) => setToken(event.target.value)}
						/>
						<p className="worktree-sign-in-dialog__hint">
							A token with read access to repositories is enough. It is stored
							in this server's vault.
							{prompt.tokenPageUrl === undefined ? null : (
								<>
									{' '}
									<button
										type="button"
										className="worktree-sign-in-dialog__link"
										onClick={() =>
											void openExternalUrl(prompt.tokenPageUrl as string)
										}
									>
										Create a token
									</button>
								</>
							)}
						</p>
					</form>
				)}
				{error ? (
					<div className="worktree-sign-in-dialog__error" role="alert">
						{error}
					</div>
				) : null}
				<div className="project-edit-actions">
					{step === 'ask' ? (
						<>
							<button
								type="button"
								disabled={busy}
								onClick={() => void respond('never')}
							>
								Don't ask me about {prompt.provider} again
							</button>
							<button
								type="button"
								disabled={busy}
								onClick={() => void respond('later')}
							>
								No, maybe later
							</button>
							<button
								type="button"
								className="worktree-sign-in-dialog__primary"
								disabled={busy}
								onClick={() => setStep('token')}
							>
								Yes
							</button>
						</>
					) : (
						<>
							<button
								type="button"
								disabled={busy}
								onClick={() => setStep('ask')}
							>
								Back
							</button>
							<button
								type="button"
								className="worktree-sign-in-dialog__primary"
								disabled={busy || token.trim().length === 0}
								onClick={() => void respond('accept', token.trim())}
							>
								{busy ? 'Saving…' : 'Save token'}
							</button>
						</>
					)}
				</div>
			</div>
		</div>,
		document.body,
	);
}
