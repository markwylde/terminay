import { namespacedId } from './constants.js';
import type {
	AgentSessionSourceContribution,
	LanguageServerContribution,
	McpInstallTargetContribution,
	TerminayExtensionManifest,
} from './types.js';

export const fixtureExtensionId = 'dev.terminay.fixture';

/** A harness-neutral session source contribution for public agent SDK conformance. */
export const validAgentSessionSourceContributionFixture: AgentSessionSourceContribution =
	Object.freeze({
		id: namespacedId(fixtureExtensionId, 'agents'),
		displayName: 'Fixture Agents',
		harnesses: [
			{ id: 'fixture-agent', displayName: 'Fixture Agent' },
			{ id: 'other-agent', displayName: 'Other Agent' },
		],
		environmentVariables: ['FIXTURE_AGENT_HOME'],
	} satisfies AgentSessionSourceContribution);

/** A client-neutral MCP install target contribution. */
export const validMcpInstallTargetContributionFixture: McpInstallTargetContribution =
	Object.freeze({
		id: namespacedId(fixtureExtensionId, 'fixture-client'),
		displayName: 'Fixture Client',
	} satisfies McpInstallTargetContribution);

export const validManifestFixture: TerminayExtensionManifest = Object.freeze({
	manifestVersion: 1,
	id: fixtureExtensionId,
	displayName: 'Fixture Agent Extension',
	description: 'A portable conformance fixture.',
	api: '^3.0.0',
	engines: { terminay: '>=1.0.0', node: '>=22' },
	entrypoint: 'dist/extension.js',
	permissions: ['agent-observation', 'mcp-registration'],
	contributes: {
		agentSessionSources: [validAgentSessionSourceContributionFixture],
		mcpInstallTargets: [validMcpInstallTargetContributionFixture],
	},
} satisfies TerminayExtensionManifest);

/** The agent manifest under its historical name, kept for existing callers. */
export const validAgentManifestFixture: TerminayExtensionManifest =
	validManifestFixture;

export const languageServerFixtureExtensionId = 'dev.terminay.language-fixture';
export const languageServerFixtureId = 'fixture-language';

/** A language-neutral manifest contribution for public language SDK conformance. */
export const validLanguageServerContributionFixture: LanguageServerContribution =
	Object.freeze({
		id: languageServerFixtureId,
		displayName: 'Fixture Language',
		description: 'A portable language server conformance fixture.',
		languageIds: ['fixturelang'],
		fileExtensions: ['.fixture'],
		runtimeNotes: 'Runs a stub language server bundled with the fixture.',
	} satisfies LanguageServerContribution);

export const validLanguageServerManifestFixture: TerminayExtensionManifest =
	Object.freeze({
		manifestVersion: 1,
		id: languageServerFixtureExtensionId,
		displayName: 'Fixture Language Extension',
		description: 'A portable language server conformance fixture.',
		api: '^3.0.0',
		engines: { terminay: '>=1.0.0', node: '>=22' },
		entrypoint: 'dist/extension.js',
		permissions: [],
		contributes: {
			languageServers: [validLanguageServerContributionFixture],
		},
	} satisfies TerminayExtensionManifest);

export const hostileManifestFixtures: Readonly<Record<string, unknown>> =
	Object.freeze({
		unknownField: { ...validManifestFixture, renderer: './render.js' },
		escapingEntrypoint: { ...validManifestFixture, entrypoint: '../server.js' },
		/** The removed project-environment contribution kind is now an unknown key. */
		projectEnvironments: {
			...validManifestFixture,
			contributes: {
				...validManifestFixture.contributes,
				projectEnvironments: [
					{
						id: namespacedId(fixtureExtensionId, 'fixture'),
						displayName: 'Fixture',
						capabilities: ['terminal', 'filesystem'],
					},
				],
			},
		},
		wrongNamespace: {
			...validManifestFixture,
			contributes: {
				agentSessionSources: [
					{
						...validAgentSessionSourceContributionFixture,
						id: 'example.other/agents',
					},
				],
			},
		},
		coreCollision: {
			...validManifestFixture,
			contributes: {
				agentSessionSources: [
					{
						...validAgentSessionSourceContributionFixture,
						id: 'terminal.create',
					},
				],
			},
		},
		/** The terminal-scoped provider contribution kind was removed in 3.0. */
		agentProviders: {
			...validManifestFixture,
			contributes: {
				agentProviders: [
					{
						id: namespacedId(fixtureExtensionId, 'agent'),
						displayName: 'Fixture Agent',
						processMatchers: [{ executableName: 'fixture-agent' }],
					},
				],
			},
		},
		missingAgentObservation: {
			...validManifestFixture,
			permissions: ['mcp-registration'],
		},
		missingMcpRegistration: {
			...validManifestFixture,
			permissions: ['agent-observation'],
		},
		unknownPermission: {
			...validManifestFixture,
			permissions: ['server:everything'],
		},
		/** A file selector is an extension, never a path or a glob. */
		languageServerPathSelector: {
			...validLanguageServerManifestFixture,
			contributes: {
				languageServers: [
					{
						...validLanguageServerContributionFixture,
						fileExtensions: ['src/**/*.fixture'],
					},
				],
			},
		},
		/** A language server serves at least one language and one extension. */
		languageServerEmptySelectors: {
			...validLanguageServerManifestFixture,
			contributes: {
				languageServers: [
					{
						...validLanguageServerContributionFixture,
						languageIds: [],
						fileExtensions: [],
					},
				],
			},
		},
	});
