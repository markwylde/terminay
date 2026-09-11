export interface OfficialExtensionCatalogueRecord {
	readonly extensionId: string;
	readonly packageName: string;
	readonly displayName: string;
	readonly description: string;
	readonly publisher: 'Terminay';
	readonly official: true;
}

/** Catalogue membership is presentation metadata, never extra runtime authority. */
export const OFFICIAL_EXTENSION_CATALOGUE: readonly OfficialExtensionCatalogueRecord[] =
	Object.freeze([
		Object.freeze({
			extensionId: 'com.terminay.agent.codex',
			packageName: 'terminay-agent-codex',
			displayName: 'Codex',
			description: 'Show Codex CLI sessions in the Agents sidebar.',
			publisher: 'Terminay',
			official: true,
		}),
		Object.freeze({
			extensionId: 'com.terminay.agent.claude-code',
			packageName: 'terminay-agent-claude-code',
			displayName: 'Claude Code',
			description: 'Show Claude Code sessions in the Agents sidebar.',
			publisher: 'Terminay',
			official: true,
		}),
		Object.freeze({
			extensionId: 'com.terminay.agent.grok',
			packageName: 'terminay-agent-grok',
			displayName: 'Grok',
			description: 'Show Grok CLI sessions in the Agents sidebar.',
			publisher: 'Terminay',
			official: true,
		}),
		Object.freeze({
			extensionId: 'com.terminay.agent.opencode',
			packageName: 'terminay-agent-opencode',
			displayName: 'OpenCode',
			description: 'Show OpenCode CLI sessions in the Agents sidebar.',
			publisher: 'Terminay',
			official: true,
		}),
		Object.freeze({
			extensionId: 'com.terminay.agent.omp',
			packageName: 'terminay-agent-omp',
			displayName: 'omp',
			description: 'Show omp sessions in the Agents sidebar.',
			publisher: 'Terminay',
			official: true,
		}),
		Object.freeze({
			extensionId: 'com.terminay.language.typescript',
			packageName: 'terminay-language-typescript',
			displayName: 'TypeScript',
			description:
				'Diagnostics, completion, hover, and go-to-definition for TypeScript and JavaScript.',
			publisher: 'Terminay',
			official: true,
		}),
	]);
