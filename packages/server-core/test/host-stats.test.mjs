import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { HOST_STATS_EVENTS, HOST_STATS_OPERATIONS } from '@terminay/protocol';
import {
	HostStatsService,
	createServerCoreComposition,
	createLinuxHostCounterReader,
	parseDarwinIoreg,
	parseDarwinNetstat,
	parseDarwinSysctlMemory,
	parseLinuxDiskstats,
	parseLinuxMeminfo,
	parseLinuxNetDev,
} from '../dist/index.js';

const NET_DEV = `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo:  552768    2917    0    0    0     0          0         0   552768    2917    0    0    0     0       0          0
  eth0: 2000  420981    0  315    0     0          0         0 500  257375    0    0    0     0       0          0
docker0: 300   49135    0    0    0     0          0         0 100  115591    0    7    0     0       0          0
`;

const DISKSTATS = ` 254       0 vda 25744 8190 1000 2854 170048 660977 2000 853464 0 169596 1002213 47408 0 1724949760 2846 50070 143047
 254       1 vda1 21665 8129 900 2634 169459 660863 1900 852856 0 176900 858337 47403 0 1724714848 2846 0 0
 259       0 nvme0n1 1 0 10 0 1 0 20 0 0 0 0
 259       1 nvme0n1p1 1 0 10 0 1 0 20 0 0 0 0
   7       0 loop0 1 0 99999 0 1 0 99999 0 0 0 0
 253       0 dm-0 1 0 99999 0 1 0 99999 0 0 0 0
  11       0 sr0 41 0 308 5 0 0 0 0 0 4 5 0 0 0 0 0 0
`;

test('Linux meminfo: used is total less available', () => {
	assert.deepEqual(
		parseLinuxMeminfo('MemTotal:       1000 kB\nMemFree:  10 kB\nMemAvailable:   400 kB\n'),
		{ totalBytes: 1000 * 1024, usedBytes: 600 * 1024 },
	);
	assert.equal(parseLinuxMeminfo('nonsense'), null);
});

test('Linux net/dev: loopback is never counted, a filter picks interfaces', () => {
	assert.deepEqual(parseLinuxNetDev(NET_DEV), { receivedBytes: 2300, sentBytes: 600 });
	assert.deepEqual(parseLinuxNetDev(NET_DEV, (name) => name === 'eth0'), {
		receivedBytes: 2000,
		sentBytes: 500,
	});
	assert.equal(parseLinuxNetDev('garbage'), null);
});

test('Linux diskstats: whole disks only, in bytes', () => {
	assert.deepEqual(parseLinuxDiskstats(DISKSTATS), {
		readBytes: (1000 + 10) * 512,
		writtenBytes: (2000 + 20) * 512,
	});
	assert.equal(parseLinuxDiskstats(''), null);
});

