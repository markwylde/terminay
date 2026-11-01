/**
 * Profile › Sign-in: every bot signs in with its own credential. That is the
 * agent's device sign-in (run inside the bot's container), or one of the
 * agent's declared tokens or API keys.
 *
 * No secret ever comes back from the server; a saved token shows only as
 * saved. The typed value lives in a password field until it is sent, and the
 * client zeroes the bytes after sending.
 */

import type { BotCredentialClient } from '@terminay/client-core';
import type { BotProfile, BotSignIn } from '@terminay/protocol';
import { useCallback, useEffect, useState } from 'react';
import { BotShellView } from './BotShellView';
import {
	type BotAgentOption,
	refusalText,
	type ServerBots,
} from './useServerBots';

export type SignInToken = Readonly<{
	variable: string;
	kind: string;
	label: string;
	help: string;
	configured: boolean;
}>;

export type SignInDevice = Readonly<{
	label: string;
	help: string;
	signedIn: boolean;
}>;

export type SignInOptions = Readonly<{
	device: SignInDevice | null;
	tokens: readonly SignInToken[];
}>;

export function parseSignInOptions(value: unknown): SignInOptions | undefined {
	if (typeof value !== 'object' || value === null) return undefined;
	const r = value as Record<string, unknown>;
	const d = r.device as Record<string, unknown> | null | undefined;
	return {
		device:
			d && typeof d === 'object' && typeof d.label === 'string'
				? {
						label: d.label,
						help: typeof d.help === 'string' ? d.help : '',
						signedIn: d.signedIn === true,
					}
				: null,
		tokens: Array.isArray(r.tokens)
			? r.tokens.flatMap((t) => {
					if (typeof t !== 'object' || t === null) return [];
					const o = t as Record<string, unknown>;
					if (typeof o.variable !== 'string') return [];
					return [
						{
							variable: o.variable,
							kind: String(o.kind ?? ''),
							label: typeof o.label === 'string' ? o.label : o.variable,
							help: typeof o.help === 'string' ? o.help : '',
							configured: o.configured === true,
						},
					];
				})
			: [],
	};
}

export const TOKEN_READABLE_NOTE =
	'The agent and the tools it runs can read this token.';
export const REDACTION_NOTE =
	'Terminay hides saved token values in transcripts and runner output, but cannot hide a token the agent rotates or a value the agent transforms.';

export function signInLabel(
	signIn: BotSignIn,
	options: SignInOptions | undefined,
): string {
	if (signIn.kind === 'device')
		return options?.device?.label ?? 'Device sign-in';
	if (signIn.kind === 'token')
		return (
			options?.tokens.find((t) => t.variable === signIn.environmentVariable)
				?.label ?? signIn.environmentVariable
		);
	return 'Not signed in';
}

