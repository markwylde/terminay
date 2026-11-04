import { containerSourceRunner } from './sourceRunner.js';
import { BotDeletions } from './deletions.js';
import { createBotMessageOperations } from './messageProtocol.js';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import type { BotAgentContribution } from '@terminay/extension-api';
import type { BotAgent, BotSessionSnapshot } from '@terminay/protocol';
import {
	loadCanonicalStateSync,
	writeFileDurablySync,
} from '../durableFile.js';
import type { ExtensionInstaller } from '../extensions/installer.js';
import type { PtyFactory } from '../terminalService/types.js';
import type { OperationRegistries } from '../types.js';
import type { BotCredentialLease } from './acp.js';
import { noBotCredentials } from './acp.js';
import { createBotCredentialOperations } from './credentialProtocol.js';
import { BotEngine, type EnginePin } from './engine.js';
import { BotEngineService, validateEnginePin } from './engineService.js';
import { BotEnvironmentService } from './environment.js';
import { BotFilesService } from './files.js';
import type { BotAgentInstall } from './image.js';
import { readBotImage } from './images.js';
import { BotIoProtocol } from './ioProtocol.js';
import { BotMemories, type BotMemoryHelper } from './memories.js';
import { EngineProcess } from './process.js';
import { createBotEnvironmentOperations } from './protocol.js';
import { BotDesktopService } from './rfb.js';
import { type BotAgents, BotService, botAgentConfigFiles } from './service.js';
import { BotSessionStore } from './sessions.js';
import { BotShellService } from './shell.js';
import { BotError, BotStore } from './store.js';
import {
	type BotTokenLease,
	BotTokenService,
	type BotTokenVault,
} from './tokens.js';

function mergeOperationRegistries(
	a: OperationRegistries,
	b: OperationRegistries,
): OperationRegistries {
	return {
		policies: { ...a.policies, ...b.policies },
		queries: { ...a.queries, ...b.queries },
		commands: { ...a.commands, ...b.commands },
	};
}

export interface BotServerOptions {
	readonly serverId: string;
	readonly dataRoot: string;
	readonly agents: BotAgents & {
		botAgentInstalls(): readonly BotAgentInstall[];
	};
	readonly catalog?: () => Promise<
		readonly {
			extensionId: string;
			extensionName: string;
			contribution: BotAgentContribution;
			enabled: boolean;
		}[]
	>;
	readonly extensionName?: (extensionId: string) => string;
	readonly vault: BotTokenVault;
	readonly tokens?: BotTokenService;
	readonly pty: PtyFactory;
	readonly imageContextPath?: string;
	readonly platform?: NodeJS.Platform;
	readonly processRunner?: EngineProcess;
}

/** Shared by standalone and embedded hosts. Absent engines are a Bots setup
 * state; unsupported hosts can omit this service and its capability entirely. */