test('Linux reader counts physical interfaces, or all but loopback in a container', async () => {
	const root = await mkdtemp(join(tmpdir(), 'terminay-host-stats-'));
	try {
		const proc = join(root, 'proc');
		const sys = join(root, 'sys');
		await mkdir(join(proc, 'net'), { recursive: true });
		await mkdir(join(sys, 'devices', 'virtual', 'net', 'docker0'), { recursive: true });
		await mkdir(join(sys, 'devices', 'virtual', 'net', 'lo'), { recursive: true });
		await writeFile(join(proc, 'meminfo'), 'MemTotal: 100 kB\nMemAvailable: 25 kB\n');
		await writeFile(join(proc, 'net', 'dev'), NET_DEV);
		await writeFile(join(proc, 'diskstats'), DISKSTATS);
		const host = await createLinuxHostCounterReader(proc, sys).read();
		assert.deepEqual(host.network, { receivedBytes: 2000, sentBytes: 500 });
		assert.deepEqual(host.memory, { totalBytes: 102400, usedBytes: 76800 });
		assert.ok(host.cpu.cores > 0);

		await mkdir(join(sys, 'devices', 'virtual', 'net', 'eth0'), { recursive: true });
		const container = await createLinuxHostCounterReader(proc, sys).read();
		assert.deepEqual(container.network, { receivedBytes: 2300, sentBytes: 600 });

		const missing = await createLinuxHostCounterReader(join(root, 'none'), sys).read();
		assert.equal(missing.memory, null);
		assert.equal(missing.network, null);
		assert.equal(missing.disk, null);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('macOS sysctl memory: free, speculative, purgeable and file-backed pages are available', () => {
	assert.deepEqual(parseDarwinSysctlMemory('16384\n100\n10\n5\n85\n', 16384 * 1000), {
		totalBytes: 16384 * 1000,
		usedBytes: 16384 * 800,
	});
	assert.equal(parseDarwinSysctlMemory('16384\n100\n', 1000), null);
	assert.equal(parseDarwinSysctlMemory('', 1000), null);
});

test('macOS netstat -ibn: link rows, counted from the right, without loopback', () => {
	const text = `Name       Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll
lo0        16384 <Link#1>                         1000     0     999999     1000     0     999999     0
lo0        16384 127           127.0.0.1          1000     -     999999     1000     -     999999     -
en0        1500  <Link#6>    a4:83:e7:00:00:01    5000     0    2000000     4000     0     300000     0
en0        1500  192.168.1     192.168.1.5        5000     -    2000000     4000     -     300000     -
utun0      1380  <Link#15>                           10     0       1000       20     0       2000     0
`;
	assert.deepEqual(parseDarwinNetstat(text), { receivedBytes: 2001000, sentBytes: 302000 });
	assert.equal(parseDarwinNetstat('nothing here'), null);
});

test('macOS ioreg: each block storage driver is a disk', () => {
	const text = `+-o IOBlockStorageDriver  <class IOBlockStorageDriver>
    {
      "Statistics" = {"Operations (Write)"=1,"Bytes (Read)"=1000,"Bytes (Write)"=200,"Operations (Read)"=3}
    }
+-o IOBlockStorageDriver  <class IOBlockStorageDriver>
    {
      "Statistics" = {"Bytes (Read)"=5,"Bytes (Write)"=7}
    }
`;
	assert.deepEqual(parseDarwinIoreg(text), { readBytes: 1005, writtenBytes: 207 });
	assert.equal(parseDarwinIoreg(''), null);
});

function harness(counters = []) {
	let clock = 0;
	let reads = 0;
	const timers = new Map();
	let nextTimer = 1;
	const published = [];
	const service = new HostStatsService({
		now: () => clock,
		reader: {
			async read() {
				const value = counters[Math.min(reads, counters.length - 1)];
				reads += 1;
				return value;
			},
		},
		setInterval: (handler, ms) => {
			const id = nextTimer++;
			timers.set(id, { handler, ms });
			return id;
		},
		clearInterval: (id) => timers.delete(id),
		eventJournal: {
			publishTransient: (event, payload) => {
				published.push({ event, payload });
				return { revision: 0, cursor: '', event, payload };
			},
		},
	});
	const settle = () => new Promise((resolve) => setImmediate(resolve));
	return {
		service,
		published,
		timers,
		get reads() {
			return reads;
		},
		advance: async (ms) => {
			clock += ms;
			for (const { handler } of timers.values()) handler();
			await settle();
		},
		settle,
	};
}

const counter = (busy, total, received, sent, read, written) => ({
	cpu: { busy, total, cores: 4 },
	memory: { usedBytes: 50, totalBytes: 100 },
	network: { receivedBytes: received, sentBytes: sent },
	disk: { readBytes: read, writtenBytes: written },
});

test('no watcher, no timer and no reads', async () => {
	const h = harness([counter(0, 0, 0, 0, 0, 0)]);
	await h.settle();
	assert.equal(h.timers.size, 0);
	assert.equal(h.reads, 0);
	assert.equal(h.service.intervalMs, undefined);
});

test('a watch takes a baseline, then publishes rates each interval', async () => {
	const h = harness([
		counter(0, 0, 0, 0, 0, 0),
		counter(50, 200, 5000, 1000, 2500, 500),
	]);
	assert.equal(h.service.watch('c1', 5), 5);
	await h.settle();
	assert.equal(h.reads, 1);
	assert.equal(h.published.length, 0);
	assert.equal(h.service.intervalMs, 5000);
	await h.advance(5000);
	assert.equal(h.published.length, 1);
	assert.equal(h.published[0].event, HOST_STATS_EVENTS.sample);
	assert.deepEqual(h.published[0].payload, {
		at: 5000,
		intervalMs: 5000,
		cpu: { percent: 25, cores: 4 },
		memory: { usedBytes: 50, totalBytes: 100 },
		network: { receivedBytesPerSecond: 1000, sentBytesPerSecond: 200 },
		disk: { readBytesPerSecond: 500, writtenBytesPerSecond: 100 },
	});
});

test('the shortest interval wins and the last watcher leaving stops sampling', async () => {
	const h = harness([counter(0, 0, 0, 0, 0, 0)]);
	h.service.watch('c1', 5);
	h.service.watch('c2', 2);
	assert.equal(h.service.intervalMs, 2000);
	assert.equal(h.timers.size, 1);
	h.service.unwatch('c2');
	assert.equal(h.service.intervalMs, 5000);
	assert.equal(h.timers.size, 1);
	h.service.closeConnection('c1');
	assert.equal(h.service.intervalMs, undefined);
	assert.equal(h.timers.size, 0);
	const reads = h.reads;
	await h.advance(10_000);
	assert.equal(h.reads, reads);
});

test('intervals are clamped to 1–3600 whole seconds', () => {
	const h = harness([counter(0, 0, 0, 0, 0, 0)]);
	assert.equal(h.service.watch('c1', 0.2), 1);
	assert.equal(h.service.intervalMs, 1000);
	assert.equal(h.service.watch('c1', 1e9), 3600);
	assert.equal(h.service.intervalMs, 3_600_000);
	h.service.dispose();
	assert.equal(h.timers.size, 0);
});

test('a counter that goes backwards reads as zero, not negative', async () => {
	const h = harness([counter(0, 0, 9000, 9000, 9000, 9000), counter(10, 20, 10, 10, 10, 10)]);
	h.service.watch('c1', 1);
	await h.settle();
	await h.advance(1000);
	const { network, disk } = h.published[0].payload;
	assert.deepEqual(network, { receivedBytesPerSecond: 0, sentBytesPerSecond: 0 });
	assert.deepEqual(disk, { readBytesPerSecond: 0, writtenBytesPerSecond: 0 });
});

test('watch and unwatch are read-scoped commands keyed by connection', async () => {
	const h = harness([counter(0, 0, 0, 0, 0, 0)]);
	const { commands, policies } = h.service.operations();
	const request = (operation, payload, connectionId = 'conn-1') => ({
		envelope: { operation, payload },
		body: new Uint8Array(),
		context: { connectionId, clientId: 'client', authScope: 'read', signal: new AbortController().signal },
	});
	assert.deepEqual(commands[HOST_STATS_OPERATIONS.watch](request(HOST_STATS_OPERATIONS.watch, { intervalSeconds: 3 })), {
		result: { intervalSeconds: 3 },
	});
	assert.equal(h.service.watcherCount, 1);
	assert.throws(() => commands[HOST_STATS_OPERATIONS.watch](request(HOST_STATS_OPERATIONS.watch, null)));
	commands[HOST_STATS_OPERATIONS.unwatch](request(HOST_STATS_OPERATIONS.unwatch, {}, 'conn-2'));
	assert.equal(h.service.watcherCount, 1);
	commands[HOST_STATS_OPERATIONS.unwatch](request(HOST_STATS_OPERATIONS.unwatch, {}));
	assert.equal(h.service.watcherCount, 0);
	assert.equal(policies[HOST_STATS_OPERATIONS.watch].scope, 'read');
	assert.equal(policies[HOST_STATS_OPERATIONS.unwatch].scope, 'read');
});

test('a composed server serves host stats, and a closed connection stops its sampling', async (t) => {
	const h = harness([counter(0, 0, 0, 0, 0, 0)]);
	const composition = createServerCoreComposition({
		allowUnresolvedTestSessions: true,
		serverId: 'host-stats-server',
		serverVersion: '1.0.0',
		capabilities: ['desktop'],
		ptyFactory: { spawn() { throw new Error('no terminals in this test'); } },
		hostStats: h.service,
		authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: 'read' }),
	});
	t.after(() => composition.shutdown());
	assert.equal(composition.hostStats, h.service);
	assert.equal(composition.coreOptions.capabilities.includes('host-stats.v1'), true);
	const watch = composition.operations.commands.get(HOST_STATS_OPERATIONS.watch);
	await watch({
		envelope: { operation: HOST_STATS_OPERATIONS.watch, payload: { intervalSeconds: 5 } },
		body: new Uint8Array(),
		context: { connectionId: 'conn-1', clientId: 'client', authScope: 'read', signal: new AbortController().signal },
	});
	assert.equal(h.service.intervalMs, 5000);
	composition.coreOptions.onConnectionClosed('conn-1', 'client');
	assert.equal(h.service.intervalMs, undefined);
	assert.equal(h.timers.size, 0);
});
