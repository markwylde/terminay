/**
 * The fixed workflow step icons and the status glyphs a step without an icon
 * shows. Paths are 16x16, stroked with the current colour.
 */

import type { WorkflowIconName, WorkflowStepStatus } from '@terminay/client-core';
import {
	markerName,
	markerStyle,
	type WorkflowStatusGlyph,
} from './workflowPanelModel';

export const WORKFLOW_ICON_PATHS: Readonly<Record<WorkflowIconName, string>> =
	Object.freeze({
		lightbulb: 'M6 13h4M6.5 15h3M8 1.5a4.5 4.5 0 0 0-2.6 8.2c.4.3.6.8.6 1.3V12h4v-1c0-.5.2-1 .6-1.3A4.5 4.5 0 0 0 8 1.5Z',
		eye: 'M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8ZM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
		wrench: 'M10.5 1.8a3.5 3.5 0 0 0-3.9 4.7L2 11.1a1.4 1.4 0 0 0 2 2l4.6-4.6a3.5 3.5 0 0 0 4.7-3.9l-2 2-2-.5-.5-2 1.7-2.3Z',
		code: 'M5.5 4 1.5 8l4 4M10.5 4l4 4-4 4M9 2.5 7 13.5',
		flask: 'M6 1.5h4M6.5 1.5v4.2L2.6 12.4A1.4 1.4 0 0 0 3.8 14.5h8.4a1.4 1.4 0 0 0 1.2-2.1L9.5 5.7V1.5M4.5 10h7',
		archive: 'M1.5 2.5h13v3h-13zM2.5 5.5v8h11v-8M6 8.5h4',
		'pull-request': 'M4 2.5v11M4 2.5a1.5 1.5 0 1 0 0 0ZM12 13.5V6a2 2 0 0 0-2-2H7M8.5 2.5 7 4l1.5 1.5M4 13.5a1.5 1.5 0 1 0 0 0ZM12 13.5a1.5 1.5 0 1 0 0 0Z',
		terminal: 'M1.5 2.5h13v11h-13zM4 6l2.5 2L4 10M8 10.5h4',
		checklist: 'M2 3.5l1 1 2-2M2 8l1 1 2-2M2 12.5l1 1 2-2M7.5 3.5h7M7.5 8h7M7.5 12.5h7',
		bug: 'M5.5 4.5a2.5 2.5 0 0 1 5 0M4.5 6.5h7v4a3.5 3.5 0 0 1-7 0v-4ZM8 6.5v7.5M1.5 8.5h3M11.5 8.5h3M2 4.5l2.5 2M14 4.5l-2.5 2M2 13l2.6-1.5M14 13l-2.6-1.5',
		camera: 'M1.5 4.5h3l1.5-2h4l1.5 2h3v9h-13zM8 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
		flag: 'M3 14.5v-13M3 2h9l-2 3 2 3H3',
	});

const GLYPH_PATHS: Readonly<Record<Exclude<WorkflowStatusGlyph, 'none' | 'dot'>, string>> =
	Object.freeze({
		check: 'M3.5 8.5 6.5 11.5 12.5 4.5',
		cross: 'M4.5 4.5l7 7M11.5 4.5l-7 7',
		exclamation: 'M8 3v6.5M8 12.2v.3',
		dash: 'M4.5 8h7',
	});

export function WorkflowIcon({ name }: { readonly name: WorkflowIconName }) {
	return (
		<svg
			className="workflow-icon"
			viewBox="0 0 16 16"
			width="12"
			height="12"
			aria-hidden="true"
			focusable="false"
		>
			<path
				d={WORKFLOW_ICON_PATHS[name]}
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function StatusGlyph({ glyph }: { readonly glyph: WorkflowStatusGlyph }) {
	if (glyph === 'none') return null;
	return (
		<svg
			className="workflow-icon"
			viewBox="0 0 16 16"
			width="12"
			height="12"
			aria-hidden="true"
			focusable="false"
		>
			{glyph === 'dot' ? (
				<circle cx="8" cy="8" r="2.5" fill="currentColor" />
			) : (
				<path
					d={GLYPH_PATHS[glyph]}
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			)}
		</svg>
	);
}

/** One step's marker: its icon, or its status glyph, in its status's colour. */
export function WorkflowStepMarker({
	step,
	labelled = true,
}: {
	readonly step: {
		readonly title: string;
		readonly status: WorkflowStepStatus;
		readonly icon: WorkflowIconName | '';
	};
	/** False where a visible title beside the marker already names it. */
	readonly labelled?: boolean;
}) {
	const style = markerStyle(step.status);
	return (
		<span
			className={`workflow-marker workflow-marker--${style.tone}${
				style.filled ? ' workflow-marker--filled' : ''
			}`}
			data-status={step.status}
			{...(labelled
				? { role: 'img', 'aria-label': markerName(step) }
				: { 'aria-hidden': true })}
		>
			{step.icon === '' ? (
				<StatusGlyph glyph={style.glyph} />
			) : (
				<WorkflowIcon name={step.icon} />
			)}
		</span>
	);
}
