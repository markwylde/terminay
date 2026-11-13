import assert from 'node:assert/strict';
import test from 'node:test';
import { SocketDriver } from '../dist/botService/index.js';

const containers = [
	{ Id: 'empty-a', Labels: { a: '' } },
	{ Id: 'a1', Labels: { a: '1' } },
	{ Id: 'bxy', Labels: { b: 'x=y' } },
	{ Id: 'bx', Labels: { b: 'x' } },
	{ Id: 'none', Labels: null },
	{ Id: 'missing' },
];

function driver(list = containers) {
	const routes = [];
	const d = new SocketDriver(
		{ pin: { kind: 'docker', address: 'unix:///fake', connection: false } },
		{
			json: async (method, route) => {
				routes.push({ method, url: new URL(route, 'http://engine') });
				return list;
			},
		},
	);
	return { d, routes };
}

test('label exclusions never reach the engine and positive filters pass through unchanged', async () => {
	const { d, routes } = driver();
	await d.run([
		'container',
		'ls',
		'-aq',
		'--filter',
		'label=terminay.server=s1',
		'--filter',
		'label=terminay.bot',
		'--filter',
		'name=terminay-bot-x',
		'--filter',
		'label!=terminay.helper',
	]);
	assert.equal(routes.length, 1);
	const { method, url } = routes[0];
	assert.equal(method, 'GET');
	assert.equal(url.pathname, '/containers/json');
	assert.equal(url.searchParams.get('all'), 'true');
	assert.deepEqual(JSON.parse(url.searchParams.get('filters')), {
		label: ['terminay.server=s1', 'terminay.bot'],
		name: ['terminay-bot-x'],
	});
});

test('key and value exclusions follow the engine label semantics', async () => {
	const { d } = driver();
	const ids = (
		await d.run([
			'container',
			'ls',
			'-aq',
			'--filter',
			'label!=a',
			'--filter',
			'label!=b=x=y',
		])
	).split('\n');
	// `a` excludes any value, including empty; `b=x=y` matches only that exact
	// value (split on the first `=`); a container without labels matches none.
	assert.deepEqual(ids, ['bx', 'none', 'missing']);
});

test('a value exclusion leaves other values of the same key', async () => {
	const { d } = driver();
	const ids = (
		await d.run(['container', 'ls', '-aq', '--filter', 'label!=a=1'])
	).split('\n');
	assert.deepEqual(ids, ['empty-a', 'bxy', 'bx', 'none', 'missing']);
});

test('without exclusions every listed container is returned', async () => {
	const { d, routes } = driver();
	const ids = (await d.run(['container', 'ls', '-q'])).split('\n');
	assert.deepEqual(
		ids,
		containers.map((c) => c.Id),
	);
	assert.equal(routes[0].url.searchParams.get('all'), 'false');
	assert.deepEqual(JSON.parse(routes[0].url.searchParams.get('filters')), {});
});
