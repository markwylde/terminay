const DEFAULT_PROFILE = Object.freeze({
	maxPendingReconnects: 1,
	maxAttempts: 4,
});

export function runSleepNetworkProbe(profile = DEFAULT_PROFILE) {
	if (
		!Number.isSafeInteger(profile.maxPendingReconnects) ||
		profile.maxPendingReconnects !== 1
	) {
		throw new RangeError(
			'sleep/network reconnect admission must be exactly one',
		);
	}
	if (!Number.isSafeInteger(profile.maxAttempts) || profile.maxAttempts < 2) {
		throw new RangeError('sleep/network probe requires at least two attempts');
	}

	let awake = true;
	let online = true;
	let connected = true;
	let pendingReconnects = 0;
	let generation = 0;
	let activeAttempt = null;
	const closedAttempts = [];
	const timeline = [];
	let maxPendingReconnects = 0;

	const requestReconnect = (reason) => {
		connected = false;
		pendingReconnects = Math.min(
			profile.maxPendingReconnects,
			pendingReconnects + 1,
		);
		maxPendingReconnects = Math.max(maxPendingReconnects, pendingReconnects);
		timeline.push(`request:${reason}`);
	};
	const beginAttempt = () => {
		if (!awake || !online || pendingReconnects === 0 || activeAttempt !== null)
			return null;
		if (generation >= profile.maxAttempts)
			throw new Error('sleep/network retry budget exhausted');
		activeAttempt = ++generation;
		pendingReconnects = 0;
		timeline.push(`attempt:${activeAttempt}`);
		return activeAttempt;
	};
	const closeAttempt = (attempt, reason) => {
		if (!closedAttempts.includes(attempt)) closedAttempts.push(attempt);
		if (activeAttempt === attempt) activeAttempt = null;
		timeline.push(`close:${attempt}:${reason}`);
	};
	const completeAttempt = (attempt) => {
		if (attempt !== activeAttempt || !awake || !online) {
			closeAttempt(attempt, 'stale');
			return false;
		}
		activeAttempt = null;
		connected = true;
		timeline.push(`connected:${attempt}`);
		return true;
	};

	requestReconnect('network-loss');
	const firstAttempt = beginAttempt();
	online = false;
	closeAttempt(firstAttempt, 'offline');
	requestReconnect('offline-change-1');
	requestReconnect('offline-change-2');
	requestReconnect('offline-change-3');
	const attemptsWhileOffline = beginAttempt();

	awake = false;
	timeline.push('sleep');
	online = true;
	requestReconnect('online-during-sleep');
	const attemptsWhileAsleep = beginAttempt();

	awake = true;
	timeline.push('wake');
	const recoveryAttempt = beginAttempt();
	const recovered = completeAttempt(recoveryAttempt);
	const staleCompletionAccepted = completeAttempt(firstAttempt);

	return Object.freeze({
		attemptsStarted: generation,
		attemptsWhileAsleep,
		attemptsWhileOffline,
		closedAttempts: Object.freeze([...closedAttempts]),
		connected,
		maxPendingReconnects,
		pendingReconnects,
		recovered,
		staleCompletionAccepted,
		timeline: Object.freeze(timeline),
	});
}

export { DEFAULT_PROFILE as SLEEP_NETWORK_PROFILE };
