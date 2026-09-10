import { namespacedId } from './constants.js';
import type {
	AgentProviderContribution,
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
	});