export function BotSignInSection({
	server,
	bot,
	agent,
	credentials,
	onSignInChange,
}: Readonly<{
	server: ServerBots;
	bot: BotProfile;
	agent: BotAgentOption | undefined;
	credentials: BotCredentialClient;
	onSignInChange: (signIn: BotSignIn) => Promise<void>;
}>) {
	const [options, setOptions] = useState<SignInOptions>();
	const [error, setError] = useState<string>();
	const [busy, setBusy] = useState(false);
	const [signingIn, setSigningIn] = useState(false);

	const load = useCallback(() => {
		credentials
			.options(bot.id)
			.then((value) => {
				setOptions(parseSignInOptions(value));
				setError(undefined);
			})
			.catch((cause: unknown) => setError(refusalText(cause)));
	}, [credentials, bot.id]);

	useEffect(load, [load, bot.agentId, bot.updatedAt]);

	const act = (work: () => Promise<unknown>) => {
		setBusy(true);
		setError(undefined);
		work()
			.then(load)
			.catch((cause: unknown) => setError(refusalText(cause)))
			.finally(() => setBusy(false));
	};

	const otherBots = server.bots.filter(
		(b) => b.id !== bot.id && b.agentId === bot.agentId,
	);
	const device = options?.device ?? null;

	return (
		<section className="bots-signin" data-terminay-bot-signin={bot.signIn.kind}>
			<h3 className="bots-lab">Sign-in</h3>
			<p className="bots-faint">
				{bot.signIn.kind === 'none' ? (
					<>
						{agent?.displayName ?? bot.agentId} is <b>not signed in</b>. Choose
						one way below.
					</>
				) : (
					<>
						{agent?.displayName ?? bot.agentId} signs in with{' '}
						<b>{signInLabel(bot.signIn, options)}</b>. Changes apply to sessions
						that start after them.
					</>
				)}
			</p>
			{error ? <p className="bots-need">{error}</p> : null}
			{options === undefined ? (
				<p className="bots-faint">Loading sign-in options…</p>
			) : (
				<div
					className="bots-signin__options"
					role="radiogroup"
					aria-label="Sign-in"
				>
					{device ? (
						<div
							className="bots-card bots-signin__opt"
							data-terminay-bot-device={
								device.signedIn ? 'signed-in' : 'signed-out'
							}
						>
							<label className="bots-check">
								<input
									type="radio"
									name={`signin-${bot.id}`}
									checked={bot.signIn.kind === 'device'}
									disabled={busy || !device.signedIn}
									onChange={() => act(() => onSignInChange({ kind: 'device' }))}
									data-terminay-bot-signin-option="device"
								/>
								<b>{device.label}</b>
								<span className="bots-tag">
									{device.signedIn ? 'Signed in on this bot' : 'Not signed in'}
								</span>
							</label>
							{device.help ? (
								<span className="bots-faint">{device.help}</span>
							) : null}
							{signingIn ? (
								<div
									className="bots-signin__term"
									data-terminay-bot-device-terminal="true"
								>
									<BotShellView
										server={server}
										bot={bot}
										visible
										purpose="sign-in"
										onEnded={load}
									/>
									<div className="bots-token-row">
										<button
											type="button"
											className="bots-btn bots-btn--sm"
											onClick={() => {
												setSigningIn(false);
												load();
											}}
										>
											Close
										</button>
									</div>
								</div>
							) : (
								<div className="bots-token-row">
									<button
										type="button"
										className={`bots-btn bots-btn--sm${device.signedIn ? '' : ' bots-btn--primary'}`}
										disabled={busy}
										onClick={() => setSigningIn(true)}
										data-terminay-bot-device-start="true"
									>
										{device.signedIn ? 'Sign in again' : device.label}
									</button>
									{device.signedIn ? (
										<button
											type="button"
											className="bots-btn bots-btn--sm bots-btn--danger"
											disabled={busy}
											onClick={() =>
												act(() => credentials.deviceSignOut(bot.id))
											}
											data-terminay-bot-device-signout="true"
										>
											Sign out
										</button>
									) : null}
								</div>
							)}
						</div>
					) : null}
					{options.tokens.map((token) => (
						<TokenOption
							key={token.variable}
							bot={bot}
							token={token}
							chosen={
								bot.signIn.kind === 'token' &&
								bot.signIn.environmentVariable === token.variable
							}
							busy={busy}
							otherBots={otherBots}
							onChoose={() =>
								act(() =>
									onSignInChange({
										kind: 'token',
										environmentVariable: token.variable,
									}),
								)
							}
							onSave={(value) =>
								act(async () => {
									await credentials.save(
										bot.id,
										token.variable,
										new TextEncoder().encode(value),
									);
									// A bot with no sign-in uses the token it was just given.
									if (bot.signIn.kind === 'none')
										await onSignInChange({
											kind: 'token',
											environmentVariable: token.variable,
										});
								})
							}
							onCopy={(sourceBotId) =>
								act(() => credentials.copy(sourceBotId, bot.id, token.variable))
							}
							onRemove={() =>
								act(() => credentials.remove(bot.id, token.variable))
							}
						/>
					))}
					{device === null && options.tokens.length === 0 ? (
						<p className="bots-faint">This agent declares no way to sign in.</p>
					) : null}
					{options.tokens.length > 0 ? (
						<p className="bots-faint">{REDACTION_NOTE}</p>
					) : null}
				</div>
			)}
		</section>
	);
}

