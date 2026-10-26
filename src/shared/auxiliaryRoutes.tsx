import { createContext, type ReactNode, useContext, useMemo } from 'react';
import type {
	EditWindowState,
	ProjectEditWindowResult,
	TerminalEditWindowResult,
} from '../types/terminay';

export type AuxiliaryRouteRequest =
	| {
			readonly kind: 'settings';
			/** A category id, or a settings section that names its category. */
			readonly sectionId?: string;
			/** The item to select in a collection category. */
			readonly itemId?: string;
	  }
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
	openSettings: (sectionId?: string, itemId?: string) => Promise<void>;
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
		async openSettings(sectionId, itemId) {
			await requestInPage({
				kind: 'settings',
				...(sectionId === undefined ? {} : { sectionId }),
				...(itemId === undefined ? {} : { itemId }),
			});
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
