import {
	Component,
	type ComponentType,
	type ErrorInfo,
	type ReactNode,
	useEffect,
	useState,
} from 'react';
import ReactDOM from 'react-dom/client';
import type {
	RendererRootDiagnosticPayload,
	RendererRootDiagnosticPhase,
} from './types/desktopDiagnostics';

const RUNTIME_TIMEOUT_MS = 15_000;
const TERMINAY_LOGO_PATH = '/terminay.svg';
const DIAGNOSTIC_FIELD_BYTES = {
	componentStack: 3_072,
	message: 2_048,
	name: 128,
	stack: 6_144,
} as const;
const DIAGNOSTIC_TRUNCATION_MARKER = '[truncated]';
const MAX_DEDUPLICATION_ENTRIES = 64;
const reportedRootFailures = new Set<string>();
const AUXILIARY_VIEWS = new Set([
	'edit-tab',
	'settings',
	'macros',
	'recordings',
]);
const isAuxiliaryView = AUXILIARY_VIEWS.has(
	new URLSearchParams(window.location.search).get('view') ?? '',
);

function BootstrapStatusShell({
	message,
	failed = false,
}: {
	readonly message: string;
	readonly failed?: boolean;
}) {
	return (
		<main
			aria-busy={failed ? undefined : 'true'}
			className="terminay-server-connecting"
			role={failed ? 'alert' : 'status'}
		>
			<div className="terminay-server-connecting__content">
				<img
					alt=""
					aria-hidden="true"
					className="terminay-server-connecting__logo"
					src={TERMINAY_LOGO_PATH}
				/>
				<p className="terminay-server-connecting__text">{message}</p>
			</div>
		</main>
	);
}

function truncateUtf8(value: string, maxBytes: number): string {
	const encoder = new TextEncoder();
	if (encoder.encode(value).byteLength <= maxBytes) return value;

	const markerBytes = encoder.encode(DIAGNOSTIC_TRUNCATION_MARKER).byteLength;
	const contentBudget = Math.max(0, maxBytes - markerBytes);
	let lower = 0;
	let upper = Math.min(value.length, maxBytes);
	while (lower < upper) {
		const middle = Math.ceil((lower + upper) / 2);
		if (encoder.encode(value.slice(0, middle)).byteLength <= contentBudget) {
			lower = middle;
		} else {
			upper = middle - 1;
		}
	}
	return `${value.slice(0, lower)}${DIAGNOSTIC_TRUNCATION_MARKER}`;
}

function readErrorText(error: Error, key: 'message' | 'name'): string {
	try {
		const value = error[key];
		return typeof value === 'string' ? value : '';
	} catch {
		return '';
	}
}

function readErrorStack(error: Error): string | undefined {
	try {
		return typeof error.stack === 'string' ? error.stack : undefined;
	} catch {
		return undefined;
	}
}

function describeRootFailure(error: unknown): {
	name: string;
	message: string;
	stack?: string;
} {
	if (error instanceof Error) {
		return {
			message: readErrorText(error, 'message') || 'Application error',
			name: readErrorText(error, 'name') || 'Error',
			stack: readErrorStack(error),
		};
	}
	try {
		return {
			message:
				typeof error === 'string' ? error : 'A non-Error value was thrown',
			name: 'NonError',
		};
	} catch {
		return { message: 'A non-Error value was thrown', name: 'NonError' };
	}
}

function reportRootFailure(
	phase: RendererRootDiagnosticPhase,
	error: unknown,
	componentStack?: string,
): void {
	const described = describeRootFailure(error);
	const payload: RendererRootDiagnosticPayload = {
		version: 1,
		phase,
		name: truncateUtf8(described.name, DIAGNOSTIC_FIELD_BYTES.name),
		message: truncateUtf8(described.message, DIAGNOSTIC_FIELD_BYTES.message),
		...(described.stack === undefined
			? {}
			: { stack: truncateUtf8(described.stack, DIAGNOSTIC_FIELD_BYTES.stack) }),
		...(componentStack === undefined
			? {}
			: {
					componentStack: truncateUtf8(
						componentStack,
						DIAGNOSTIC_FIELD_BYTES.componentStack,
					),
				}),
	};
	const deduplicationKey = JSON.stringify([
		payload.phase,
		payload.name,
		payload.message,
		payload.stack,
		payload.componentStack,
	]);
	if (reportedRootFailures.has(deduplicationKey)) return;
	if (reportedRootFailures.size >= MAX_DEDUPLICATION_ENTRIES) {
		const oldestKey = reportedRootFailures.values().next().value;
		if (oldestKey !== undefined) reportedRootFailures.delete(oldestKey);
	}
	reportedRootFailures.add(deduplicationKey);
	try {
		window.terminayDiagnosticsHost?.reportRootError(payload);
	} catch {
		// Diagnostics must never replace the fixed root recovery UI with a failure.
	}
}

class RootErrorBoundary extends Component<
	{ readonly children: ReactNode },
	{ readonly failed: boolean }
> {
	public state = { failed: false };

	public static getDerivedStateFromError(): { failed: boolean } {
		return { failed: true };
	}

	public componentDidCatch(error: Error, info: ErrorInfo): void {
		reportRootFailure('react-root', error, info.componentStack ?? undefined);
	}

	public render(): ReactNode {
		if (this.state.failed) {
			return (
				<BootstrapStatusShell
					failed
					message="Terminay encountered an application error."
				/>
			);
		}
		return this.props.children;
	}
}

function RuntimeBoundary() {
	const [Entry, setEntry] = useState<ComponentType | null>(null);
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		let active = true;
		const timeout = window.setTimeout(() => {
			if (active) setFailed(true);
		}, RUNTIME_TIMEOUT_MS);
		void import('./rendererRuntime.tsx')
			.then((module) => {
				if (!active) return;
				window.clearTimeout(timeout);
				setEntry(() => module.RendererEntry);
			})
			.catch((error: unknown) => {
				if (!active) return;
				window.clearTimeout(timeout);
				reportRootFailure('bootstrap-import', error);
				setFailed(true);
			});
		return () => {
			active = false;
			window.clearTimeout(timeout);
		};
	}, []);

	if (failed) {
		return (
			<BootstrapStatusShell
				failed
				message="Terminay application modules could not be loaded."
			/>
		);
	}
	if (Entry === null) {
		if (isAuxiliaryView) return null;
		return <BootstrapStatusShell message="Loading Terminay…" />;
	}
	return <Entry />;
}

export function mountRendererApp(root: HTMLElement): void {
	ReactDOM.createRoot(root).render(
		<RootErrorBoundary>
			<RuntimeBoundary />
		</RootErrorBoundary>,
	);
}
