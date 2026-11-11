import { namespacedId } from './constants.js';
import type { ForgeItemSummary, ForgeSourceContribution } from './forge.js';
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

export const forgeFixtureExtensionId = 'dev.terminay.forge-fixture';
export const forgeFixtureOrigin = 'https://forge.example.net';

/** A provider-neutral forge source contribution. */
export const validForgeSourceContributionFixture: ForgeSourceContribution =
	Object.freeze({
		id: namespacedId(forgeFixtureExtensionId, 'forge'),
		displayName: 'Fixture Forge',
		kinds: ['pullRequest', 'issue'],
		allReach: 'readable',
	} satisfies ForgeSourceContribution);

export const validForgeManifestFixture: TerminayExtensionManifest =
	Object.freeze({
		manifestVersion: 1,
		id: forgeFixtureExtensionId,
		displayName: 'Fixture Forge Extension',
		api: '^3.7.0',
		engines: { terminay: '>=1.0.0', node: '>=22' },
		entrypoint: 'dist/extension.js',
		permissions: ['forge-source', 'network'],
		contributes: { forgeSources: [validForgeSourceContributionFixture] },
	} satisfies TerminayExtensionManifest);

/** A valid open pull request on the fixture origin, with a check hosted elsewhere. */
export const validForgePullRequestFixture: ForgeItemSummary = Object.freeze({
	reference: {
		kind: 'pullRequest',
		origin: forgeFixtureOrigin,
		owner: 'acme',
		name: 'app',
		number: 88,
	},
	title: 'Add event stream',
	url: `${forgeFixtureOrigin}/acme/app/pulls/88`,
	state: 'open',
	author: 'octo',
	labels: [{ name: 'feature', color: '0e8a16' }],
	comments: 2,
	createdAt: '2026-11-01T10:00:00Z',
	updatedAt: '2026-11-10T10:00:00Z',
	pullRequest: {
		headBranch: 'change/13-events',
		baseBranch: 'main',
		headOwner: 'acme',
		headName: 'app',
		headCommit: 'abcdef1',
		checks: {
			passed: 1,
			failed: 1,
			pending: 0,
			skipped: 0,
			total: 2,
			items: [
				{ name: 'build', state: 'passed' },
				{
					name: 'test',
					state: 'failed',
					url: 'https://ci.example.org/build/7',
				},
			],
		},
	},
} satisfies ForgeItemSummary);

/** A valid open issue on the fixture origin. */
export const validForgeIssueFixture: ForgeItemSummary = Object.freeze({
	reference: {
		kind: 'issue',
		origin: forgeFixtureOrigin,
		owner: 'acme',
		name: 'app',
		number: 541,
	},
	title: 'Home sidebar: Pull Requests and Issues sections',
	url: `${forgeFixtureOrigin}/acme/app/issues/541`,
	state: 'open',
	author: 'octo',
	labels: [],
	comments: 0,
	createdAt: '2026-11-02T10:00:00Z',
	updatedAt: '2026-11-09T10:00:00Z',
} satisfies ForgeItemSummary);
