import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import type { TerminalActivityEvaluation } from '../terminalActivityStore';

type TerminalActivityControllerOptions = {
	acknowledgeAgent: (sessionId: string) => void;
	acknowledgeServerActivity?: (sessionId: string) => void;
	applyPanelState: (
		sessionId: string,
		state: TerminalActivityEvaluation['state'],
	) => boolean;
	deferredFlushMs: number;
	deferredSessionsRef: MutableRefObject<Set<string>>;
	deferredTimerRef: MutableRefObject<number | null>;
	evaluateRef: MutableRefObject<(sessionId: string, now?: number) => void>;
	getEvaluation: (
		sessionId: string,
		now: number,
	) => TerminalActivityEvaluation | null;
	isSashDraggingRef: MutableRefObject<boolean>;
	markLocalViewed: (sessionId: string) => TerminalActivityEvaluation;
	onOverviewChanged: () => void;
	timersRef: MutableRefObject<Map<string, number>>;
};

export function useTerminalActivityController({
	acknowledgeAgent,
	acknowledgeServerActivity,
	applyPanelState,
	deferredFlushMs,
	deferredSessionsRef,
	deferredTimerRef,
	evaluateRef,
	getEvaluation,
	isSashDraggingRef,
	markLocalViewed,
	onOverviewChanged,
	timersRef,
}: TerminalActivityControllerOptions) {
	const acknowledgeAgentRef = useRef(acknowledgeAgent);
	const acknowledgeServerActivityRef = useRef(acknowledgeServerActivity);
	const applyPanelStateRef = useRef(applyPanelState);
	const applyEvaluationRef = useRef<
		(sessionId: string, evaluation: TerminalActivityEvaluation) => void
	>(() => undefined);
	const getEvaluationRef = useRef(getEvaluation);
	const markLocalViewedRef = useRef(markLocalViewed);
	const onOverviewChangedRef = useRef(onOverviewChanged);
	acknowledgeAgentRef.current = acknowledgeAgent;
	acknowledgeServerActivityRef.current = acknowledgeServerActivity;
	applyPanelStateRef.current = applyPanelState;
	getEvaluationRef.current = getEvaluation;
	markLocalViewedRef.current = markLocalViewed;
	onOverviewChangedRef.current = onOverviewChanged;

	const applyEvaluation = useCallback(
		(sessionId: string, evaluation: TerminalActivityEvaluation) => {
			const changed = applyPanelStateRef.current(sessionId, evaluation.state);
			const existing = timersRef.current.get(sessionId);
			if (existing !== undefined) {
				window.clearTimeout(existing);
				timersRef.current.delete(sessionId);
			}
			const now = Date.now();
			if (evaluation.nextDeadline !== null && evaluation.nextDeadline > now) {
				const timer = window.setTimeout(
					() => {
						timersRef.current.delete(sessionId);
						evaluateRef.current(sessionId);
					},
					Math.max(0, evaluation.nextDeadline - now),
				);
				timersRef.current.set(sessionId, timer);
			}
			if (changed)
				window.requestAnimationFrame(() => onOverviewChangedRef.current());
		},
		[],
	);
	applyEvaluationRef.current = applyEvaluation;

	const evaluate = useCallback(
		(sessionId: string, now = Date.now()) => {
			const evaluation = getEvaluationRef.current(sessionId, now);
			if (evaluation !== null) applyEvaluation(sessionId, evaluation);
		},
		[applyEvaluation],
	);
	evaluateRef.current = evaluate;

	const clearDeferredTimer = useCallback(() => {
		if (deferredTimerRef.current === null) return;
		window.clearTimeout(deferredTimerRef.current);
		deferredTimerRef.current = null;
	}, []);

	const flushDeferred = useCallback(() => {
		if (isSashDraggingRef.current) return;
		clearDeferredTimer();
		const sessions = [...deferredSessionsRef.current];
		deferredSessionsRef.current.clear();
		for (const sessionId of sessions) evaluateRef.current(sessionId);
	}, [clearDeferredTimer, isSashDraggingRef]);

	const scheduleDeferredFlush = useCallback(() => {
		clearDeferredTimer();
		deferredTimerRef.current = window.setTimeout(
			flushDeferred,
			deferredFlushMs,
		);
	}, [clearDeferredTimer, deferredFlushMs, flushDeferred]);

	const markViewed = useCallback((sessionId: string | null) => {
		if (!sessionId) return;
		const acknowledgeServer = acknowledgeServerActivityRef.current;
		if (acknowledgeServer) acknowledgeServer(sessionId);
		else
			applyEvaluationRef.current(
				sessionId,
				markLocalViewedRef.current(sessionId),
			);
		acknowledgeAgentRef.current(sessionId);
	}, []);

	useEffect(
		() => () => {
			clearDeferredTimer();
			for (const timer of timersRef.current.values())
				window.clearTimeout(timer);
			timersRef.current.clear();
		},
		[clearDeferredTimer],
	);

	return {
		applyEvaluation,
		clearDeferredTimer,
		deferredSessionsRef,
		evaluate,
		flushDeferred,
		markViewed,
		scheduleDeferredFlush,
	};
}
