import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { JSX } from 'react';
import { Check, Plug, X } from 'lucide-react';
import type {
	McpAgentId,
	McpAgentInstallState,
	McpInstallStatus,
} from '../types/terminay';
import './mcpInstallModal.css';

export interface McpInstallModalProps {
	open: boolean;
	onClose: () => void;
}

export function McpInstallModal({
	open,
	onClose,
}: McpInstallModalProps): JSX.Element | null {
	const titleId = useId();
	const [status, setStatus] = useState<McpInstallStatus | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [busyAgent, setBusyAgent] = useState<McpAgentId | null>(null);
	const [rowErrors, setRowErrors] = useState<Partial<Record<McpAgentId, string>>>(
		{},
	);
	const pointerStartedOnBackdropRef = useRef(false);

	const refreshStatus = useCallback(async () => {
		setIsLoading(true);
		setLoadError(null);
		try {
			const nextStatus = await window.terminay.getMcpInstallStatus();
			setStatus(nextStatus);
		} catch (error) {
			setLoadError(
				error instanceof Error ? error.message : 'Failed to load MCP status.',
			);
		} finally {
			setIsLoading(false);
		}
	}, []);

	useEffect(() => {
		if (!open) {
			return;
		}

		let isMounted = true;

		setIsLoading(true);
		setLoadError(null);
		void window.terminay
			.getMcpInstallStatus()
			.then((nextStatus) => {
				if (!isMounted) {
					return;
				}
				setStatus(nextStatus);
			})
			.catch((error: unknown) => {
				if (!isMounted) {
					return;
				}
				setLoadError(
					error instanceof Error ? error.message : 'Failed to load MCP status.',
				);
			})
			.finally(() => {
				if (!isMounted) {
					return;
				}
				setIsLoading(false);
			});

		return () => {
			isMounted = false;
		};
	}, [open]);

	useEffect(() => {
		if (!open) {
			return;
		}

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				onClose();
			}
		};

		window.addEventListener('keydown', onKeyDown);
		return () => {
			window.removeEventListener('keydown', onKeyDown);
		};
	}, [open, onClose]);

	const runAction = useCallback(
		async (agent: McpAgentId, installed: boolean) => {
			if (busyAgent) {
				return;
			}

			setBusyAgent(agent);
			setRowErrors((previous) => {
				if (!previous[agent]) {
					return previous;
				}
				const { [agent]: _removed, ...rest } = previous;
				return rest;
			});

			try {
				const result = installed
					? await window.terminay.uninstallMcpAgent(agent)
					: await window.terminay.installMcpAgent(agent);

				if (!result.ok) {
					setRowErrors((previous) => ({
						...previous,
						[agent]: result.error ?? result.message ?? 'Something went wrong.',
					}));
				}

				setStatus((previous) => {
					if (!previous) {
						return previous;
					}
					return {
						...previous,
						agents: previous.agents.map((entry) =>
							entry.id === agent
								? { ...entry, installed: result.installed }
								: entry,
						),
					};
				});
			} catch (error) {
				setRowErrors((previous) => ({
					...previous,
					[agent]:
						error instanceof Error ? error.message : 'Something went wrong.',
				}));
				await refreshStatus();
			} finally {
				setBusyAgent(null);
			}
		},
		[busyAgent, refreshStatus],
	);

	if (!open) {
		return null;
	}

	return (
		<div
			className="project-edit-modal-backdrop"
			onMouseDown={(event) => {
				pointerStartedOnBackdropRef.current =
					event.target === event.currentTarget;
			}}
			onMouseUp={(event) => {
				const shouldClose =
					pointerStartedOnBackdropRef.current &&
					event.target === event.currentTarget;
				pointerStartedOnBackdropRef.current = false;
				if (shouldClose) {
					onClose();
				}
			}}
		>
			<div
				className="project-edit-modal project-edit-modal--wide mcp-install-modal"
				onClick={(event) => event.stopPropagation()}
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
			>
				<div className="project-edit-modal-titlebar">
					<h2 id={titleId} className="project-edit-modal-title">
						<Plug size={14} aria-hidden="true" className="mcp-install-title-icon" />
						Install Terminay MCP
					</h2>
					<button
						type="button"
						className="project-edit-modal-close"
						onClick={onClose}
						aria-label="Close Install Terminay MCP"
						title="Close"
					>
						<X size={12} aria-hidden="true" />
					</button>
				</div>

				<p className="mcp-install-description">
					Let AI agents (Claude Code, Codex) running in a Terminay terminal control
					the tabs in this window.
				</p>

				{loadError ? (
					<div className="mcp-install-load-error">{loadError}</div>
				) : null}

				{isLoading && !status ? (
					<div className="mcp-install-loading">Loading agents…</div>
				) : null}

				{status ? (
					<ul className="mcp-install-list">
						{status.agents.map((agent) => (
							<McpAgentRow
								key={agent.id}
								agent={agent}
								busy={busyAgent === agent.id}
								disabled={busyAgent !== null && busyAgent !== agent.id}
								error={rowErrors[agent.id]}
								onAction={() => void runAction(agent.id, agent.installed)}
							/>
						))}
					</ul>
				) : null}

				<div className="project-edit-actions">
					<button type="button" onClick={onClose}>
						Close
					</button>
				</div>
			</div>
		</div>
	);
}

interface McpAgentRowProps {
	agent: McpAgentInstallState;
	busy: boolean;
	disabled: boolean;
	error: string | undefined;
	onAction: () => void;
}

function McpAgentRow({
	agent,
	busy,
	disabled,
	error,
	onAction,
}: McpAgentRowProps): JSX.Element {
	const actionLabel = agent.installed ? 'Uninstall' : 'Install';

	return (
		<li className="mcp-install-row">
			<div className="mcp-install-row-main">
				<span
					className={`mcp-install-status-icon${agent.installed ? ' mcp-install-status-icon--installed' : ''}`}
					aria-hidden="true"
				>
					{agent.installed ? <Check size={14} /> : null}
				</span>
				<div className="mcp-install-row-copy">
					<span className="mcp-install-row-label">{agent.label}</span>
					<span className="mcp-install-row-state">
						{agent.installed ? 'Installed' : 'Not installed'}
					</span>
					<span className="mcp-install-row-path" title={agent.configPath}>
						{agent.configPath}
					</span>
					{error ? <span className="mcp-install-row-error">{error}</span> : null}
				</div>
			</div>
			<button
				type="button"
				className={`mcp-install-action${agent.installed ? ' mcp-install-action--uninstall' : ''}`}
				onClick={onAction}
				disabled={busy || disabled}
			>
				{busy ? 'Working…' : actionLabel}
			</button>
		</li>
	);
}
