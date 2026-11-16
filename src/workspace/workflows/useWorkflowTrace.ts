/**
 * Tracing a step's dependencies (ADR-0127): hovering or focusing a step, or
 * tapping it on a touch screen, highlights what it waits on and what waits on
 * it, and dims the rest. Shared by the vertical panel and the drawer.
 */

import type { WorkflowStep } from '@terminay/client-core';
import {
	type FocusEvent,
	type PointerEvent,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import { traceDependencies } from './workflowGraph';

export interface WorkflowTrace {
	/** The traced step and everything joined to it, or null when nothing is traced. */
	readonly lit: ReadonlySet<string> | null;
	/** Whether the edge from one step to a step that waits on it is on the traced path. */
	readonly edgeLit: (from: string, to: string) => boolean;
	/** Handlers for the element that stands for a step. */
	readonly bind: (id: string) => {
		readonly onPointerEnter: (event: PointerEvent) => void;
		readonly onPointerLeave: (event: PointerEvent) => void;
		readonly onPointerUp: (event: PointerEvent) => void;
		readonly onFocus: () => void;
		readonly onBlur: (event: FocusEvent) => void;
	};
}

export function useWorkflowTrace(
	steps: readonly Pick<WorkflowStep, 'id' | 'after'>[],
): WorkflowTrace {
	const [traced, setTraced] = useState<{ id: string; touch: boolean } | null>(null);
	const traceRef = useRef(traced);
	traceRef.current = traced;

	// A traced step that goes away clears the trace.
	const present = traced !== null && steps.some((step) => step.id === traced.id);
	const paths = useMemo(
		() => (present && traced !== null ? traceDependencies(steps, traced.id) : null),
		[present, traced, steps],
	);

	// A tap elsewhere ends a touch trace.
	useEffect(() => {
		if (traced?.touch !== true) return;
		const onDown = (event: globalThis.PointerEvent) => {
			const node = event.target;
			if (node instanceof Element && node.closest('[data-workflow-step-id]')) return;
			setTraced(null);
		};
		document.addEventListener('pointerdown', onDown, true);
		return () => document.removeEventListener('pointerdown', onDown, true);
	}, [traced?.touch]);

	const lit =
		paths === null || traced === null
			? null
			: new Set([traced.id, ...paths.upstream, ...paths.downstream]);

	const edgeLit = (from: string, to: string) => {
		if (paths === null || traced === null) return false;
		const id = traced.id;
		return (
			(paths.upstream.has(from) && (to === id || paths.upstream.has(to))) ||
			((from === id || paths.downstream.has(from)) && paths.downstream.has(to))
		);
	};

	const bind = (id: string) => ({
		onPointerEnter: (event: PointerEvent) => {
			if (event.pointerType === 'mouse' || event.pointerType === 'pen')
				setTraced({ id, touch: false });
		},
		onPointerLeave: (event: PointerEvent) => {
			if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
			if (traceRef.current?.id === id && traceRef.current.touch === false)
				setTraced(null);
		},
		onPointerUp: (event: PointerEvent) => {
			if (event.pointerType === 'touch') setTraced({ id, touch: true });
		},
		onFocus: () => {
			if (traceRef.current?.touch === true) return;
			setTraced({ id, touch: false });
		},
		onBlur: (event: FocusEvent) => {
			const next = event.relatedTarget;
			if (
				next instanceof Element &&
				next.closest(`[data-workflow-step-id]`)?.getAttribute('data-workflow-step-id') === id
			)
				return;
			if (traceRef.current?.id === id && traceRef.current.touch === false)
				setTraced(null);
		},
	});

	return { lit, edgeLit, bind };
}