export function createBotServerService(options: BotServerOptions): BotService {
	const root = join(options.dataRoot, 'bots');
	mkdirSync(root, { recursive: true, mode: 0o700 });
	const pinPath = join(root, 'engine.json');
	let pin = loadCanonicalStateSync(pinPath, 'bots', {
		validate: validateEnginePin,
	});
	const pins = {
		load: async () => pin,
		save: async (value: EnginePin) => {
			writeFileDurablySync(pinPath, JSON.stringify(value), {
				keepPrevious: true,
			});
			pin = value;
		},
	};
	const platform = options.platform ?? process.platform;
	const engine = new BotEngine(
		pins,
		options.processRunner ?? new EngineProcess(),
		platform,
	);
	const images = new BotEngineService(
		engine,
		pins,
		options.imageContextPath ??
			fileURLToPath(new URL('./image-context/', import.meta.url)),
		() => options.agents.botAgentInstalls(),
		options.serverId,
	);
	const deletions = new BotDeletions(
		join(root, 'deletions.json'),
		options.serverId,
	);
	const bots = new BotStore(join(root, 'bots.json'));
	const sessions = new BotSessionStore(join(root, 'sessions'));
	const tokens = options.tokens ?? new BotTokenService(options.vault);
	let service: BotService;
	let io: BotIoProtocol;
	const agent = (id: string) => {
		const a = options.agents
			.botAgentContributions()
			.find((a) => a.contribution.id === id)?.contribution;
		if (!a) throw new Error('bot agent unavailable');
		return a;
	};
	const activities = new Map<
		string,
		{
			runningSessions: number;
			queuedSessions: number;
			shells: number;
			desktops: number;
		}
	>();
	const activity = (
		id: string,
		update: Partial<{
			runningSessions: number;
			queuedSessions: number;
			shells: number;
			desktops: number;
		}>,
	) => {
		const value = {
			runningSessions: 0,
			queuedSessions: 0,
			shells: 0,
			desktops: 0,
			...activities.get(id),
			...update,
		};
		activities.set(id, value);
		environment.setActivity(id, value);
	};
	const streamActivity = (
		id: string,
		key: 'shells' | 'desktops',
		delta: number,
	) =>
		activity(id, {
			[key]: Math.max(0, (activities.get(id)?.[key] ?? 0) + delta),
		});
	const tokenLease = (
		id: string,
		snapshot?: BotSessionSnapshot,
	): Promise<BotTokenLease> => {
		const profile = snapshot ?? bots.get(id);
		const a = agent(profile.agentId);
		if (
			profile.signIn.kind === 'token' &&
			!a.credentialSecrets?.some(
				(s) =>
					profile.signIn.kind === 'token' &&
					s.environmentVariable === profile.signIn.environmentVariable,
			)
		)
			throw new Error('bot credential is no longer declared');
		return tokens.acquire(
			id,
			profile.signIn.kind === 'token'
				? (a.credentialSecrets ?? []).filter(
						(s) =>
							profile.signIn.kind === 'token' &&
							s.environmentVariable === profile.signIn.environmentVariable,
					)
				: [],
		);
	};
	const passwordId = (id: string) => `bot:${id}:vnc`;
	const environment = new BotEnvironmentService(options.serverId, {
		engine: () => images.driver(),
		ensureImage: (d) => images.ensureImage(d),
		currentFingerprint: () => images.fingerprint,
		closeHelper: async (id) => {
			await io?.closeBot(id);
			await files.closeBot(id);
		},
		stopSessions: async (id) => {
			await io?.closeBot(id);
			await service.stopBot(id);
		},
		bootstrap: async (id) => {
			const key = passwordId(id);
			if (!options.vault.status().entries.some((e) => e.id === key)) {
				const value = Buffer.from(randomBytes(8).toString('hex').slice(0, 8));
				try {
					await options.vault.put({ id: key, label: key, value });
				} finally {
					value.fill(0);
				}
			}
			return options.vault.withSecret(key, (v) => ({
				vncPassword: Buffer.from(v).toString('utf8'),
			}));
		},
		secrets: async () => [],
		logTokens: (id) => tokenLease(id),
		settings: bots,
	});
	const files = new BotFilesService(options.serverId, {
		engine: () => images.driver(),
		protectedPaths: (id) => {
			const a = agent(bots.get(id).agentId);
			return botAgentConfigFiles(a, true).map((f) => f.path);
		},
	});
	const writeDeviceConfig = async (id: string) => {
		const configFiles = botAgentConfigFiles(agent(bots.get(id).agentId), true);
		if (configFiles.length)
			await (await images.driver()).exec(
				`terminay-bot-${id}`,
				['terminay-init', '--config'],
				{
					user: 'root',
					input: JSON.stringify(
						configFiles.map((f) => ({ path: f.path, content: f.contents })),
					),
				},
			);
	};
	const shells = new BotShellService({
		engine: () => images.driver(),
		start: (id) => environment.start(id),
		activity: (id, delta) => streamActivity(id, 'shells', delta),
		signIn: {
			command: (id) => {
				const device = agent(bots.get(id).agentId).deviceSignIn;
				return device
					? [device.command.executable, ...device.command.args]
					: undefined;
			},
			prepare: writeDeviceConfig,
			succeeded: (id) => service.setDeviceSignIn(id, true),
		},
	});
	const desktops = new BotDesktopService({
		engine: () => images.driver(),
		running: (id) => environment.state(id) === 'running',
		withPassword: (id, fn) => options.vault.withSecret(passwordId(id), fn),
		activity: (id, delta) => streamActivity(id, 'desktops', delta),
	});
	const memories = new BotMemories(memoryHelper(files), bots);
	const detachEnvironment = environment.follow(engine);
	service = new BotService(bots, sessions, memories, {
		serverId: options.serverId,
		sources: containerSourceRunner({
			driver: () => images.driver(),
			start: (id) => environment.start(id),
			activity: (id, delta) => streamActivity(id, 'shells', delta),
			vault: options.vault,
		}),
		closeConnection: (id) => {
			void io
				.closeConnection(id)
				.catch(() => service.emit('cleanup-failed', { connectionId: id }));
		},
		agents: options.agents,
		environment,
		deletion: {
			begin: (id, deleteHome) => deletions.begin(id, deleteHome, pin),
			cleanup: async (id, deleteHome) => {
				try {
					if (deletions.list().find((e) => e.botId === id)?.pin === null) {
						deletions.complete(id);
						return true;
					}
					const driver = await images.driver();
					if (!deletions.matches(id, driver.details.pin)) return false;
					await environment.cleanupDeleted(driver, id, deleteHome);
					deletions.complete(id);
					return true;
				} catch {
					return false;
				}
			},
		},
		driver: () => images.driver(),
		removeHelpers: () => files.reconcile(),
		activity: (id, runningSessions, queuedSessions) =>
			activity(id, { runningSessions, queuedSessions }),
		credentials: {
			acquire: async (id, snapshot) => {
				// The login is in the bot's own home; nothing is passed in.
				if (snapshot.signIn.kind === 'device') return noBotCredentials();
				if (snapshot.signIn.kind === 'none')
					throw new BotError(
						'unavailable',
						'This bot is not signed in. Choose how it signs in under Configure › Profile › Sign-in.',
					);
				return credentialLease(
					await tokenLease(id, snapshot),
					snapshot,
					agent(snapshot.agentId),
				);
			},
		},
		agentInfo: async () => {
			const status = await images.status();
			const entries = options.catalog
				? await options.catalog()
				: options.agents
						.botAgentContributions()
						.map((entry) => ({ ...entry, enabled: true }));
			return Promise.all(
				entries.map(async (entry): Promise<BotAgent> => {
					const a = entry.contribution;
					const [models, state] = await Promise.all([
						options.agents.botAgentModels(a.id),
						options.agents.botAgentStatus(a.id),
					]);
					return {
						extensionId: entry.extensionId,
						extensionName:
							entry.extensionName ??
							options.extensionName?.(entry.extensionId) ??
							entry.extensionId,
						id: a.id,
						displayName: a.displayName,
						autonomousOnly: a.autonomousOnly,
						canLoad: bots
							.list()
							.some(
								(b) =>
									b.agentId === a.id &&
									sessions.list(b.id).some((s) => s.canLoad),
							),
						signInMethods: [
							...(a.deviceSignIn ? ['device' as const] : []),
							...(a.credentialSecrets?.length ? ['token' as const] : []),
						],
						deviceSignIn: a.deviceSignIn
							? { label: a.deviceSignIn.label, help: a.deviceSignIn.help }
							: null,
						status: !entry.enabled
							? {
									state: 'unavailable',
									action: {
										label: 'Enable extension',
										kind: 'enable-extension',
									},
								}
							: !state.available
								? { state: 'unavailable' }
								: status.image.state === 'building'
									? { state: 'not-installed', detail: 'Building image…' }
									: status.image.state !== 'current'
										? {
												state: 'not-installed',
												...(status.image.state === 'outdated'
													? { detail: 'Image update available' }
													: {}),
												action: {
													label:
														status.image.state === 'outdated'
															? 'Update image'
															: 'Build image',
													kind: 'build-image',
												},
											}
										: { state: 'ready' },
						models: {
							available: models.available,
							value: models.available ? models.value : [],
						},
					};
				}),
			);
		},
		additionalOperations: () =>
			mergeOperationRegistries(
				mergeOperationRegistries(
					createBotEnvironmentOperations(environment),
					images.operations(),
				),
				mergeOperationRegistries(
					mergeOperationRegistries(
						io.operations(),
						createBotMessageOperations(service),
					),
					createBotCredentialOperations({
						authority: (context) => service.connections.authority(context),
						agent: (id) => agent(bots.get(id).agentId),
						tokens,
						deviceSignedIn: (id) => bots.get(id).signIn.kind === 'device',
						deviceSignOut: async (id) => {
							const device = agent(bots.get(id).agentId).deviceSignIn;
							if (!device)
								throw new BotError(
									'validation',
									'this agent has no device sign-in',
								);
							await io.closeBot(id);
							await service.stopBot(id);
							await environment.start(id);
							await writeDeviceConfig(id);
							// The supervisor runs the declared CLI as bot with HOME=/home/bot.
							await (await images.driver()).exec(
								`terminay-bot-${id}`,
								[
									'terminay-run',
									`signout-${randomBytes(6).toString('hex')}`,
									'--',
									device.signOutCommand.executable,
									...device.signOutCommand.args,
								],
								{
									user: 'root',
									env: { ...process.env, HOME: '/home/bot' },
									environmentNames: ['HOME'],
									deadlineMs: 30_000,
								},
							);
							await service.setDeviceSignIn(id, false);
						},
						changed: (id) => service.invalidate(id),
					}),
				),
			),
		dispose: async () => {
			engine.off('availability', cleanup);
			engine.off('availability', resumeSources);
			images.off('changed', cleanup);
			await cleaning;
			detachEnvironment();
			await io.close();
			await shells.close();
			desktops.close();
			await files.close();
			environment.close();
			await images.close();
		},
	});
	io = new BotIoProtocol({
		image: async (id, path, signal) => {
			service.bots.get(id);
			return readBotImage(
				await images.driver(),
				options.serverId,
				id,
				path,
				signal,
			);
		},
		authority: (context) => service.connections.authority(context),
		files,
		shells,
		desktops,
	});
	let cleaning: Promise<void> | undefined;
	const cleanup = () => {
		if (!engine.availability.available || cleaning) return;
		const driver = engine.driver;
		cleaning = (async () => {
			for (const intent of [...deletions.list()]) {
				if (!deletions.matches(intent.botId, driver.details.pin)) continue;
				try {
					if (bots.list().some((b) => b.id === intent.botId)) {
						await service.remove(intent.botId, intent.deleteHome, true);
					} else {
						await environment.cleanupDeleted(
							driver,
							intent.botId,
							intent.deleteHome,
						);
						deletions.complete(intent.botId);
					}
				} catch {
					/* Durable intent remains for the next explicit engine check. */
				}
			}
		})().finally(() => {
			cleaning = undefined;
		});
	};
	let sourcesEngineAvailable = engine.availability.available;
	const resumeSources = () => {
		const available = engine.availability.available;
		const restored = available && !sourcesEngineAvailable;
		sourcesEngineAvailable = available;
		if (restored) service.triggers.resumeSources();
	};
	engine.on('availability', resumeSources);
	engine.on('availability', cleanup);
	images.on('changed', cleanup);
	environment.on('changed', ({ botId }) => service.invalidate(botId));
	images.on('changed', (event) => service.emit('engine-changed', event));
	return service;
}

