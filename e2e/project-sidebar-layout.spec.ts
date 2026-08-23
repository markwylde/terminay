import { expect, type Locator, type Page, test } from './fixtures';
import { openFileExplorer, setProjectRoot } from './support/ui';

type WorkspaceCommandRecord = Readonly<{
	operation: string;
	command?: Readonly<{
		type: string;
		projectId?: string;
		sidebar?: Readonly<Record<string, unknown>>;
	}>;
}>;

type WorkspaceTestApi = Readonly<{
	getCommandRecords: () => Promise<readonly WorkspaceCommandRecord[]>;
	resetCommandRecords: () => Promise<void>;
}>;

function activeSidebar(page: Page): Locator {
	return page.locator('.project-workspace--active [data-sidebar-panel-stack]');
}

function sidebarPane(page: Page, id: string): Locator {
	return activeSidebar(page).locator(`[data-sidebar-pane-id="${id}"]`);
}

function sidebarTitle(page: Page, id: string): Locator {
	return sidebarPane(page, id).locator('[data-sidebar-pane-title]');
}

function resizeHandle(page: Page, followingPaneId: string): Locator {
	return activeSidebar(page).locator(
		`[data-sidebar-resize-handle="${followingPaneId}"]`,
	);
}

async function requireWorkspaceTest(page: Page): Promise<void> {
	await page.evaluate(() => {
		const candidate = (
			window as Window & {
				terminayWorkspaceTest?: WorkspaceTestApi;
			}
		).terminayWorkspaceTest;
		if (!candidate) {
			throw new Error('Workspace command test seam is unavailable.');
		}
	});
}

async function expandPane(page: Page, id: string): Promise<void> {
	const pane = sidebarPane(page, id);
	if (
		await pane.evaluate((element) =>
			element.classList.contains('sidebar-pane--collapsed'),
		)
	) {
		await pane.locator('.sidebar-pane__header').click();
		await expect(pane).not.toHaveClass(/sidebar-pane--collapsed/);
	}
}

async function commandRecords(
	page: Page,
): Promise<readonly WorkspaceCommandRecord[]> {
	return await page.evaluate(async () => {
		const candidate = (
			window as Window & {
				terminayWorkspaceTest?: WorkspaceTestApi;
			}
		).terminayWorkspaceTest;
		if (!candidate)
			throw new Error('Workspace command test seam is unavailable.');
		return await candidate.getCommandRecords();
	});
}

async function resetCommandRecords(page: Page): Promise<void> {
	await page.evaluate(async () => {
		const candidate = (
			window as Window & {
				terminayWorkspaceTest?: WorkspaceTestApi;
			}
		).terminayWorkspaceTest;
		if (!candidate)
			throw new Error('Workspace command test seam is unavailable.');
		await candidate.resetCommandRecords();
	});
}

async function panelGeometry(page: Page, ids: readonly string[]) {
	return await page.evaluate(
		(paneIds) => {
			const stack = document.querySelector<HTMLElement>(
				'.project-workspace--active [data-sidebar-panel-stack]',
			);
			if (!stack) throw new Error('Sidebar panel stack is unavailable.');
			const rectangle = (element: Element | null) => {
				if (!element)
					throw new Error('Expected sidebar element is unavailable.');
				const rect = element.getBoundingClientRect();
				return { bottom: rect.bottom, height: rect.height, top: rect.top };
			};
			return {
				stack: {
					clientHeight: stack.clientHeight,
					scrollHeight: stack.scrollHeight,
					style: getComputedStyle(stack).overflowY,
					...rectangle(stack),
				},
				panes: Object.fromEntries(
					paneIds.map((id) => [
						id,
						{
							body: rectangle(
								document.querySelector(
									`.project-workspace--active [data-sidebar-pane-id="${id}"] .sidebar-pane__body`,
								),
							),
							title: rectangle(
								document.querySelector(
									`.project-workspace--active [data-sidebar-pane-id="${id}"] [data-sidebar-pane-title]`,
								),
							),
						},
					]),
				),
			};
		},
		[...ids],
	);
}