function TokenOption({
	bot,
	token,
	chosen,
	busy,
	otherBots,
	onChoose,
	onSave,
	onCopy,
	onRemove,
}: Readonly<{
	bot: BotProfile;
	token: SignInToken;
	chosen: boolean;
	busy: boolean;
	otherBots: readonly BotProfile[];
	onChoose: () => void;
	onSave: (value: string) => void;
	onCopy: (sourceBotId: string) => void;
	onRemove: () => void;
}>) {
	const [value, setValue] = useState('');
	const [replacing, setReplacing] = useState(false);
	const [source, setSource] = useState('');
	const editing = !token.configured || replacing;
	return (
		<div
			className="bots-card bots-signin__opt"
			data-terminay-bot-token={token.variable}
			data-terminay-bot-token-configured={token.configured}
		>
			<label className="bots-check">
				<input
					type="radio"
					name={`signin-${bot.id}`}
					checked={chosen}
					disabled={busy}
					onChange={onChoose}
					data-terminay-bot-signin-option={token.variable}
				/>
				<b>{token.label}</b>
				<span className="bots-tag">
					{token.configured ? 'Saved' : 'Not set'}
				</span>
			</label>
			{token.help ? <span className="bots-faint">{token.help}</span> : null}
			<span className="bots-faint">{TOKEN_READABLE_NOTE}</span>
			{editing ? (
				<form
					className="bots-token-row"
					onSubmit={(event) => {
						event.preventDefault();
						if (value.length === 0) return;
						onSave(value);
						setValue('');
						setReplacing(false);
					}}
				>
					<input
						type="password"
						className="bots-in"
						autoComplete="off"
						spellCheck={false}
						value={value}
						aria-label={token.label}
						placeholder={token.configured ? 'New value' : 'Paste the value'}
						onChange={(event) => setValue(event.target.value)}
						data-terminay-bot-token-input={token.variable}
					/>
					<button
						type="submit"
						className="bots-btn bots-btn--sm bots-btn--primary"
						disabled={busy || value.length === 0}
					>
						Save
					</button>
					{replacing ? (
						<button
							type="button"
							className="bots-btn bots-btn--sm"
							onClick={() => {
								setValue('');
								setReplacing(false);
							}}
						>
							Cancel
						</button>
					) : null}
				</form>
			) : (
				<div className="bots-token-row">
					<span className="bots-mono bots-faint" title="Saved value hidden">
						••••••••
					</span>
					<button
						type="button"
						className="bots-btn bots-btn--sm"
						onClick={() => setReplacing(true)}
					>
						Replace
					</button>
					<button
						type="button"
						className="bots-btn bots-btn--sm bots-btn--danger"
						disabled={busy}
						onClick={onRemove}
					>
						Remove
					</button>
				</div>
			)}
			{otherBots.length > 0 ? (
				<div className="bots-token-row">
					<select
						className="bots-in"
						aria-label="Copy from bot"
						value={source}
						onChange={(event) => setSource(event.target.value)}
					>
						<option value="">Copy from another bot…</option>
						{otherBots.map((other) => (
							<option key={other.id} value={other.id}>
								{other.name}
							</option>
						))}
					</select>
					<button
						type="button"
						className="bots-btn bots-btn--sm"
						disabled={busy || source === ''}
						onClick={() => {
							onCopy(source);
							setSource('');
						}}
					>
						Copy
					</button>
				</div>
			) : null}
		</div>
	);
}
