import { cp, rm } from 'node:fs/promises';

const source = new URL('../docker/terminay-bot/', import.meta.url);
const target = new URL(
	'../packages/server-core/dist/botService/image-context/',
	import.meta.url,
);
await rm(target, { recursive: true, force: true });
await cp(source, target, { recursive: true });

await cp(
	new URL(
		'../packages/server-core/src/botService/LICENSE.playwright',
		import.meta.url,
	),
	new URL(
		'../packages/server-core/dist/botService/LICENSE.playwright',
		import.meta.url,
	),
);
