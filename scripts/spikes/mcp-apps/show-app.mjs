#!/usr/bin/env node
// The easy case: a plain (non-TUI) CLI that wants an app on "the next line".
// It asks the host how many rows the view needs, then prints the anchor line
// followed by that many blank rows, so the view sits in space it owns.
//
//   node scripts/spikes/mcp-apps/show-app.mjs system_monitor
//   node scripts/spikes/mcp-apps/show-app.mjs deploy_configurator '{"service":"api"}'

import { control } from './gateway.mjs';

const [name = 'system_monitor', rawArgs = '{}'] = process.argv.slice(2);

try {
	const result = await control('call-tool', {
		name,
		arguments: JSON.parse(rawArgs),
		reserve: true,
	});
	const { appId, rows } = result.spike;
	if (!appId) {
		console.log(result.content?.map((c) => c.text).join('\n'));
	} else {
		process.stdout.write(`▣ app:${appId} · ${name}\n${'\n'.repeat(rows)}`);
	}
} catch (error) {
	console.error(error.message);
	process.exitCode = 1;
}