async function expectTitleSafePanelLayout(page: Page, ids: readonly string[]) {
	await expect
		.poll(async () => {
			const geometry = await panelGeometry(page, ids);
			return (
				geometry.stack.scrollHeight <= geometry.stack.clientHeight + 1 &&
				ids.every((id) => {
					const title = geometry.panes[id]?.title;
					return (
						title !== undefined &&
						title.top >= geometry.stack.top - 1 &&
						title.bottom <= geometry.stack.bottom + 1
					);
				})
			);
		})
		.toBe(true);
	return await panelGeometry(page, ids);
}

async function dragHandle(page: Page, followingPaneId: string, deltaY: number) {
	const handle = resizeHandle(page, followingPaneId);
	const box = await handle.boundingBox();
	if (!box)
		throw new Error(`Resize handle for ${followingPaneId} has no hit box.`);
	const x = box.x + box.width / 2;
	const y = box.y + box.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x, y + deltaY / 3);
	await page.mouse.move(x, y + (deltaY * 2) / 3);
	await page.mouse.move(x, y + deltaY);
	return { x, y };
}

type ResizeReleaseTrace = Readonly<{
	attempt: number;
	canonicalRevision: number;
	deltaY: number;
	followingPaneId: string;
	flushed: number;
	immediatelyAfterRelease: number;
	beforeRelease: number;
	start: number;
	afterCanonicalReconciliation: number;
}>;

async function animationFrames(page: Page, count: number): Promise<void> {
	await page.evaluate(async (frameCount) => {
		for (let index = 0; index < frameCount; index += 1) {
			await new Promise<void>((resolve) =>
				requestAnimationFrame(() => resolve()),
			);
		}
	}, count);
}

async function sidebarBoundaryOffset(
	page: Page,
	followingPaneId: string,
): Promise<number> {
	return await page.evaluate((paneId) => {
		const stack = document.querySelector<HTMLElement>(
			'.project-workspace--active [data-sidebar-panel-stack]',
		);
		const title = document.querySelector<HTMLElement>(
			`.project-workspace--active [data-sidebar-pane-id="${paneId}"] [data-sidebar-pane-title]`,
		);
		if (!stack || !title) {
			throw new Error(`Sidebar boundary for ${paneId} is unavailable.`);
		}
		return (
			title.getBoundingClientRect().top - stack.getBoundingClientRect().top
		);
	}, followingPaneId);
}

async function workspaceRevision(page: Page): Promise<number> {
	const revision = Number(
		await page
			.locator('.app-shell')
			.getAttribute('data-terminay-workspace-revision'),
	);
	if (!Number.isSafeInteger(revision) || revision < 1) {
		throw new Error(`Workspace revision is invalid: ${revision}.`);
	}
	return revision;
}

/**
 * This deliberately uses the real Electron input path. It records the exact
 * boundary the user sees across pointer release, React rendering, and the
 * server-owned snapshot that resolves the sidebar command. A resize that
 * visually springs back on mouse-up fails with its complete trace.
 */
async function dragAndTraceRelease(
	page: Page,
	attempt: number,
	followingPaneId: string,
	deltaY: number,
	expectedCommitCount: number,
): Promise<ResizeReleaseTrace> {
	const handle = resizeHandle(page, followingPaneId);
	const box = await handle.boundingBox();
	if (!box)
		throw new Error(`Resize handle for ${followingPaneId} has no hit box.`);
	const x = box.x + box.width / 2;
	const y = box.y + box.height / 2;
	const start = await sidebarBoundaryOffset(page, followingPaneId);
	const revisionBeforeRelease = await workspaceRevision(page);

	await page.mouse.move(x, y);
	await page.mouse.down();
	for (const fraction of [0.2, 0.45, 0.7, 1]) {
		await page.mouse.move(x, y + deltaY * fraction);
	}
	const beforeRelease = await sidebarBoundaryOffset(page, followingPaneId);
	expect(
		Math.abs(beforeRelease - start),
		`attempt ${attempt} (${followingPaneId}, ${deltaY}px) never moved during drag`,
	).toBeGreaterThanOrEqual(20);

	await page.mouse.up();
	const immediatelyAfterRelease = await sidebarBoundaryOffset(
		page,
		followingPaneId,
	);
	await animationFrames(page, 2);
	const flushed = await sidebarBoundaryOffset(page, followingPaneId);

	await expect
		.poll(
			async () =>
				(await commandRecords(page)).filter(
					(record) => record.command?.type === 'project.sidebar.update',
				).length,
			{ message: `attempt ${attempt} did not reach the sidebar authority` },
		)
		.toBe(expectedCommitCount);
	await expect
		.poll(() => workspaceRevision(page), {
			message: `attempt ${attempt} never reconciled the server workspace snapshot`,
		})
		.toBeGreaterThan(revisionBeforeRelease);
	const canonicalRevision = await workspaceRevision(page);
	await animationFrames(page, 3);
	const afterCanonicalReconciliation = await sidebarBoundaryOffset(
		page,
		followingPaneId,
	);

	const trace: ResizeReleaseTrace = {
		attempt,
		canonicalRevision,
		deltaY,
		followingPaneId,
		flushed,
		immediatelyAfterRelease,
		beforeRelease,
		start,
		afterCanonicalReconciliation,
	};
	for (const [phase, boundary] of Object.entries({
		immediatelyAfterRelease,
		flushed,
		afterCanonicalReconciliation,
	})) {
		expect(
			Math.abs(boundary - beforeRelease),
			`${JSON.stringify(trace)} sprang back during ${phase}`,
		).toBeLessThanOrEqual(1);
	}
	return trace;
}

