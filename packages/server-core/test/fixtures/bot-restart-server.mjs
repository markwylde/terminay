import { runtime, until } from './bot-test-runtime.mjs';

const r = await runtime(process.argv[2], { env: { FAKE_IGNORE_EOF: '1' } });
let bot = r.bots.list()[0];
if (!bot)
	bot = await r.service.save({
		name: 'Bird',
		agentId: 'fake.agent',
		signIn: { kind: 'token', environmentVariable: 'FAKE_KEY' },
		approvalMode: 'ask',
	});
if (process.argv[3] === 'first') {
	const active = await r.service.send(bot.id, 'permission');
	await until(
		r.service,
		'changed',
		() => r.sessions.get(active.sessionId).state === 'needs-you',
	);
	for(let n=0;n<3;n++)await r.service.send(bot.id,'hold');
    await r.service.send(bot.id,'queued message');
	await r.service.send(bot.id, 'trigger prompt', undefined, {
		kind: 'trigger',
		triggerId: 'tick',
		triggerName: 'Tick',
		fireTime: 1,
	});
	const pid = r.children.get(active.sessionId).pid;
	process.send({ kind: 'ready', botId: bot.id, active: active.sessionId, pid });
} else {
	process.send({
		kind: 'restored',
		sessions: r.sessions.list(bot.id),
		calls: r.calls,
		activity: r.activity,
	});
	await r.service.shutdown();
	process.disconnect();
}
