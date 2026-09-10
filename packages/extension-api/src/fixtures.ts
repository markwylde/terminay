import { namespacedId } from './constants.js';
import type {
	AgentProviderContribution,
	LanguageServerContribution,
	TerminayExtensionManifest,
} from './types.js';

export const fixtureExtensionId = 'dev.terminay.fixture';

/** A provider-neutral manifest contribution for public agent SDK conformance. */
export const validAgentProviderContributionFixture: AgentProviderContribution =
	Object.freeze({
		id: namespacedId(fixtureExtensionId, 'agent'),
		displayName: 'Fixture Agent',
		processMatchers: [{ executableName: 'fixture-agent' }],
		mappings: [{ mappingVersion: '0.1', providerVersionRange: '>=0.1' }],
		requiredEnvironmentVariables: ['FIXTURE_AGENT_HOME'],
	} satisfies AgentProviderContribution);

export const validManifestFixture: TerminayExtensionManifest = Object.freeze({
	manifestVersion: 1,
	id: fixtureExtensionId,
	displayName: 'Fixture Agent Extension',
	description: 'A portable conformance fixture.',
	api: '^2.0.0',
	engines: { terminay: '>=1.0.0', node: '>=22' },
	entrypoint: 'dist/extension.js',
	permissions: ['agent-observation'],
	contributes: { agentProviders: [validAgentProviderContributionFixture] },
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
		api: '^2.1.0',
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
				agentProviders: [
					{
						...validAgentProviderContributionFixture,
						id: 'example.other/agent',
					},
				],
			},
		},
		coreCollision: {
			...validManifestFixture,
			contributes: {
				agentProviders: [
					{ ...validAgentProviderContributionFixture, id: 'terminal.create' },
				],
			},
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