test('real pointer releases preserve every repeated sidebar resize through React and canonical reconciliation', async ({
	mainWindow,
}) => {
	test.setTimeout(90_000);
	await openFileExplorer(mainWindow);
	await requireWorkspaceTest(mainWindow);
	const ids = ['explorer', 'agents', 'git', 'documentation'];
	for (const id of ids) await expandPane(mainWindow, id);
	await expectTitleSafePanelLayout(mainWindow, ids);
	await resetCommandRecords(mainWindow);

	const interactions = [
		['agents', 42],
		['git', -36],
		['documentation', 30],
		['agents', -42],
		['git', 36],
		['documentation', -30],
		['agents', 42],
		['git', -36],
		['documentation', 30],
		['agents', -42],
		['git', 36],
		['documentation', -30],
	] as const;
	const traces: ResizeReleaseTrace[] = [];
	for (const [index, [followingPaneId, deltaY]] of interactions.entries()) {
		traces.push(
			await dragAndTraceRelease(
				mainWindow,
				index + 1,
				followingPaneId,
				deltaY,
				index + 1,
			),
		);
	}

	expect(traces).toHaveLength(12);
	expect(new Set(traces.map((trace) => trace.followingPaneId))).toEqual(
		new Set(['agents', 'git', 'documentation']),
	);
	await expectTitleSafePanelLayout(mainWindow, ids);
});

type FastGitResizeSample = Readonly<{
	boundary: number;
	commandCount: number;
	revision: number;
	when:
		| 'start'
		| 'held-before-release'
		| 'release'
		| '50ms'
		| '100ms'
		| '250ms'
		| '500ms'
		| '1000ms';
}>;

/**
 * This is the manual failure report, deliberately without settling between
 * pointer down and pointer up: Explorer, Agents and Git are expanded;
 * Documentation is collapsed; the Agents/Git boundary moves upward and the
 * button is released in under 600ms. The full trace remains in the assertion
 * output when the boundary later springs back.
 */
