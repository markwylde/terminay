// Prints the system-scope unit exactly as the installer renders it for a
// release whose manifest sets sharedTmpSafe.
import { renderUnit } from '../../../../apps/terminay-cli/src/unit.ts';

process.stdout.write(
	renderUnit({
		layout: {
			scope: 'system',
			environmentFile: '/etc/terminay/server.env',
			currentLink: '/opt/terminay/current',
		} as never,
		runAs: 'terminay',
		workingDirectory: '/var/lib/terminay',
		sharedTmpSafe: true,
	}),
);
