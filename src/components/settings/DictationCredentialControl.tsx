import type { TerminayAiClient } from '@terminay/client-core';
import { useEffect, useState } from 'react';

/** The provider is explicit so a Settings switch cannot retarget a secret. */
export function DictationCredentialControl({
	client,
}: {
	client: TerminayAiClient | undefined;
}) {
	const [configured, setConfigured] = useState(false);
	const [draft, setDraft] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		let current = true;
		setDraft('');
		setConfigured(false);
		setError(null);
		void client
			?.dictationCredentialStatus({ provider: 'openai-compatible' })
			.then((status) => {
				if (current) setConfigured(status.configured);
			})
			.catch(() => {
				if (current) setError('Unable to read API key status.');
			});
		return () => {
			current = false;
		};
	}, [client]);
	const mutate = async (clear: boolean) => {
		if (client === undefined) {
			setError('Dictation credentials are unavailable on this server.');
			return;
		}
		setBusy(true);
		setError(null);
		try {
			const status = clear
				? await client.clearDictationCredential({
						provider: 'openai-compatible',
					})
				: await client.setDictationCredential(draft, {
						provider: 'openai-compatible',
					});
			setConfigured(status.configured);
			setDraft('');
		} catch {
			setError('Unable to save the custom API key. Check the server vault.');
		} finally {
			setBusy(false);
		}
	};
	return (
		<div className="settings-shortcut-editor settings-shortcut-editor--dictation">
			<div className="settings-shortcut-value">
				<input
					aria-label="Custom transcription API key"
					className="settings-input-text"
					type="password"
					autoComplete="off"
					spellCheck={false}
					value={draft}
					placeholder={configured ? 'API key saved' : 'Optional Bearer API key'}
					disabled={busy}
					onChange={(event) => setDraft(event.target.value)}
				/>
				<span
					className={`settings-shortcut-chip${configured ? '' : ' settings-shortcut-chip--muted'}`}
				>
					{configured ? 'Configured' : 'Not set'}
				</span>
			</div>
			{error ? (
				<span role="alert" className="settings-shortcut-warning">
					{error}
				</span>
			) : null}
			<div className="settings-shortcut-actions">
				<button
					type="button"
					className="settings-secondary-button settings-secondary-button--small"
					disabled={busy || !draft.trim() || client === undefined}
					onClick={() => void mutate(false)}
				>
					{busy ? 'Saving' : 'Save Key'}
				</button>
				<button
					type="button"
					className="settings-secondary-button settings-secondary-button--small"
					disabled={busy || !configured || client === undefined}
					onClick={() => void mutate(true)}
				>
					Clear
				</button>
			</div>
		</div>
	);
}

/** Invalid or secret-bearing URLs remain local drafts, never server settings. */
export function TranscriptionEndpointControl({
	value,
	save,
}: {
	value: string;
	save: (value: string) => Promise<void>;
}) {
	const [draft, setDraft] = useState(value);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		setDraft(value);
	}, [value]);
	const commit = async () => {
		const trimmed = draft.trim();
		if (trimmed) {
			try {
				const url = new URL(trimmed);
				if (
					trimmed.length > 2048 ||
					!['http:', 'https:'].includes(url.protocol) ||
					url.username ||
					url.password ||
					url.search ||
					url.hash
				)
					throw new Error();
			} catch {
				setError(
					'Use a full HTTP(S) URL without credentials, query parameters or a fragment.',
				);
				return;
			}
		}
		setError(null);
		if (trimmed !== value) await save(trimmed);
	};
	return (
		<div className="settings-input-text-validated">
			<input
				aria-label="Transcription URL"
				className="settings-input-text"
				type="text"
				value={draft}
				placeholder="https://pop-os:2345/sherpaonnx/v1/audio/transcriptions"
				aria-invalid={error !== null || undefined}
				onChange={(event) => {
					setDraft(event.target.value);
					setError(null);
				}}
				onBlur={() => void commit()}
				onKeyDown={(event) => {
					if (event.key === 'Enter') void commit();
				}}
			/>
			{error ? (
				<p className="settings-field-error" role="alert">
					{error}
				</p>
			) : null}
		</div>
	);
}