test('fast real release of the Agents/Git boundary does not spring back', async ({
	electronApp,
	mainWindow,
}) => {
	test.setTimeout(45_000);
	await electronApp.evaluate(({ BrowserWindow }) => {
		const window =
			BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
		if (!window) throw new Error('The main BrowserWindow is unavailable.');
		window.setBounds({ ...window.getBounds(), height: 1275, width: 1980 });
	});
	await openFileExplorer(mainWindow);
	await requireWorkspaceTest(mainWindow);
	for (const id of ['explorer', 'agents', 'git']) {
		await expandPane(mainWindow, id);
	}
	const documentation = sidebarPane(mainWindow, 'documentation');
	if (
		!(await documentation.evaluate((element) =>
			element.classList.contains('sidebar-pane--collapsed'),
		))
	) {
		await documentation.locator('.sidebar-pane__header').click();
		await expect(documentation).toHaveClass(/sidebar-pane--collapsed/);
	}
	// Match the screenshot-like geometry before the reported gesture: a short
	// Explorer, a tall Agents pane, a visible Git body, and collapsed Docs.
	// Each setup resize is allowed to reconcile; only the final reported drag is
	// intentionally fast and unsettled.
	const stackBox = await activeSidebar(mainWindow).boundingBox();
	if (!stackBox) throw new Error('Sidebar stack has no geometry.');
	const desiredAgentsBoundary = Math.round(stackBox.height * 0.22);
	const desiredGitBoundary = Math.round(stackBox.height * 0.64);
	for (const [followingPaneId, desiredOffset] of [
		['agents', desiredAgentsBoundary],
		['git', desiredGitBoundary],
	] as const) {
		const currentOffset = await sidebarBoundaryOffset(
			mainWindow,
			followingPaneId,
		);
		await dragHandle(
			mainWindow,
			followingPaneId,
			desiredOffset - currentOffset,
		);
		await mainWindow.mouse.up();
		await expect
			.poll(() => sidebarBoundaryOffset(mainWindow, followingPaneId))
			.toBeCloseTo(desiredOffset, 0);
	}

	await resetCommandRecords(mainWindow);
	const handle = resizeHandle(mainWindow, 'git');
	const box = await handle.boundingBox();
	if (!box) throw new Error('Agents/Git resize handle has no hit box.');
	const x = box.x + box.width / 2;
	const y = box.y + box.height / 2;
	const startedAt = Date.now();
	const samples: FastGitResizeSample[] = [];
	const sample = async (when: FastGitResizeSample['when']) => {
		samples.push({
			boundary: await sidebarBoundaryOffset(mainWindow, 'git'),
			commandCount: (await commandRecords(mainWindow)).filter(
				(record) => record.command?.type === 'project.sidebar.update',
			).length,
			revision: await workspaceRevision(mainWindow),
			when,
		});
	};

	await sample('start');
	await mainWindow.mouse.move(x, y);
	await mainWindow.mouse.down();
	// Four ordinary real mouse moves mirror a quick manual drag. These waits
	// make the duration observable and keep pointer-down to pointer-up <600ms.
	for (const fraction of [0.25, 0.5, 0.75, 1]) {
		await mainWindow.mouse.move(x, y - 120 * fraction, { steps: 3 });
		await mainWindow.waitForTimeout(75);
	}
	await sample('held-before-release');
	expect(
		Date.now() - startedAt,
		'Fast user gesture unexpectedly exceeded 600ms before mouse-up.',
	).toBeLessThan(600);

	// Do not await a command, workspace snapshot, or React state update before
	// release: this is the exact timing of the reported interaction.
	await mainWindow.mouse.up();
	await sample('release');
	for (const [when, delay] of [
		['50ms', 50],
		['100ms', 50],
		['250ms', 150],
		['500ms', 250],
		['1000ms', 500],
	] as const) {
		await mainWindow.waitForTimeout(delay);
		await sample(when);
	}

	const held = samples.find((entry) => entry.when === 'held-before-release');
	if (!held) throw new Error('Missing held-before-release geometry.');
	const escaped = samples.filter(
		(entry) =>
			entry.when !== 'start' && Math.abs(entry.boundary - held.boundary) > 1,
	);
	expect(
		escaped,
		`Agents/Git boundary sprang back after a fast release: ${JSON.stringify({
			elapsedBeforeReleaseMs: Date.now() - startedAt,
			samples,
			commandRecords: await commandRecords(mainWindow),
		})}`,
	).toEqual([]);
});

/**
 * The manual report is intermittent. This uses one large real pointer move and
 * immediate pointer-up twenty times, while preserving the reported visible
 * pane set. Each attempt samples through the first post-release second; the
 * assertion prints every failed release rather than concealing a 2-in-3 rate.
 */