function credentialLease(
	token: BotTokenLease,
	snapshot: BotSessionSnapshot,
	agent: ReturnType<BotAgents['botAgentContributions']>[number]['contribution'],
): Promise<BotCredentialLease> {
	return token.withEnvironment((values) => {
		const environment = { ...values } as Record<string, string>;
		return {
			environment,
			authenticateMethodId: agent.credentialSecrets?.find(
				(s) =>
					snapshot.signIn.kind === 'token' &&
					s.environmentVariable === snapshot.signIn.environmentVariable,
			)?.authenticateMethodId,
			redact: (value: string) => {
				const r = token.redactor();
				return Buffer.concat([r.push(value), r.finish()]).toString('utf8');
			},
			stream: () => {
				const r = token.redactor(),
					decoder = new StringDecoder('utf8');
				return {
					push: (v: string) => decoder.write(r.push(v)),
					finish: () => decoder.end(r.finish()),
				};
			},
			release: () => {
				for (const key of Object.keys(environment)) delete environment[key];
				token.release();
			},
		};
	});
}

/** Memories use the same confined helper and lifetime as Files. */
function memoryHelper(files: BotFilesService): BotMemoryHelper {
	return {
		acquire: async (id) => {
			const view = await files.acquire(id);
			const ready = async () => {
				try {
					await view.stat('memories');
				} catch {
					await view.mkdir('memories');
				}
			};
			await ready();
			return {
				list: async () =>
					(await view.list('memories')).entries.map((e) => ({
						name: e.name,
						type: e.kind === 'file' ? 'file' : e.kind,
						modifiedAt: e.mtime,
					})),
				readText: async (path, max) => {
					const chunks: Uint8Array[] = [];
					let bytes = 0;
					for await (const chunk of view.read(path)) {
						bytes += chunk.length;
						if (bytes > max) throw new Error('memory exceeds limit');
						chunks.push(chunk);
					}
					return Buffer.concat(chunks).toString('utf8');
				},
				writeText: async (path, contents) => {
					const value = Buffer.from(contents);
					await view.write(
						path,
						value.length,
						(async function* () {
							yield value;
						})(),
					);
				},
				remove: (path) => view.delete(path),
				watch: (_path, changed) => {
					let closed = false;
					let stop: (() => void) | undefined;
					void view
						.watch(['memories'], changed)
						.then((s) => {
							if (closed) s();
							else stop = s;
						})
						.catch(() => {
							if (!closed) changed();
						});
					return () => {
						closed = true;
						stop?.();
					};
				},
				release: () => view.close(),
			};
		},
	};
}

/** Installed, validated declarations remain visible while a child is disabled
 * or unavailable; only the manager can answer runtime calls. */
export async function installedBotAgentCatalog(
	installer: Pick<ExtensionInstaller, 'snapshot'>,
) {
	const snapshot = await installer.snapshot();
	return Object.values(snapshot.extensions).flatMap((record) => {
		const slot = record.activeSlotId
			? record.slots[record.activeSlotId]
			: undefined;
		const manifest = slot?.receipt.manifest;
		return (manifest?.contributes.botAgents ?? []).map((contribution) => ({
			extensionId: record.extensionId,
			extensionName: manifest!.displayName,
			contribution,
			enabled: record.enabled,
		}));
	});
}
