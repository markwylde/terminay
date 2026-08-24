import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
	test as base,
	type ElectronApplication,
	_electron as electron,
	expect,
	type Page,
} from '@playwright/test';
import {
	FileProjectEnvironmentStateBackend,
	ProjectEnvironmentRepository,
} from '../packages/server-core/src/projectEnvironment/index';
import { stageImmutableRendererArtifact } from '../scripts/immutable-renderer-artifact.mjs';
import {
	openChildWindow,
	openMacroLauncher,
	openMacrosWindow,
	openProjectEnvironmentsWindow,
	openRecordingsWindow,
	openRemoteControlWindow,
	openSettingsWindow,
	prepareWindow,
	sendAppCommand,
} from './support/app';
import {
	createDialogController,
	type DialogController,
} from './support/dialogs';
import {
	createFixtureWorkspace,
	type FixtureWorkspace,
	type WorkspaceOptions,
} from './support/workspace';

type ElectronFixtures = {
	appHarness: {
		dialogs: (page?: Page) => Promise<DialogController>;
		openChildWindow: (action: () => Promise<void>) => Promise<Page>;
		openMacroLauncher: (
			page?: Page,
			options?: { attempts?: number },
		) => Promise<void>;
		openMacrosWindow: (page?: Page) => Promise<Page>;
		openProjectEnvironmentsWindow: (page?: Page) => Promise<Page>;
		openRecordingsWindow: (page?: Page) => Promise<Page>;
		openRemoteControlWindow: (page?: Page) => Promise<Page>;
		openSettingsWindow: (options?: {
			page?: Page;
			sectionId?: string;
		}) => Promise<Page>;
		prepareWindow: (page: Page) => Promise<Page>;
		sendAppCommand: (
			command: import('../src/types/terminay').AppCommand,
			page?: Page,
		) => Promise<void>;
	};
	createWorkspace: (options?: WorkspaceOptions) => Promise<FixtureWorkspace>;
	electronApp: ElectronApplication;
	mainWindow: Page;
	tempDir: string;
	userDataDir: string;
};

const desktopAppReadyTimeoutMs = 15_000;
const execFileAsync = promisify(execFile);

const nativeCodexFixture = String.raw`
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/stat.h>
#include <unistd.h>

static void directories(char *path) {
  for (char *cursor = path + 1; *cursor; cursor += 1) {
    if (*cursor == '/') { *cursor = '\0'; mkdir(path, 0700); *cursor = '/'; }
  }
  mkdir(path, 0700);
}

int main(void) {
  const char *home = getenv("CODEX_HOME");
  if (!home) return 64;
  char directory[PATH_MAX];
  char journal[PATH_MAX];
  snprintf(directory, sizeof(directory), "%s/sessions/2026/08/24", home);
  directories(directory);
  snprintf(journal, sizeof(journal), "%s/rollout-e2e-root.jsonl", directory);
  FILE *stream = fopen(journal, "w");
  if (!stream) return 65;
  fputs("{\"type\":\"session_meta\",\"payload\":{\"id\":\"e2e-native-root\",\"originator\":\"codex-tui\",\"source\":\"cli\",\"model\":\"gpt-e2e-codex\"}}\n", stream);
  fputs("{\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\",\"message\":\"Native Codex root prompt\",\"turn_id\":\"native-turn\"}}\n", stream);
  fflush(stream);
  for (;;) sleep(1);
}
`;

async function prepareNativeCodexFixture(
	tempDir: string,
): Promise<{ readonly codexHome: string; readonly bin: string }> {
	const codexHome = path.join(tempDir, 'native-codex-home');
	const bin = path.join(tempDir, 'native-codex-bin');
	const source = path.join(tempDir, 'native-codex.c');
	const executable = path.join(bin, 'codex');
	await Promise.all([
		mkdir(codexHome, { recursive: true }),
		mkdir(bin, { recursive: true }),
	]);
	// Codex maintains this index before a session starts. Creating the empty
	// file here means the real extension binds a watcher and can observe the
	// later atomic/append title update below without a provider restart.
	await writeFile(path.join(codexHome, 'session_index.jsonl'), '', {
		mode: 0o600,
	});
	await writeFile(source, nativeCodexFixture, { mode: 0o600 });
	await execFileAsync('cc', [source, '-O2', '-o', executable]);
	return { codexHome, bin };
}

