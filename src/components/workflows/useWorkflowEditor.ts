import type {
	WorkflowClient,
	WorkflowIconName,
	WorkflowTemplateState,
} from '@terminay/client-core';
import { WORKFLOW_CLIENT_LIMITS } from '@terminay/client-core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	moveMacroInLibrary,
	nextCategoryName,
	validCategoryName,
} from '../../shared/macroLibraryGroups';
import {
	type DraftStep,
	type DraftTemplate,
	describeSaveError,
	draftFrom,
	effectiveSteps,
	emptyStep,
	emptyTemplate,
	templateFingerprint,
	templateInput,
	templateProblems,
	type WorkflowDraft,
	withSteps,
} from './workflowLibraryModel';
import {
	addAlongside,
	addAtEnd,
	addThen,
	addTrack,
	moveBeforeInTrack,
	moveWithinTrack,
	type Outline,
	outlineKeys,
	removeStep as removeFromOutline,
} from './workflowOutlineModel';

const EMPTY_STATE: WorkflowTemplateState = Object.freeze({
	revision: -1,
	cursor: '',
	categories: [],
	templates: [],
});

/**
 * The selected server's workflow templates being edited, held as one
 * pending change set and saved together, as macros are. It lives as long
 * as Settings does, so leaving the category keeps every unsaved edit.
 */