test('twenty immediate real releases of the Agents/Git boundary never spring back', async ({
	mainWindow,
}) => {
	test.setTimeout(75_000);
	await openFileExplorer(mainWindow);
	await requireWorkspaceTest(mainWindow);
	for (const id of ['explorer', 'agents', 'git']) {
		await expandPane(mainWindow, id);
	}
	const documentation = sidebarPane(mainWindow, 'documentation');
	if (
		!(await documentation.evaluate((element) =>
			element.classList.contains('sidebar-pane--collapsed'),
		))
	) {
		await documentation.locator('.sidebar-pane__header').click();
		await expect(documentation).toHaveClass(/sidebar-pane--collapsed/);
	}
	await resetCommandRecords(mainWindow);

	const traces: Array<{
		attempt: number;
		samples: FastGitResizeSample[];
	}> = [];
	for (let attempt = 1; attempt <= 20; attempt += 1) {
		const handle = resizeHandle(mainWindow, 'git');
		const box = await handle.boundingBox();
		if (!box) throw new Error('Agents/Git resize handle has no hit box.');
		const x = box.x + box.width / 2;
		const y = box.y + box.height / 2;
		const samples: FastGitResizeSample[] = [];
		const sample = async (when: FastGitResizeSample['when']) => {
			samples.push({
				boundary: await sidebarBoundaryOffset(mainWindow, 'git'),
				commandCount: (await commandRecords(mainWindow)).filter(
					(record) => record.command?.type === 'project.sidebar.update',
				).length,
				revision: await workspaceRevision(mainWindow),
				when,
			});
		};

		await sample('start');
		await mainWindow.mouse.move(x, y);
		await mainWindow.mouse.down();
		await mainWindow.mouse.move(x, y - 80, { steps: 1 });
		await sample('held-before-release');
		// This is intentionally the next operation: no wait, snapshot poll, or
		// framework settle is allowed between the final move and mouse release.
		await mainWindow.mouse.up();
		await sample('release');
		for (const [when, delay] of [
			['50ms', 50],
			['100ms', 50],
			['250ms', 150],
			['500ms', 250],
			['1000ms', 500],
		] as const) {
			await mainWindow.waitForTimeout(delay);
			await sample(when);
		}
		traces.push({ attempt, samples });

		// Bring the next attempt back to approximately the same useful range;
		// this is setup only and is deliberately not part of the sampled gesture.
		const restoreHandle = resizeHandle(mainWindow, 'git');
		const restoreBox = await restoreHandle.boundingBox();
		if (!restoreBox)
			throw new Error('Agents/Git restore handle has no hit box.');
		await mainWindow.mouse.move(
			restoreBox.x + restoreBox.width / 2,
			restoreBox.y + restoreBox.height / 2,
		);
		await mainWindow.mouse.down();
		await mainWindow.mouse.move(
			restoreBox.x + restoreBox.width / 2,
			restoreBox.y + restoreBox.height / 2 + 80,
			{ steps: 1 },
		);
		await mainWindow.mouse.up();
	}

	const bounced = traces.flatMap(({ attempt, samples }) => {
		const held = samples.find((entry) => entry.when === 'held-before-release');
		if (!held) return [{ attempt, samples }];
		return samples.some(
			(entry) =>
				entry.when !== 'start' && Math.abs(entry.boundary - held.boundary) > 1,
		)
			? [{ attempt, samples }]
			: [];
	});
	expect(
		bounced,
		`Fast Agents/Git release traces: ${JSON.stringify({
			bounced,
			commandRecords: await commandRecords(mainWindow),
		})}`,
	).toEqual([]);
});