const contentTypes: Record<string, string> = {
	'.css': 'text/css',
	'.html': 'text/html',
	'.ico': 'image/x-icon',
	'.js': 'text/javascript',
	'.json': 'application/json',
	'.mjs': 'text/javascript',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.webp': 'image/webp',
};

async function createStaticServer(
	distRoot: string,
): Promise<{ close: () => Promise<void>; url: string }> {
	const server: Server = createServer(async (request, response) => {
		try {
			const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
			const pathname =
				requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
			const relativePath = decodeURIComponent(pathname).replace(/^\/+/, '');
			let filePath: string | null = null;

			for (const root of [distRoot]) {
				const candidate = path.resolve(root, relativePath);
				if (!candidate.startsWith(root)) {
					continue;
				}

				const candidateStat = await stat(candidate).catch(() => null);
				if (candidateStat?.isFile()) {
					filePath = candidate;
					break;
				}
			}

			if (!filePath) {
				response.writeHead(404);
				response.end('Not found');
				return;
			}

			response.writeHead(200, {
				'content-type':
					contentTypes[path.extname(filePath)] ?? 'application/octet-stream',
			});
			createReadStream(filePath).pipe(response);
		} catch {
			response.writeHead(500);
			response.end('Internal server error');
		}
	});

	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			server.off('error', reject);
			resolve();
		});
	});

	const address = server.address();
	if (!address || typeof address === 'string') {
		throw new Error('Failed to start E2E static server.');
	}

	return {
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			}),
		url: `http://127.0.0.1:${address.port}/`,
	};
}

async function closeElectronAppGracefully(
	electronApp: ElectronApplication,
): Promise<void> {
	const closeTimeoutMs = 2_500;

	const raceWithTimeout = async <T>(
		promise: Promise<T>,
		timeoutMs: number,
		message: string,
	): Promise<T> => {
		return await Promise.race([
			promise,
			new Promise<T>((_, reject) => {
				setTimeout(() => reject(new Error(message)), timeoutMs);
			}),
		]);
	};

	try {
		await electronApp.evaluate(({ dialog }) => {
			dialog.showMessageBox = async () => ({
				checkboxChecked: false,
				response: 0,
			});
		});
	} catch {
		// The app may already have exited during the test.
	}

	try {
		await raceWithTimeout(
			electronApp.close(),
			closeTimeoutMs,
			'Timed out waiting for Electron to close gracefully.',
		);
		return;
	} catch {
		// A broken graceful-shutdown path must not consume the test timeout.
		if (electronApp.process().exitCode === null) {
			electronApp.process().kill('SIGKILL');
		}
	}
}

