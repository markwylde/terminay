import assert from 'node:assert/strict';
import test from 'node:test';

import { UnsupportedHostError, assertSupportedHost, hostArchitecture } from '../dist/platform.js';

const linux = { platform: 'linux', arch: 'x64', hasSystemd: true };

test('a systemd Linux host on x64 or arm64 proceeds', () => {
	assert.doesNotThrow(() => assertSupportedHost(linux));
	assert.doesNotThrow(() => assertSupportedHost({ ...linux, arch: 'arm64' }));
	assert.equal(hostArchitecture(linux), 'x64');
	assert.equal(hostArchitecture({ ...linux, arch: 'arm64' }), 'arm64');
});

test('other operating systems are refused and named', () => {
	for (const platform of ['darwin', 'win32', 'freebsd']) {
		assert.throws(
			() => assertSupportedHost({ ...linux, platform }),
			(error) => error instanceof UnsupportedHostError && error.message.includes('Linux with systemd') && error.message.includes(platform),
			platform,
		);
	}
});

test('unsupported architectures are refused and named', () => {
	assert.throws(
		() => assertSupportedHost({ ...linux, arch: 'ia32' }),
		(error) => error instanceof UnsupportedHostError && error.message.includes('x64 and arm64') && error.message.includes('ia32'),
	);
});

test('a Linux host without systemd is refused and told why', () => {
	assert.throws(
		() => assertSupportedHost({ ...linux, hasSystemd: false }),
		(error) => error instanceof UnsupportedHostError && error.message.includes('/run/systemd/system'),
	);
});