test('project sidebar keeps titles visible while previewing and committing VS Code-style vertical resizing', async ({
	mainWindow,
}) => {
	test.setTimeout(45_000);
	await openFileExplorer(mainWindow);
	await requireWorkspaceTest(mainWindow);
	const ids = ['explorer', 'agents', 'git', 'documentation'];
	for (const id of ids) {
		await expandPane(mainWindow, id);
		await expect(sidebarTitle(mainWindow, id)).toBeVisible();
	}

	const stack = activeSidebar(mainWindow);
	const before = await panelGeometry(mainWindow, ids);
	expect(before.stack.style).toBe('hidden');
	expect(before.stack.scrollHeight).toBeLessThanOrEqual(
		before.stack.clientHeight + 1,
	);
	for (const id of ids) {
		expect(before.panes[id].title.top).toBeGreaterThanOrEqual(
			before.stack.top - 1,
		);
		expect(before.panes[id].title.bottom).toBeLessThanOrEqual(
			before.stack.bottom + 1,
		);
	}

	const handle = resizeHandle(mainWindow, 'agents');
	const title = sidebarTitle(mainWindow, 'agents');
	const [handleBox, titleBox] = await Promise.all([
		handle.boundingBox(),
		title.boundingBox(),
	]);
	if (!handleBox || !titleBox)
		throw new Error('Sidebar resize geometry is unavailable.');
	expect(
		Math.abs(handleBox.y + handleBox.height - titleBox.y),
	).toBeLessThanOrEqual(1);

	await resetCommandRecords(mainWindow);
	const startExplorerHeight = before.panes.explorer.body.height;
	await dragHandle(mainWindow, 'agents', 48);
	await expect
		.poll(
			async () =>
				(await panelGeometry(mainWindow, ids)).panes.explorer.body.height,
		)
		.not.toBe(startExplorerHeight);
	const preview = await panelGeometry(mainWindow, ids);
	expect(
		(await commandRecords(mainWindow)).filter(
			(record) => record.command?.type === 'project.sidebar.update',
		),
	).toHaveLength(0);
	await mainWindow.mouse.up();
	await expect
		.poll(
			async () =>
				(await commandRecords(mainWindow)).filter(
					(record) => record.command?.type === 'project.sidebar.update',
				).length,
		)
		.toBe(1);
	const [verticalCommit] = (await commandRecords(mainWindow)).filter(
		(record) => record.command?.type === 'project.sidebar.update',
	);
	expect(verticalCommit.command?.sidebar).toEqual(
		expect.objectContaining({
			sidebarAgentsHeight: expect.any(Number),
			sidebarDocumentationHeight: expect.any(Number),
			sidebarExplorerHeight: expect.any(Number),
			sidebarGitHeight: expect.any(Number),
		}),
	);

	const after = await panelGeometry(mainWindow, ids);
	expect(
		Math.abs(after.panes.agents.title.top - preview.panes.agents.title.top),
	).toBeLessThanOrEqual(1);
	expect(after.stack.scrollHeight).toBeLessThanOrEqual(
		after.stack.clientHeight + 1,
	);
	for (const id of ids) {
		expect(after.panes[id].title.top).toBeGreaterThanOrEqual(
			after.stack.top - 1,
		);
		expect(after.panes[id].title.bottom).toBeLessThanOrEqual(
			after.stack.bottom + 1,
		);
	}
	await expect(stack).toHaveCSS('overflow-y', 'hidden');
});

test('sidebar resize cancellation and width previews do not flood workspace commands', async ({
	mainWindow,
}) => {
	await openFileExplorer(mainWindow);
	await requireWorkspaceTest(mainWindow);
	const ids = ['explorer', 'agents', 'git', 'documentation'];
	for (const id of ids) await expandPane(mainWindow, id);
	const initial = await panelGeometry(mainWindow, ids);
	await resetCommandRecords(mainWindow);
	const point = await dragHandle(mainWindow, 'agents', 42);
	await mainWindow.evaluate(
		({ pointerId, x, y }) => {
			window.dispatchEvent(
				new PointerEvent('pointercancel', {
					bubbles: true,
					clientX: x,
					clientY: y + 42,
					pointerId,
				}),
			);
		},
		{ pointerId: 1, x: point.x, y: point.y },
	);
	// The synthetic cancellation ends the application interaction; release the
	// Playwright mouse state before beginning the independent width interaction.
	await mainWindow.mouse.up();
	await expect
		.poll(
			async () =>
				(await panelGeometry(mainWindow, ids)).panes.explorer.body.height,
		)
		.toBeCloseTo(initial.panes.explorer.body.height, 0);
	expect(
		(await commandRecords(mainWindow)).filter(
			(record) => record.command?.type === 'project.sidebar.update',
		),
	).toHaveLength(0);

	const widthHandle = mainWindow.locator('.workspace-split-layout__separator');
	const widthBox = await widthHandle.boundingBox();
	if (!widthBox) throw new Error('Sidebar width handle has no hit box.');
	await pageMouseDragPreview(
		mainWindow,
		widthBox.x + widthBox.width / 2,
		widthBox.y + widthBox.height / 2,
		55,
	);
	expect(
		(await commandRecords(mainWindow)).filter(
			(record) => record.command?.type === 'project.sidebar.update',
		),
	).toHaveLength(0);
	await mainWindow.mouse.up();
	await expect
		.poll(
			async () =>
				(await commandRecords(mainWindow)).filter(
					(record) => record.command?.type === 'project.sidebar.update',
				).length,
		)
		.toBe(1);
});

