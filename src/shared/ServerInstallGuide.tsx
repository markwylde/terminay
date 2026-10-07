import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { openExternalUrl, writeClipboardText } from '../host/nativeActions';
import {
	INSTALLATION_GUIDE_URL,
	MANUAL_INSTALL_URL,
	PUBLIC_HOST_PLACEHOLDER,
	serverInstallCommands,
} from './serverInstallCommands';
import './ServerInstallGuide.css';

type InstallOption = 'docker' | 'linux';

const OPTIONS: readonly Readonly<{
	id: InstallOption;
	label: string;
	hint: string;
}>[] = [
	{ id: 'docker', label: 'Docker', hint: 'macOS, Windows, Linux' },
	{ id: 'linux', label: 'Linux host', hint: 'systemd service' },
];

export interface ServerInstallGuideProps {
	/** The version of the client showing the guide, when its host supplies
	 * one. It only chooses which image the commands name. */
	readonly version?: string;
}

/** How to start a Terminay server, for a person who has no pairing link yet. */
export function ServerInstallGuide({ version }: ServerInstallGuideProps) {
	const headingId = useId();
	const [option, setOption] = useState<InstallOption>('docker');
	const optionRefs = useRef(new Map<InstallOption, HTMLButtonElement>());
	const commands = serverInstallCommands({ version });
	const selected = option === 'docker' ? commands.docker : commands.linux;

	const moveOption = (event: KeyboardEvent<HTMLButtonElement>) => {
		const step =
			event.key === 'ArrowRight' || event.key === 'ArrowDown'
				? 1
				: event.key === 'ArrowLeft' || event.key === 'ArrowUp'
					? -1
					: 0;
		if (step === 0) return;
		event.preventDefault();
		const index = OPTIONS.findIndex((candidate) => candidate.id === option);
		const next = OPTIONS[(index + step + OPTIONS.length) % OPTIONS.length];
		if (next === undefined) return;
		setOption(next.id);
		optionRefs.current.get(next.id)?.focus();
	};

	return (
		<section className="server-install-guide" aria-labelledby={headingId}>
			<h3 id={headingId}>Don't have a server yet?</h3>
			<p className="server-install-guide__lede">
				Start one on the machine you want to reach, then paste the link it
				prints into the field above.
			</p>
			<div
				className="server-install-guide__options"
				role="radiogroup"
				aria-label="Where to run the server"
			>
				{OPTIONS.map((candidate) => (
					// biome-ignore lint/a11y/useSemanticElements: a segmented control; native radios cannot carry the two-line label.
					<button
						key={candidate.id}
						ref={(element) => {
							if (element === null) optionRefs.current.delete(candidate.id);
							else optionRefs.current.set(candidate.id, element);
						}}
						type="button"
						role="radio"
						aria-checked={candidate.id === option}
						tabIndex={candidate.id === option ? 0 : -1}
						className="server-install-guide__option"
						onClick={() => setOption(candidate.id)}
						onKeyDown={moveOption}
					>
						<span className="server-install-guide__option-label">
							{candidate.label}
						</span>
						<span className="server-install-guide__option-hint">
							{candidate.hint}
						</span>
					</button>
				))}
			</div>
			<ol className="server-install-guide__steps">
				<li>
					<span className="server-install-guide__step-title">
						Start the server
					</span>
					<InstallCommand label="Start the server" command={selected.start} />
				</li>
				<li>
					<span className="server-install-guide__step-title">
						Print its pairing link
					</span>
					<InstallCommand
						label="Print its pairing link"
						command={selected.pair}
					/>
				</li>
			</ol>
			<details className="server-install-guide__more">
				<summary>More options</summary>
				<div className="server-install-guide__more-body">
					<div>
						<span className="server-install-guide__step-title">
							Docker, for browsers and phones
						</span>
						<InstallCommand
							label="Docker, for browsers and phones"
							command={commands.dockerPublic}
						/>
						<p className="server-install-guide__note">
							Replace <code>{PUBLIC_HOST_PLACEHOLDER}</code> with the address
							other devices use for this machine.
						</p>
					</div>
					<div>
						<span className="server-install-guide__step-title">
							Docker on a Linux host, with host networking
						</span>
						<InstallCommand
							label="Docker on a Linux host, with host networking"
							command={commands.dockerHostNetwork}
						/>
					</div>
					<p className="server-install-guide__note">
						Not using Docker or systemd?{' '}
						<ExternalLink href={MANUAL_INSTALL_URL}>
							Install from the release archive
						</ExternalLink>
						.
					</p>
				</div>
			</details>
			<p className="server-install-guide__guide-link">
				<ExternalLink href={INSTALLATION_GUIDE_URL}>
					Installation guide
				</ExternalLink>
			</p>
		</section>
	);
}

function InstallCommand({
	command,
	label,
}: Readonly<{ command: string; label: string }>) {
	const [copied, setCopied] = useState(false);
	const [failed, setFailed] = useState(false);
	const reset = useRef<ReturnType<typeof setTimeout>>(undefined);
	useEffect(() => () => clearTimeout(reset.current), []);
	// A different command under the same control has not been copied.
	useEffect(() => {
		clearTimeout(reset.current);
		setCopied(false);
		setFailed(false);
	}, [command]);

	const copy = () => {
		clearTimeout(reset.current);
		void writeClipboardText(command).then(
			() => {
				setFailed(false);
				setCopied(true);
				reset.current = setTimeout(() => setCopied(false), 2000);
			},
			() => {
				setCopied(false);
				setFailed(true);
			},
		);
	};

	return (
		<div className="server-install-guide__command">
			<code>{command}</code>
			<button
				type="button"
				className="server-install-guide__copy"
				aria-label={`Copy command: ${label}`}
				onClick={copy}
			>
				{copied ? 'Copied' : 'Copy'}
			</button>
			<span className="server-install-guide__copy-status" role="status">
				{copied
					? 'Copied to the clipboard.'
					: failed
						? 'Could not copy. Select the command instead.'
						: ''}
			</span>
		</div>
	);
}

function ExternalLink({
	children,
	href,
}: Readonly<{ children: string; href: string }>) {
	return (
		<a
			href={href}
			target="_blank"
			rel="noreferrer"
			onClick={(event) => {
				event.preventDefault();
				void openExternalUrl(href);
			}}
		>
			{children}
		</a>
	);
}
