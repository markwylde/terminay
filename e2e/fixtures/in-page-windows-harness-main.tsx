import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { InPageWindow } from '../../src/shared/inPageWindow/InPageWindow';
import {
	SettingsListColumn,
	SettingsListSections,
	SharedSettingsRouteBody,
} from '../../src/shared/SharedSettingsRouteBody';
import '../../src/settings.css';

type Open = 'settings' | 'performance-log' | 'about' | 'edit-tab' | 'settings-columns' | null;

/** The Settings default size in the connected browser workspace. */
const SETTINGS_DEFAULT_SIZE = { width: 1480, height: 820 };

const ITEMS = ['Deploy', 'Update OS', 'Say hello'];

/** The real Settings shell with a collection category, for column geometry. */
function SettingsColumns() {
	const [selected, setSelected] = useState('Deploy');
	return (
		<SharedSettingsRouteBody
			query=""
			categories={[
				{ id: 'appearance', label: 'Appearance' },
				{ id: 'macros', label: 'Macros', count: ITEMS.length },
			]}
			activeCategoryId="macros"
			status="Saved"
			onQueryChange={() => undefined}
			onCategorySelect={() => undefined}
			listTitle="Macros"
			listColumn={
				<SettingsListColumn title="Macros">
					<SettingsListSections
						label="Macros"
						selectedId={selected}
						onSelect={setSelected}
						sections={[{ id: 'all', label: '', items: ITEMS.map((id) => ({ id, label: id, status: 'Saved' })) }]}
					/>
				</SettingsListColumn>
			}
			detailTitle={selected}
		>
			<p>{selected} script</p>
		</SharedSettingsRouteBody>
	);
}

/** The real window frame around stand-in content, one opener per kind. */
function Harness() {
	const [open, setOpen] = useState<Open>(null);
	const [pairing, setPairing] = useState(false);
	const close = () => setOpen(null);
	return (
		<main>
			{(['settings', 'performance-log', 'about', 'edit-tab', 'settings-columns'] as const).map((name) => (
				<button key={name} type="button" data-open={name} onClick={() => setOpen(name)}>
					{name}
				</button>
			))}
			<button type="button" data-workspace-control>
				workspace
			</button>
			{open === 'settings-columns' ? (
				<InPageWindow
					kind={{ resizable: true, id: 'settings', defaultSize: SETTINGS_DEFAULT_SIZE }}
					name="settings-columns"
					title="Settings"
					onClose={close}
				>
					<SettingsColumns />
				</InPageWindow>
			) : null}
			{open === 'settings' || open === 'performance-log' ? (
				<InPageWindow
					kind={{ resizable: true, id: open, defaultSize: { width: 900, height: 600 } }}
					name={open}
					title={open === 'settings' ? 'Settings' : 'Performance Log'}
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
