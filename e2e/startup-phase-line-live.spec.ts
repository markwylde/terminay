import { expect, test } from './fixtures';

/** Samples the real startup window while the real app boots, to prove the line
 * actually advances rather than sticking on one phase. */
test('the live splash advances through more than one phase', async ({
	electronApp,
}) => {
	const seen = await electronApp.evaluate(async ({ BrowserWindow }) => {
		const observed: string[] = [];
		const deadline = Date.now() + 12_000;
		while (Date.now() < deadline) {
			const [window] = BrowserWindow.getAllWindows();
			if (window && !window.isDestroyed()) {
				try {
					const lines: string[] = await window.webContents.executeJavaScript(
						`[...document.querySelectorAll('.phase')]
               .filter((n) => getComputedStyle(n).display !== 'none')
               .map((n) => n.textContent)`,
					);
					if (lines.length === 1 && observed.at(-1) !== lines[0]) {
						observed.push(lines[0]);
					}
					if (lines.length > 1) observed.push(`OVERLAP:${lines.join('|')}`);
				} catch {
					// The document is gone once the workspace bundle takes the window.
					break;
				}
			}
			await new Promise((resolve) => setTimeout(resolve, 40));
		}
		return observed;
	});

	// Never more than one line at once, and never stuck on one phase. Both of
	// those shipped as bugs, and neither was visible to a unit test.
	expect(seen.filter((line) => line.startsWith('OVERLAP:'))).toEqual([]);
	expect(
		seen.length,
		`expected the line to advance, saw: ${JSON.stringify(seen)}`,
	).toBeGreaterThan(1);
});
