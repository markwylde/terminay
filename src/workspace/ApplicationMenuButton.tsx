import { Menu as MenuIcon } from 'lucide-react';
import { useState } from 'react';

/**
 * The title-bar button that opens the host's own application menu, for a
 * window with no menu row (Desktop on Windows). It sends only where the menu
 * should open. A host too old to open it answers false, and the button goes.
 */
export function ApplicationMenuButton({
	openApplicationMenu,
}: {
	openApplicationMenu: (point: { x: number; y: number }) => Promise<boolean>;
}) {
	const [isUnavailable, setIsUnavailable] = useState(false);
	if (isUnavailable) return null;
	return (
		<div className="project-tab-app-menu-box">
			<button
				type="button"
				className="project-tab-app-menu"
				aria-label="Application menu"
				aria-haspopup="menu"
				title="Menu (Alt)"
				onClick={(event) => {
					const bounds = event.currentTarget.getBoundingClientRect();
					void openApplicationMenu({
						x: Math.max(0, bounds.left),
						y: Math.max(0, bounds.bottom),
					}).then((opened) => {
						if (!opened) setIsUnavailable(true);
					});
				}}
			>
				<MenuIcon aria-hidden="true" size={15} strokeWidth={1.8} />
			</button>
		</div>
	);
}
