import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { InPageWindow } from '../../src/shared/inPageWindow/InPageWindow';

type Open = 'settings' | 'recordings' | 'about' | 'edit-tab' | null;

/** The real window frame around stand-in content, one opener per kind. */
function Harness() {
	const [open, setOpen] = useState<Open>(null);
	const [pairing, setPairing] = useState(false);
	const close = () => setOpen(null);
	return (
		<main>
			{(['settings', 'recordings', 'about', 'edit-tab'] as const).map((name) => (
				<button key={name} type="button" data-open={name} onClick={() => setOpen(name)}>
					{name}
				</button>
			))}
			<button type="button" data-workspace-control>
				workspace
			</button>
			{open === 'settings' || open === 'recordings' ? (
				<InPageWindow
					kind={{ resizable: true, id: open, defaultSize: { width: 900, height: 600 } }}
					name={open}
					title={open === 'settings' ? 'Settings' : 'Recordings'}
					onClose={close}
				>
					<div className="harness-content">
						<input aria-label="Search settings" />
						<select aria-label="Theme" defaultValue="dark">
							<option value="dark">Dark</option>
							<option value="light">Light</option>
						</select>
						<button type="button" data-open-pairing onClick={() => setPairing(true)}>
							Pair
						</button>
						{pairing ? (
							<InPageWindow
								kind={{ resizable: false, width: 400 }}
								name="remote-pairing"
								title="Pair Device"
								onClose={() => setPairing(false)}
							>
								<p className="harness-content">One-time pairing link</p>
							</InPageWindow>
						) : null}
					</div>
				</InPageWindow>
			) : null}
			{open === 'about' ? (
				<InPageWindow kind={{ resizable: false, width: 440 }} name="about" title="About Terminay" onClose={close}>
					<iframe
						className="harness-about"
						sandbox="allow-popups allow-popups-to-escape-sandbox"
						srcDoc="<body style='margin:0;background:#0d1117;color:#fff'>About</body>"
						title="About Terminay"
					/>
				</InPageWindow>
			) : null}
			{open === 'edit-tab' ? (
				<InPageWindow kind={{ resizable: false, width: 680 }} name="edit-tab" title="Edit Terminal Tab" onClose={close}>
					<form className="harness-content harness-tall">
						<input aria-label="Name" autoFocus defaultValue="Terminal 2" />
					</form>
				</InPageWindow>
			) : null}
		</main>
	);
}

createRoot(document.getElementById('root') as HTMLElement).render(<Harness />);
