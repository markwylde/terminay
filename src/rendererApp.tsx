import { type ComponentType, useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';

const RUNTIME_TIMEOUT_MS = 15_000;
const TERMINAY_LOGO_PATH = '/terminay.svg';
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
			.catch(() => {
				if (!active) return;
				window.clearTimeout(timeout);
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
	ReactDOM.createRoot(root).render(<RuntimeBoundary />);
}