test('every vertical boundary supports repeated bidirectional and keyboard resizing through collapse and reorder', async ({
	mainWindow,
}) => {
	await openFileExplorer(mainWindow);
	await requireWorkspaceTest(mainWindow);
	const ids = ['explorer', 'agents', 'git', 'documentation'];
	for (const id of ids) await expandPane(mainWindow, id);

	for (const followingPaneId of ids.slice(1)) {
		await resetCommandRecords(mainWindow);
		for (const delta of [28, -20, 16, -12]) {
			await dragHandle(mainWindow, followingPaneId, delta);
			await mainWindow.mouse.up();
		}
		await expect
			.poll(
				async () =>
					(await commandRecords(mainWindow)).filter(
						(record) => record.command?.type === 'project.sidebar.update',
					).length,
			)
			.toBe(4);
		const handle = resizeHandle(mainWindow, followingPaneId);
		await expect(handle).toHaveAttribute('role', 'separator');
		await expect(handle).toHaveAttribute('aria-valuemin', /\d+/);
		await expect(handle).toHaveAttribute('aria-valuemax', /\d+/);
		await expect(handle).toHaveAttribute('aria-valuenow', /\d+/);
	}

	const keyboardHandle = resizeHandle(mainWindow, 'agents');
	await resetCommandRecords(mainWindow);
	await keyboardHandle.focus();
	await mainWindow.keyboard.press('ArrowDown');
	await mainWindow.keyboard.press('ArrowUp');
	await mainWindow.keyboard.press('Home');
	await mainWindow.keyboard.press('End');
	await expect
		.poll(
			async () =>
				(await commandRecords(mainWindow)).filter(
					(record) => record.command?.type === 'project.sidebar.update',
				).length,
		)
		.toBe(4);

	const documentation = sidebarPane(mainWindow, 'documentation');
	await documentation.locator('.sidebar-pane__header').click();
	await expect(documentation).toHaveClass(/sidebar-pane--collapsed/);
	await expect(sidebarTitle(mainWindow, 'documentation')).toBeVisible();
	await documentation.locator('.sidebar-pane__header').click();
	await expect(documentation).not.toHaveClass(/sidebar-pane--collapsed/);
	await mainWindow.getByLabel('Reorder Documentation panel').press('ArrowUp');
	await expect
		.poll(async () =>
			activeSidebar(mainWindow)
				.locator('[data-sidebar-pane-id]')
				.evaluateAll((elements) =>
					elements.map((element) =>
						element.getAttribute('data-sidebar-pane-id'),
					),
				),
		)
		.toContain('documentation');
	const geometry = await panelGeometry(mainWindow, ids);
	for (const id of ids) {
		expect(geometry.panes[id].title.top).toBeGreaterThanOrEqual(
			geometry.stack.top - 1,
		);
		expect(geometry.panes[id].title.bottom).toBeLessThanOrEqual(
			geometry.stack.bottom + 1,
		);
	}
});

test('sidebar never becomes the vertical scroller at supported window heights', async ({
	createWorkspace,
	electronApp,
	mainWindow,
}) => {
	const workspace = await createWorkspace({
		name: 'sidebar-layout-scroll-ownership',
		seed: {
			files: Object.fromEntries(
				Array.from({ length: 96 }, (_, index) => [
					`file-${String(index).padStart(3, '0')}.txt`,
					`${index}\n`,
				]),
			),
		},
	});
	await setProjectRoot(mainWindow, workspace.rootDir);
	await openFileExplorer(mainWindow);
	const ids = ['explorer', 'agents', 'git', 'documentation'];
	for (const id of ids) await expandPane(mainWindow, id);

	for (const height of [520, 700]) {
		await electronApp.evaluate(({ BrowserWindow }, nextHeight) => {
			const window =
				BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
			if (!window) throw new Error('The main BrowserWindow is unavailable.');
			const bounds = window.getBounds();
			window.setBounds({ ...bounds, height: nextHeight });
		}, height);
		await expect
			.poll(async () => (await panelGeometry(mainWindow, ids)).stack.height)
			.toBeGreaterThan(100);
		const geometry = await expectTitleSafePanelLayout(mainWindow, ids);
		expect(geometry.stack.scrollHeight).toBeLessThanOrEqual(
			geometry.stack.clientHeight + 1,
		);
		for (const id of ids) {
			expect(geometry.panes[id].title.top).toBeGreaterThanOrEqual(
				geometry.stack.top - 1,
			);
			expect(geometry.panes[id].title.bottom).toBeLessThanOrEqual(
				geometry.stack.bottom + 1,
			);
		}
	}

	const explorerBody = sidebarPane(mainWindow, 'explorer').locator(
		'.sidebar-pane__body',
	);
	await expect
		.poll(async () =>
			explorerBody.evaluate(
				(element) => element.scrollHeight > element.clientHeight,
			),
		)
		.toBe(true);
	const explorerScroll = await explorerBody.evaluate((element) => {
		element.scrollTop = 48;
		return element.scrollTop;
	});
	expect(explorerScroll).toBeGreaterThan(0);
	expect(
		await activeSidebar(mainWindow).evaluate((element) => element.scrollTop),
	).toBe(0);
});

