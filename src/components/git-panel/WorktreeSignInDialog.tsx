import { KeyRound } from 'lucide-react';
import { type JSX, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { openExternalUrl } from '../../host/nativeActions';
import { InPageWindow } from '../../shared/inPageWindow/InPageWindow';
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

	return createPortal(
		<InPageWindow
			busy={busy}
			icon={<KeyRound size={14} />}
			kind={{ resizable: false, width: 420 }}
			name="worktree-sign-in"
			title={`${prompt.provider} detected`}
			onClose={() => void respond('later')}
		>
			<div
				className="project-edit-modal worktree-sign-in-dialog"
				data-terminay-worktree-sign-in="true"
			>
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
		</InPageWindow>,
		document.body,
	);
}
