#!/usr/bin/env node
import { HELP_TEXT, UsageError, parseCommandLine } from './args.js';
import { ScopeError } from './account.js';
import { runInstall } from './commands/install.js';
import { runStart, runStatus, runStop } from './commands/lifecycle.js';
import { runApprovals, runPairing, runResolveApproval } from './commands/pairing.js';
import { runResetIdentity, runUninstall } from './commands/uninstall.js';
import { runUpgrade } from './commands/upgrade.js';
import { NotInstalledError, resolveContext } from './context.js';
import { ManifestError } from './manifest.js';
import { UnsupportedHostError, assertSupportedHost } from './platform.js';
import { SocketError } from './socket.js';
import { VerificationError } from './verify.js';

/**
 * The `terminay` binary.
 *
 * Every daemon command passes the platform gate first, so an operator who runs
 * this on their laptop is told immediately rather than part-way through an
 * install. Failures print one clear line and exit non-zero; the stack trace is
 * not the operator's problem.
 */

const write = (line: string) => process.stdout.write(`${line}\n`);

async function main(argv: readonly string[]): Promise<number> {
	const parsed = parseCommandLine(argv);
	if (parsed.command === 'help') {
		process.stdout.write(HELP_TEXT);
		return 0;
	}

	assertSupportedHost();

	if (parsed.command === 'install') {
		const result = await runInstall(parsed.ref, parsed.options, { write });
		return result.ready ? 0 : 1;
	}

	const context = await resolveContext({ options: parsed.options, write });

	switch (parsed.command) {
		case 'upgrade':
			await runUpgrade(parsed.ref, parsed.options, context);
			return 0;
		case 'start':
			return (await runStart(context)) ? 0 : 1;
		case 'stop':
			await runStop(context);
			return 0;
		case 'status':
			await runStatus(context);
			return 0;
		case 'uninstall':
			await runUninstall(parsed.options, context);
			return 0;
		case 'qr-code':
			await runPairing(parsed.options, context);
			return 0;
		case 'approvals':
			await runApprovals(context);
			return 0;
		case 'approve':
		case 'deny':
			await runResolveApproval(parsed.command, parsed.approvalId as string, context);
			return 0;
		case 'reset-identity':
			await runResetIdentity(parsed.options, context);
			return 0;
	}
}

/** Errors the operator caused or must act on print as one line, not a trace. */
const EXPECTED_ERRORS = [
	UsageError,
	UnsupportedHostError,
	ScopeError,
	NotInstalledError,
	VerificationError,
	ManifestError,
	SocketError,
];

try {
	process.exitCode = await main(process.argv.slice(2));
} catch (error) {
	const expected = EXPECTED_ERRORS.some((kind) => error instanceof kind) || (error instanceof Error && error.name.endsWith('Error'));
	process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
	if (error instanceof UsageError) process.stderr.write('\nRun `terminay --help` for usage.\n');
	if (!expected && error instanceof Error && error.stack !== undefined && process.env.TERMINAY_DEBUG === '1') {
		process.stderr.write(`${error.stack}\n`);
	}
	process.exitCode = 1;
}
