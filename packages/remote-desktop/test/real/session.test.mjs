/**
 * The shared desktop session script on a real display: it brings up the XFCE
 * desktop from the parameters it is given, and with no extra services it
 * opens no TCP listener.
 */

import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import {
	DESKTOP_SESSION_SCRIPT,
	desktopSessionDirectory,
} from '../../dist/session/index.js';
import { realDisplayUnavailable, startDisplay } from '../support/display.mjs';
import { settle } from '../support/viewer.mjs';

const run = promisify(execFile);
const script = path.join(desktopSessionDirectory(), DESKTOP_SESSION_SCRIPT);
const skip =
	realDisplayUnavailable() ??
	(existsSync('/usr/bin/xfwm4') ? undefined : 'missing the XFCE desktop');

/** TCP listening sockets in this network namespace. */
async function tcpListeners() {
	const { stdout } = await run('ss', ['-H', '-ltn']);
	return stdout.split('\n').filter(Boolean);
}

async function startSession(t, display, extra = {}) {
	const home = await mkdtemp(path.join(tmpdir(), 'terminay-session-'));
	t.after(() => rm(home, { recursive: true, force: true }));
	const runtime = path.join(home, 'runtime');
	await mkdir(runtime, { mode: 0o700 });
	const state = path.join(home, 'state');
	// Through the shell, as its owner starts it: a release archive does not
	// keep the script's execute bit.
	const child = spawn('bash', [script], {
		env: {
			PATH: process.env.PATH,
			HOME: home,
			XAUTHORITY: display.cookie,
			XDG_RUNTIME_DIR: runtime,
			TERMINAY_DESKTOP_DISPLAY: display.display,
			TERMINAY_DESKTOP_STATE_DIR: state,
			TERMINAY_DESKTOP_HOME: home,
			...extra,
		},
		stdio: ['ignore', 'pipe', 'pipe'],
		// Its own process group, so the whole session can be ended at once.
		detached: true,
	});
	const log = [];
	child.stdout.on('data', (chunk) => log.push(chunk));
	child.stderr.on('data', (chunk) => log.push(chunk));
	// Debian 12's dbus-run-session does not pass a signal on to the session
	// it wraps, so the session is ended as a group, as its owner ends it.
	const stop = () => {
		try {
			process.kill(-child.pid, 'SIGTERM');
		} catch {
			// Already gone.
		}
	};
	t.after(stop);
	// The window manager and the panel are up when both own their windows.
	const deadline = Date.now() + 30_000;
	while (true) {
		const tree = await display.x('xwininfo', ['-root', '-tree']).catch(() => '');
		if (/xfwm4/i.test(tree) && /xfce4-panel/i.test(tree)) break;
		if (child.exitCode !== null || Date.now() > deadline)
			throw new Error(
				`session did not start: ${Buffer.concat(log).toString().slice(-800)}`,
			);
		await settle(250);
	}
	return { child, home, state, stop };
}

test('the session script ships in the compiled package, with nothing of the bot image in it', async () => {
	const text = await readFile(script, 'utf8');
	assert.match(text, /^#!\/usr\/bin\/env bash/);
	assert.match(text, /TERMINAY_DESKTOP_DISPLAY/);
	// Nothing in the shared script belongs to the bot image.
	assert.doesNotMatch(text, /9223|terminay-browser|\/home\/bot|desktop-control/);
});

test('with no extra services the session starts the desktop and opens no TCP listener', { skip }, async (t) => {
	const display = await startDisplay();
	t.after(() => display.stop());
	const before = await tcpListeners();
	const { child, state, stop } = await startSession(t, display);
	await settle(1500);
	assert.deepEqual(await tcpListeners(), before);
	assert.deepEqual(before, [], 'nothing listens on TCP at all');
	// The generated configuration is the shared one, in the given state directory.
	assert.match(
		await readFile(
			path.join(state, 'config/xfce4/xfconf/xfce-perchannel-xml/xfwm4.xml'),
			'utf8',
		),
		/use_compositing" type="bool" value="false"/,
	);
	stop();
	await once(child, 'close');
	await settle(500);
	// Ending the group leaves none of the desktop behind.
	const left = await run('pgrep', ['-x', 'xfwm4|xfce4-panel|xfdesktop|xfsettingsd']).then(
		({ stdout }) => stdout.trim(),
		() => '',
	);
	assert.equal(left, '');
});

test('launchers and services are what the caller passes: entries reach the menu, a service runs with the session and its loss ends it', { skip }, async (t) => {
	const display = await startDisplay();
	t.after(() => display.stop());
	const extras = await mkdtemp(path.join(tmpdir(), 'terminay-extras-'));
	t.after(() => rm(extras, { recursive: true, force: true }));
	const launchers = path.join(extras, 'launchers');
	const services = path.join(extras, 'services');
	await mkdir(launchers);
	await mkdir(services);
	await writeFile(
		path.join(launchers, 'example.desktop'),
		'[Desktop Entry]\nType=Application\nName=Example\nExec=true\n',
	);
	await writeFile(path.join(launchers, 'hidden'), '# stock\nxterm.desktop\n');
	const marker = path.join(extras, 'ran');
	const service = path.join(services, 'example');
	await writeFile(
		service,
		`#!/bin/sh\nprintf '%s %s' "$DISPLAY" "$PWD" > ${marker}\nsleep 3\n`,
	);
	await chmod(service, 0o755);
	const { child, home, state } = await startSession(t, display, {
		TERMINAY_DESKTOP_LAUNCHERS: launchers,
		TERMINAY_DESKTOP_SERVICES: services,
	});
	const applications = path.join(state, 'data/applications');
	assert.match(
		await readFile(path.join(applications, 'example.desktop'), 'utf8'),
		/Name=Example/,
	);
	assert.match(
		await readFile(path.join(applications, 'xterm.desktop'), 'utf8'),
		/Hidden=true/,
	);
	const [code] = await once(child, 'close');
	assert.equal(code, 78);
	assert.equal(await readFile(marker, 'utf8'), `${display.display} ${home}`);
});
