import { defineExtension } from '@terminay/extension-api';
import {
	exampleMcpInstallTarget,
	exampleSessionSource,
} from './example-agent.js';

export default defineExtension({
	activate(context) {
		context.subscriptions.add(
			context.agents.registerSessionSource(
				'com.example.agent/sessions',
				exampleSessionSource,
			),
		);
		context.subscriptions.add(
			context.mcp.registerInstallTarget(
				'com.example.agent/example-agent',
				exampleMcpInstallTarget,
			),
		);
	},
});
