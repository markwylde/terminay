import { defineExtension } from '@terminay/extension-api';

// Illustrative package and model names. This example never launches a process.
export default defineExtension({
	activate(context) {
		context.subscriptions.add(
			context.agents.registerBotAgent('com.example.bot/example', {
				async models(signal) {
					signal.throwIfAborted();
					return [{ id: 'small', displayName: 'Small' }];
				},
				async status(signal) {
					signal.throwIfAborted();
					// A real extension reports its CLI sign-in metadata; it receives no bot token.
					return {
						state: 'not_signed_in',
						detail: 'Sign in with the Example CLI or configure a bot API key.',
					};
				},
				async launch({ modelId }, signal) {
					signal.throwIfAborted();
					// The host uses this only when ACP has no session model configuration.
					return {
						args: modelId === null ? [] : ['--model', modelId],
						env: {},
					};
				},
			}),
		);
	},
});