export const test = base.extend<ElectronFixtures>({
	// biome-ignore lint/correctness/noEmptyPattern: Playwright fixture callbacks require an object pattern here.
	userDataDir: async ({}, use) => {
		const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'terminay-e2e-'));

		try {
			await use(userDataDir);
		} finally {
			await rm(userDataDir, { recursive: true, force: true });
		}
	},

	tempDir: async ({ userDataDir }, use) => {
		const tempDir = path.join(userDataDir, 'temp');

		await rm(tempDir, { recursive: true, force: true });
		await mkdir(tempDir, { recursive: true });
		await use(tempDir);
	},

	electronApp: async ({ tempDir, userDataDir }, use, testInfo) => {
		const nativeCodex =
			path.basename(testInfo.file) === 'extension-agent-runtime.spec.ts'
				? await prepareNativeCodexFixture(tempDir)
				: undefined;
		if (path.basename(testInfo.file) === 'mixed-project-environments.spec.ts') {
			const now = Date.now();
			const profile = (
				id: string,
				providerId: string,
				name: string,
				endpointSummary: string,
				configuration: Record<string, string>,
			) => ({
				id,
				providerId,
				name,
				endpointSummary,
				activeRevision: 1,
				recommendedRevision: 1,
				revisions: {
					'1': {
						revision: 1,
						createdAt: now,
						configuration,
						secretReferences: [],
					},
				},
				archived: false,
			});
			const environment = (
				id: string,
				providerId: string,
				profileId: string,
				name: string,
				endpointSummary: string,
				defaultRoot: string,
				providerState: Record<string, string>,
			) => ({
				id,
				providerId,
				profileId,
				pinnedRevision: 1,
				name,
				endpointSummary,
				defaultRoot,
				declaredCapabilities: ['terminal', 'filesystem'],
				availableCapabilities: [],
				// This metadata-only fixture intentionally has no activated external
				// provider. Provisioning records remain visible without pretending a
				// live SSH/Puzed runtime is available; packed-provider E2E owns that.
				status: 'provisioning',
				operationReferences: [],
				projectReferenceCount: 0,
				archived: false,
				builtIn: false,
				providerState,
				providerRevision: 1,
			});
			const thisServer = {
				id: 'terminay:this-server',
				providerId: 'terminay:this-server',
				pinnedRevision: 1,
				name: 'This server',
				endpointSummary: 'Local to this Terminay Server',
				declaredCapabilities: [
					'terminal',
					'filesystem',
					'filesystem-observation',
					'git',
					'process-observation',
					'agent-journal',
					'shell-discovery',
				],
				availableCapabilities: [
					'terminal',
					'filesystem',
					'filesystem-observation',
					'git',
					'process-observation',
					'agent-journal',
					'shell-discovery',
				],
				status: 'ready',
				operationReferences: [],
				projectReferenceCount: 0,
				archived: false,
				builtIn: true,
				providerState: null,
				providerRevision: 1,
			};
			const sshProviderId = 'com.terminay.ssh/connection';
			const projectEnvironmentPath = path.join(
				userDataDir,
				'project-environments.v1.json',
			);
			await writeFile(
				projectEnvironmentPath,
				`${JSON.stringify(
					{
						schemaVersion: 2,
						serverId: 'desktop-local',
						revision: 7,
						cursor: '7',
						profiles: {
							'profile:ssh-ci': profile(
								'profile:ssh-ci',
								sshProviderId,
								'CI SSH',
								'ssh-ci:22',
								{ host: 'ssh-ci', user: 'terminay' },
							),
							'profile:puzed-ci': profile(
								'profile:puzed-ci',
								sshProviderId,
								'CI Puzed VM',
								'puzed-ci:22',
								{ sshBindingId: 'puzed-ssh:machine-ci' },
							),
						},
						operations: {},
						environments: {
							'terminay:this-server': thisServer,
							'environment:ssh-ci': environment(
								'environment:ssh-ci',
								sshProviderId,
								'profile:ssh-ci',
								'CI SSH',
								'ssh-ci:22',
								'/home/terminay/ssh-project',
								{ profile: 'profile:ssh-ci' },
							),
							'environment:puzed-ci': environment(
								'environment:puzed-ci',
								sshProviderId,
								'profile:puzed-ci',
								'CI Puzed VM',
								'puzed-ci:22',
								'/home/terminay/puzed-project',
								{ sshBindingId: 'puzed-ssh:machine-ci' },
							),
						},
					},
					null,
					2,
				)}\n`,
				{ mode: 0o600 },
			);
			// Fail the fixture before Electron launch if its durable registry does not
			// satisfy the exact production repository schema.
			const seededRepository = new ProjectEnvironmentRepository(
				new FileProjectEnvironmentStateBackend(projectEnvironmentPath),
				'desktop-local',
			);
			const seededState = await seededRepository.load();
			if (Object.keys(seededState.environments).length !== 3) {
				throw new Error(
					'Mixed project environment fixture did not seed three canonical environments.',
				);
			}
		}
		const rendererArtifactParent = await mkdtemp(
			path.join(os.tmpdir(), 'terminay-e2e-renderer-'),
		);
		const rendererArtifact = await stageImmutableRendererArtifact({
			sourceRoot: path.resolve('dist'),
			// The app owns both userData and TMP. Keep the immutable application
			// bytes in an independent fixture root until after Electron exits.
			destinationParent: rendererArtifactParent,
		});
		const staticServer = await createStaticServer(
			rendererArtifact.rootDirectory,
		);
		const electronApp = await electron.launch({
			args: ['.'],
			env: {
				...process.env,
				CI: '1',
				TEMP: tempDir,
				TERMINAY_E2E_TEMP_DIR: tempDir,
				TERMINAY_TEST: '1',
				...(nativeCodex === undefined
					? {}
					: {
							CODEX_HOME: nativeCodex.codexHome,
							PATH: `${nativeCodex.bin}${path.delimiter}${process.env.PATH ?? ''}`,
						}),
				...(path.basename(testInfo.file) ===
				'embedded-workspace-persistence-recovery.spec.ts'
					? {
							TERMINAY_TEST_WORKSPACE_PERSISTENCE_FAULT:
								persistenceFaultForTest(testInfo.title),
						}
					: {}),
				...(path.basename(testInfo.file) === 'remote-access.spec.ts'
					? { TERMINAY_TEST_ALLOW_UNAVAILABLE_WEBRTC_UI: '1' }
					: {}),
				TERMINAY_USER_DATA_DIR: userDataDir,
				TMP: tempDir,
				TMPDIR: tempDir,
				VITE_DEV_SERVER_URL: staticServer.url,
			},
		});

		try {
			await use(electronApp);
		} finally {
			await closeElectronAppGracefully(electronApp);
			await staticServer.close();
			await rendererArtifact.assertUnchanged();
			await rm(rendererArtifactParent, { recursive: true, force: true });
		}
	},

	mainWindow: async ({ electronApp }, use) => {
		const mainWindow = await prepareWindow(await electronApp.firstWindow());
		await expect(mainWindow.locator('.project-tabbar')).toBeVisible({
			timeout: desktopAppReadyTimeoutMs,
		});
		await expect(mainWindow.locator('.terminal-tab-content')).toHaveCount(1, {
			timeout: desktopAppReadyTimeoutMs,
		});
		await use(mainWindow);
	},

	appHarness: async ({ electronApp, mainWindow }, use) => {
		await use({
			dialogs: async (page = mainWindow) => {
				await prepareWindow(page);
				return createDialogController(page);
			},
			openChildWindow: (action) => openChildWindow(electronApp, action),
			openMacroLauncher: (page = mainWindow, options) =>
				openMacroLauncher(page, options),
			openMacrosWindow: (page = mainWindow) =>
				openMacrosWindow(electronApp, page),
			openProjectEnvironmentsWindow: (page = mainWindow) =>
				openProjectEnvironmentsWindow(electronApp, page),
			openRecordingsWindow: (page = mainWindow) =>
				openRecordingsWindow(electronApp, page),
			openRemoteControlWindow: (page = mainWindow) =>
				openRemoteControlWindow(electronApp, page),
			openSettingsWindow: (options) =>
				openSettingsWindow(electronApp, options?.page ?? mainWindow, {
					sectionId: options?.sectionId,
				}),
			prepareWindow,
			sendAppCommand: (command, page = mainWindow) =>
				sendAppCommand(page, command),
		});
	},

	createWorkspace: async ({ tempDir }, use) => {
		await use((options?: WorkspaceOptions) =>
			createFixtureWorkspace(tempDir, options),
		);
	},
});

export { expect };

function persistenceFaultForTest(
	title: string,
): 'unreadable' | 'invalid' | 'uncommittable' {
	if (title.includes('unreadable')) return 'unreadable';
	if (title.includes('invalid')) return 'invalid';
	return 'uncommittable';
}
