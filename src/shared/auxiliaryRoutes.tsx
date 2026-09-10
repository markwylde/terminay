import { createContext, type ReactNode, useContext, useMemo } from 'react';
import type {
	EditWindowState,
	ProjectEditWindowResult,
	TerminalEditWindowResult,
} from '../types/terminay';

export type AuxiliaryRouteRequest =
	| { readonly kind: 'settings'; readonly sectionId?: string }
	| { readonly kind: 'macros' }
	| { readonly kind: 'recordings' }
	| { readonly kind: 'remote-control' }
	| { readonly kind: 'performance-log' }
	| {
			readonly kind: 'edit-tab';
			readonly state: EditWindowState;
	  };

export type AuxiliaryRouteHandlerResult =
	| ProjectEditWindowResult
	| TerminalEditWindowResult
	| null
	| undefined;

export type AuxiliaryRouteRequestHandler = (
	request: AuxiliaryRouteRequest,
) => Promise<AuxiliaryRouteHandlerResult>;

export type AuxiliaryRouteController = Readonly<{
	openSettings: (sectionId?: string) => Promise<void>;
	openMacros: () => Promise<void>;
	openRecordings: () => Promise<void>;
	openRemoteControl: () => Promise<void>;
	openPerformanceLog: () => Promise<void>;
	editProjectTab: (
		state: Extract<EditWindowState, { readonly kind: 'project' }>,
	) => Promise<ProjectEditWindowResult | null>;
	editTerminalTab: (
		state: Extract<EditWindowState, { readonly kind: 'terminal' }>,
	) => Promise<TerminalEditWindowResult | null>;
}>;
export type AuxiliaryRouteControllerOptions = Readonly<{
	onRequest?: AuxiliaryRouteRequestHandler;
}>;

export function createAuxiliaryRouteController({
	onRequest,
}: AuxiliaryRouteControllerOptions = {}): AuxiliaryRouteController {
	const requestInPage = async (
		request: AuxiliaryRouteRequest,
	): Promise<AuxiliaryRouteHandlerResult> => {
		if (onRequest === undefined) {
			return request.kind === 'edit-tab' ? null : undefined;
		}
		return onRequest(request);
	};

	return Object.freeze({
		async openSettings(sectionId) {
			await requestInPage({ kind: 'settings', sectionId });
		},
		async openMacros() {
			await requestInPage({ kind: 'macros' });
		},
		async openRecordings() {
			await requestInPage({ kind: 'recordings' });
		},
		async openRemoteControl() {
			await requestInPage({ kind: 'remote-control' });
		},
		async openPerformanceLog() {
			await requestInPage({ kind: 'performance-log' });
		},
		async editProjectTab(state) {
			const result = await requestInPage({ kind: 'edit-tab', state });
			return (result ?? null) as ProjectEditWindowResult | null;
		},
		async editTerminalTab(state) {
			const result = await requestInPage({ kind: 'edit-tab', state });
			return (result ?? null) as TerminalEditWindowResult | null;
		},
	});
}

const AuxiliaryRouteControllerContext =
	createContext<AuxiliaryRouteController | null>(null);

export function AuxiliaryRouteControllerProvider({
	children,
	controller,
}: Readonly<{
	children: ReactNode;
	controller: AuxiliaryRouteController;
}>) {
	return (
		<AuxiliaryRouteControllerContext.Provider value={controller}>
			{children}
		</AuxiliaryRouteControllerContext.Provider>
	);
}

export function useAuxiliaryRouteController(): AuxiliaryRouteController {
	const controller = useContext(AuxiliaryRouteControllerContext);
	return useMemo(
		() => controller ?? createAuxiliaryRouteController(),
		[controller],
	);
}