test('normal project windows enforce the title-safe minimum height', async ({
	electronApp,
	mainWindow,
}) => {
	await openFileExplorer(mainWindow);
	const ids = ['explorer', 'agents', 'git', 'documentation'];
	for (const id of ids) await expandPane(mainWindow, id);

	const constrainedHeight = await electronApp.evaluate(({ BrowserWindow }) => {
		const window =
			BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
		if (!window) throw new Error('The main BrowserWindow is unavailable.');
		const bounds = window.getBounds();
		window.setBounds({ ...bounds, height: 1 });
		return window.getBounds().height;
	});
	expect(constrainedHeight).toBeGreaterThanOrEqual(260);
	await expect(activeSidebar(mainWindow)).toHaveAttribute(
		'data-sidebar-layout-feasible',
		'true',
	);
	await expect(
		activeSidebar(mainWindow).locator('[data-sidebar-minimum-height-notice]'),
	).toHaveCount(0);
	const geometry = await expectTitleSafePanelLayout(mainWindow, ids);
	for (const id of ids) {
		const title = geometry.panes[id]?.title;
		if (!title) throw new Error(`Missing ${id} sidebar title geometry.`);
		expect(title.top).toBeGreaterThanOrEqual(geometry.stack.top - 1);
		expect(title.bottom).toBeLessThanOrEqual(geometry.stack.bottom + 1);
	}
});

test('committed pane sizes remain project-local through project switching and renderer reload', async ({
	mainWindow,
}) => {
	await openFileExplorer(mainWindow);
	const ids = ['explorer', 'agents', 'git', 'documentation'];
	for (const id of ids) await expandPane(mainWindow, id);
	const firstProjectId = await mainWindow
		.locator('.project-tab--active')
		.getAttribute('data-project-id');
	if (!firstProjectId)
		throw new Error('Active project identity is unavailable.');
	await dragHandle(mainWindow, 'agents', 56);
	await mainWindow.mouse.up();
	const firstHeight = (await panelGeometry(mainWindow, ids)).panes.explorer.body
		.height;

	await mainWindow.getByLabel('Create project on This server').click();
	await expect(mainWindow.locator('.project-tab')).toHaveCount(2);
	await openFileExplorer(mainWindow);
	for (const id of ids) await expandPane(mainWindow, id);
	const secondHeight = (await panelGeometry(mainWindow, ids)).panes.explorer
		.body.height;
	expect(secondHeight).not.toBeCloseTo(firstHeight, 0);

	await mainWindow.locator(`[data-project-id="${firstProjectId}"]`).click();
	await expect
		.poll(
			async () =>
				(await panelGeometry(mainWindow, ids)).panes.explorer.body.height,
		)
		.toBeCloseTo(firstHeight, 0);
	await mainWindow.reload();
	await openFileExplorer(mainWindow);
	for (const id of ids) await expandPane(mainWindow, id);
	await expect
		.poll(
			async () =>
				(await panelGeometry(mainWindow, ids)).panes.explorer.body.height,
		)
		.toBeCloseTo(firstHeight, 0);
});

async function pageMouseDragPreview(
	page: Page,
	x: number,
	y: number,
	deltaX: number,
): Promise<void> {
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x + deltaX / 2, y);
	await page.mouse.move(x + deltaX, y);
}
