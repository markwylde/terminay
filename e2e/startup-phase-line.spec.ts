import {
	STARTUP_PHASE_IDS,
	startupPhaseLabel,
} from '../electron/diagnostics/startupTimeline';
import {
	desktopStartupLoadingDocument,
	startupPhaseVisibilityCss,
} from '../electron/startupLoadingDocument';
import { expect, test } from './fixtures';

/** Exercises the real mechanism: Electron's `insertCSS` injects an *injected
 * author* stylesheet, which Blink orders differently against the document's own
 * <style> than an ordinary appended <style> element does. A Playwright
 * `addStyleTag` therefore cannot stand in for this. */
test('each inserted phase rule wins over the document and its predecessors', async ({
	electronApp,
}) => {
	const steps = ['workspace-restore', 'server-compose', 'native-menu'] as const;
	const input = {
		document: desktopStartupLoadingDocument(),
		rules: steps.map((id) => startupPhaseVisibilityCss(id)),
	};

	const seen = await electronApp.evaluate(
		async ({ BrowserWindow }, { document, rules }) => {
			const window = new BrowserWindow({
				show: false,
				webPreferences: { sandbox: true, contextIsolation: true },
			});
			await window.loadURL(document);

			const readVisible = (): Promise<string[]> =>
				window.webContents.executeJavaScript(
					`[...document.querySelectorAll('.phase')]
             .filter((node) => getComputedStyle(node).display !== 'none')
             .map((node) => node.textContent)`,
				);

			const observed: string[][] = [await readVisible()];
			for (const rule of rules) {
				await window.webContents.insertCSS(rule);
				observed.push(await readVisible());
			}
			window.destroy();
			return observed;
		},
		input,
	);

	// No rule is removed between steps, so this is the worst case the serialized
	// removal in main is allowed to fall behind into: the newest rule must still
	// win, both over the document's own <style> and over its predecessors.
	// Nothing is revealed until main inserts the first rule.
	expect(seen[0]).toEqual([]);
	expect(seen[1]).toEqual(['Restoring your workspace']);
	expect(seen[2]).toEqual(['Starting the local server']);
	expect(seen[3]).toEqual(['Building menus']);
});

test('the whole startup sequence advances one line at a time', async ({
	electronApp,
}) => {
	const ids = [...STARTUP_PHASE_IDS];
	const input = {
		document: desktopStartupLoadingDocument(),
		rules: ids.map((id) => startupPhaseVisibilityCss(id)),
	};

	const seen = await electronApp.evaluate(
		async ({ BrowserWindow }, { document, rules }) => {
			const window = new BrowserWindow({
				show: false,
				webPreferences: { sandbox: true, contextIsolation: true },
			});
			await window.loadURL(document);
			const observed: string[][] = [];
			for (const rule of rules) {
				await window.webContents.insertCSS(rule);
				observed.push(
					await window.webContents.executeJavaScript(
						`[...document.querySelectorAll('.phase')]
               .filter((node) => getComputedStyle(node).display !== 'none')
               .map((node) => node.textContent)`,
					),
				);
			}
			window.destroy();
			return observed;
		},
		input,
	);

	expect(seen).toHaveLength(ids.length);
	for (const [index, id] of ids.entries()) {
		expect(seen[index], `phase ${id} shows exactly its own line`).toEqual([
			startupPhaseLabel(id),
		]);
	}
});