export function useWorkflowEditor(client: WorkflowClient | undefined, active: boolean) {
	const [loaded, setLoaded] = useState<WorkflowTemplateState>(EMPTY_STATE);
	const [loadError, setLoadError] = useState<Error | null>(null);
	const [isLoading, setIsLoading] = useState(client !== undefined);
	const [base, setBase] = useState<WorkflowTemplateState>(EMPTY_STATE);
	const [draft, setDraft] = useState<WorkflowDraft>({ templates: [], categories: [] });
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [filter, setFilter] = useState('');
	const [isSaving, setIsSaving] = useState(false);
	const [errorText, setErrorText] = useState<string | null>(null);
	const [savedNotice, setSavedNotice] = useState(false);
	const focusNameFor = useRef<string | null>(null);

	// The selected server's templates, read again whenever they change there.
	useEffect(() => {
		setLoaded(EMPTY_STATE);
		setLoadError(null);
		if (client === undefined) {
			setIsLoading(false);
			return undefined;
		}
		setIsLoading(true);
		let disposed = false;
		const read = () =>
			client.templates().then(
				(state) => {
					if (disposed) return;
					setLoaded(state);
					setIsLoading(false);
					setLoadError(null);
				},
				(error: unknown) => {
					if (disposed) return;
					setIsLoading(false);
					setLoadError(error instanceof Error ? error : new Error(String(error)));
				},
			);
		let unsubscribe: (() => void) | undefined;
		try {
			unsubscribe = client.onTemplatesChanged(() => void read());
		} catch {
			// Without subscriptions the first read is all there is.
		}
		void read();
		return () => {
			disposed = true;
			unsubscribe?.();
		};
	}, [client]);

	const savedDraft = useMemo(() => draftFrom(base), [base]);
	const savedById = useMemo(
		() => new Map(savedDraft.templates.map((template) => [template.id, templateFingerprint(template)])),
		[savedDraft],
	);
	const unsavedIds = useMemo(
		() =>
			new Set(
				draft.templates
					.filter((template) => savedById.get(template.id) !== templateFingerprint(template))
					.map((template) => template.id),
			),
		[draft.templates, savedById],
	);
	const removedCount = savedDraft.templates.filter(
		(saved) => !draft.templates.some((template) => template.id === saved.id),
	).length;
	const unsavedCount = unsavedIds.size + removedCount;
	const orderChanged =
		savedDraft.templates.map((template) => template.id).join('\n') !==
		draft.templates.map((template) => template.id).join('\n');
	const categoriesChanged =
		JSON.stringify(savedDraft.categories) !== JSON.stringify(draft.categories);
	const isDirty = unsavedCount > 0 || orderChanged || categoriesChanged;
	const isDirtyRef = useRef(isDirty);
	isDirtyRef.current = isDirty;

	const adopt = useCallback((next: WorkflowTemplateState) => {
		setBase(next);
		const nextDraft = draftFrom(next);
		setDraft(nextDraft);
		setSelectedId((current) =>
			current !== null && nextDraft.templates.some((template) => template.id === current)
				? current
				: (nextDraft.templates[0]?.id ?? null),
		);
	}, []);

	/** The newest state known for this server. */
	const latest = useRef({ client, state: loaded });
	// The server's state arrived or changed. Unsaved edits are kept: the next
	// save is refused as stale, and Discard takes up the server's state.
	useEffect(() => {
		const known = latest.current;
		const serverChanged = known.client !== client;
		if (serverChanged || loaded.revision >= known.state.revision)
			latest.current = { client, state: loaded };
		if (serverChanged || !isDirtyRef.current) adopt(latest.current.state);
	}, [loaded, client, adopt]);

	const isReady = client !== undefined && !isLoading && loadError === null;
	const selected = useMemo(
		() => draft.templates.find((template) => template.id === selectedId) ?? null,
		[draft.templates, selectedId],
	);
	const problems = useMemo(() => draft.templates.flatMap(templateProblems), [draft.templates]);

	// While a save is in flight the draft is what was sent: an edit now would
	// be replaced by the saved state when it returns, so none is taken.
	const savingRef = useRef(false);
	const change = (update: (current: WorkflowDraft) => WorkflowDraft) => {
		if (savingRef.current) return;
		setSavedNotice(false);
		setDraft(update);
	};
	const updateTemplate = (id: string, update: (template: DraftTemplate) => DraftTemplate) =>
		change((current) => ({
			...current,
			templates: current.templates.map((template) => (template.id === id ? update(template) : template)),
		}));
	const updateSteps = (id: string, update: (steps: readonly DraftStep[]) => readonly DraftStep[]) =>
		updateTemplate(id, (template) => ({ ...template, steps: update(template.steps) }));
	/**
	 * A change to the outline's shape: the steps follow the outline's order,
	 * and from now on saving derives every step's dependencies (ADR-0128).
	 */
	const reshape = (
		id: string,
		update: (outline: Outline, template: DraftTemplate) => { outline: Outline; added?: DraftStep },
	) =>
		updateTemplate(id, (template) => {
			const { outline, added } = update(template.outline, template);
			if (outline === template.outline && added === undefined) return template;
			const byKey = new Map(
				[...template.steps, ...(added === undefined ? [] : [added])].map((step) => [step.key, step]),
			);
			const steps = outlineKeys(outline).flatMap((key) => {
				const step = byKey.get(key);
				return step === undefined ? [] : [step];
			});
			return { ...template, outline, steps, shapeChanged: true };
		});
	const withNewStep = (
		id: string,
		place: (outline: Outline, key: string) => Outline,
	) =>
		reshape(id, (outline, template) => {
			if (template.steps.length >= WORKFLOW_CLIENT_LIMITS.maxSteps) return { outline };
			const added = emptyStep(template.steps.length + 1);
			return { outline: place(outline, added.key), added };
		});

	const addTemplate = (category: string) => {
		if (!isReady) return;
		const template = emptyTemplate(
			draft.templates.length + 1,
			draft.categories.includes(category) ? category : '',
		);
		change((current) => ({ ...current, templates: [...current.templates, template] }));
		setFilter('');
		focusNameFor.current = template.id;
		setSelectedId(template.id);
	};

	const duplicateSelected = () => {
		if (selected === null) return;
		const copy: DraftTemplate = {
			...emptyTemplate(draft.templates.length + 1, selected.category),
			name: `${selected.name} copy`,
			description: selected.description,
			openingPrompt: selected.openingPrompt,
			outline: [],
			shapeChanged: false,
			steps: [],
		};
		// A copy's steps are new steps with keys of their own, waiting on the same steps.
		const source = effectiveSteps(selected);
		const keys = new Map(source.map((step) => [step.key, emptyStep(0).key]));
		const copied = withSteps(
			copy,
			source.map((step) => ({
				key: keys.get(step.key) as string,
				title: step.title,
				prompt: step.prompt,
				icon: step.icon,
				after: step.after.flatMap((key) => {
					const mapped = keys.get(key);
					return mapped === undefined ? [] : [mapped];
				}),
			})),
		);
		change((current) => {
			const templates = [...current.templates];
			templates.splice(templates.findIndex((template) => template.id === selected.id) + 1, 0, copied);
			return { ...current, templates };
		});
		setSelectedId(copied.id);
	};

	const deleteSelected = () => {
		if (selected === null) return;
		const index = draft.templates.findIndex((template) => template.id === selected.id);
		const remaining = draft.templates.filter((template) => template.id !== selected.id);
		change((current) => ({ ...current, templates: current.templates.filter((template) => template.id !== selected.id) }));
		setSelectedId((remaining[index] ?? remaining[index - 1])?.id ?? null);
	};

	/** "+ Add step at the end". */
	const addStep = (id: string) => withNewStep(id, addAtEnd);
	/** "+ then": a step directly after `key` in its track. */
	const addStepThen = (id: string, key: string) =>
		withNewStep(id, (outline, added) => addThen(outline, key, added));
	/** "+ alongside": a step that runs alongside `key`. */
	const addStepAlongside = (id: string, key: string) =>
		withNewStep(id, (outline, added) => addAlongside(outline, key, added));
	/** "+ another track alongside" on the bracket named by its first step. */
	const addStepTrack = (id: string, group: string) =>
		withNewStep(id, (outline, added) => addTrack(outline, group, added));
	const removeStep = (id: string, key: string) =>
		reshape(id, (outline) => ({ outline: removeFromOutline(outline, key) }));
	const updateStep = (id: string, key: string, update: Partial<Pick<DraftStep, 'title' | 'prompt'>> & { icon?: WorkflowIconName | '' }) =>
		updateSteps(id, (steps) => steps.map((step) => (step.key === key ? { ...step, ...update } : step)));
	/** Alt+Arrow on a handle: one place within its track. */
	const moveStep = (id: string, key: string, direction: -1 | 1) =>
		reshape(id, (outline) => ({ outline: moveWithinTrack(outline, key, direction) }));
	/** A drop: before another step of the same track, or at its end. */
	const moveStepBefore = (id: string, key: string, before: string | null) =>
		reshape(id, (outline) => ({ outline: moveBeforeInTrack(outline, key, before) }));

	const createCategory = (): string => {
		const name = nextCategoryName(draft.categories);
		change((current) => ({ ...current, categories: [...current.categories, name] }));
		return name;
	};
	const renameCategory = (category: string, proposed: string): boolean => {
		const name = validCategoryName(proposed, draft.categories, category);
		if (name === null) return false;
		if (name === category) return true;
		change((current) => ({
			categories: current.categories.map((existing) => (existing === category ? name : existing)),
			templates: current.templates.map((template) => (template.category === category ? { ...template, category: name } : template)),
		}));
		return true;
	};
	const removeCategory = (category: string) =>
		change((current) => ({
			categories: current.categories.filter((existing) => existing !== category),
			templates: current.templates.map((template) => (template.category === category ? { ...template, category: '' } : template)),
		}));
	const assignNewCategory = (proposed: string) => {
		if (selected === null) return;
		const trimmed = proposed.trim().replace(/\s+/g, ' ');
		if (trimmed.length === 0) return;
		const existing = draft.categories.find((name) => name.toLowerCase() === trimmed.toLowerCase());
		const name = existing ?? validCategoryName(trimmed, draft.categories);
		if (name === null) return;
		change((current) => ({
			categories: existing === undefined ? [...current.categories, name] : current.categories,
			templates: current.templates.map((template) => (template.id === selected.id ? { ...template, category: name } : template)),
		}));
	};
	const moveTemplate = (id: string, target: Parameters<typeof moveMacroInLibrary>[2]) =>
		change((current) => ({ ...current, templates: moveMacroInLibrary(current.templates, id, target, current.categories) }));
	const reorderTemplates = (orderedIds: readonly string[]) => {
		const byId = new Map(draft.templates.map((template) => [template.id, template]));
		const reordered = orderedIds.map((id) => byId.get(id)).filter((template): template is DraftTemplate => template !== undefined);
		if (reordered.length === draft.templates.length) change((current) => ({ ...current, templates: reordered }));
	};
	const reorderCategories = (categories: readonly string[]) =>
		change((current) => ({ ...current, categories: [...categories] }));

	/** Resolves true when the change set was stored, or there was none. */
	const save = useCallback(async (): Promise<boolean> => {
		if (!isDirtyRef.current) return true;
		if (isSaving || !isReady || client === undefined) return false;
		const refused = draft.templates.flatMap(templateProblems);
		if (refused.length > 0) {
			setErrorText(refused.join(' '));
			return false;
		}
		savingRef.current = true;
		setIsSaving(true);
		setErrorText(null);
		try {
			const saved = await client.replaceTemplates(
				draft.templates.map(templateInput),
				draft.categories,
				{ expectedRevision: base.revision },
			);
			latest.current = { client, state: saved };
			adopt(saved);
			setSavedNotice(true);
			return true;
		} catch (error) {
			setErrorText(describeSaveError(error));
			return false;
		} finally {
			savingRef.current = false;
			setIsSaving(false);
		}
	}, [adopt, base.revision, client, draft, isReady, isSaving]);

	const discard = useCallback(() => {
		setErrorText(null);
		setSavedNotice(false);
		adopt(latest.current.state);
	}, [adopt]);

	useEffect(() => {
		if (!active) return undefined;
		const onKeyDown = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 's') {
				event.preventDefault();
				void save();
			}
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [active, save]);

	const saveState = isSaving
		? 'Saving…'
		: unsavedCount > 0
			? `Unsaved changes in ${unsavedCount} ${unsavedCount === 1 ? 'workflow' : 'workflows'}`
			: orderChanged
				? 'Unsaved change to workflow order'
				: categoriesChanged
					? 'Unsaved category changes'
					: savedNotice
						? 'Saved'
						: 'All changes saved';

	return {
		draft,
		loadError,
		isReady,
		isSaving,
		isDirty,
		errorText,
		problems,
		saveState,
		unsavedIds,
		filter,
		setFilter,
		selected,
		selectedId,
		select: setSelectedId,
		focusNameFor,
		updateTemplate,
		addTemplate,
		duplicateSelected,
		deleteSelected,
		addStep,
		addStepThen,
		addStepAlongside,
		addStepTrack,
		removeStep,
		updateStep,
		moveStep,
		moveStepBefore,
		createCategory,
		renameCategory,
		removeCategory,
		assignNewCategory,
		moveTemplate,
		reorderTemplates,
		reorderCategories,
		save,
		discard,
	};
}

export type WorkflowEditor = ReturnType<typeof useWorkflowEditor>;
