/**
 * The view replica (ADR-0039). This file is bundled with `rrweb-snapshot` into
 * one script and is the only script of a mirror document. It turns the document
 * it runs in into a copy of the recorded view and keeps it up to date.
 *
 * rrweb's own replayer draws into a same-origin child frame. A mirror runs in
 * an opaque origin (ADR-0038), where a document cannot reach into any frame, so
 * the replica draws into its own document instead. What keeps recorded content
 * inert is the mirror document's content security policy, which allows this one
 * script by nonce and nothing else; `rrweb-snapshot` additionally rebuilds
 * `script` elements as `noscript`.
 */
import { type BuildCache, buildNodeWithSN, createCache, createMirror, type Mirror } from 'rrweb-snapshot';
import { MIRROR_MESSAGE_KEY, type MirrorReplicaControl, type MirrorReplicaReport } from './mirrorProtocol.ts';

// rrweb's wire format, as far as the replica reads it.
const FULL_SNAPSHOT = 2;
const INCREMENTAL = 3;
const META = 4;
const SOURCE_MUTATION = 0;
const SOURCE_MOUSE_MOVE = 1;
const SOURCE_SCROLL = 3;
const SOURCE_VIEWPORT_RESIZE = 4;
const SOURCE_INPUT = 5;
const SOURCE_TOUCH_MOVE = 6;
const SOURCE_STYLE_SHEET_RULE = 8;
const SOURCE_STYLE_DECLARATION = 13;
const NODE_ELEMENT = 2;

type SerializedNode = Parameters<typeof buildNodeWithSN>[0];
type Json = Record<string, unknown>;

interface AddedNode {
	readonly parentId: number;
	readonly nextId: number | null;
	readonly node: SerializedNode;
}

(() => {
	let mirror: Mirror = createMirror();
	let cache: BuildCache = createCache();
	let viewport = { width: 0, height: 0 };
	let pointer: HTMLElement | undefined;

	const report = (message: MirrorReplicaReport): void =>
		parent.postMessage({ [MIRROR_MESSAGE_KEY]: message }, '*');

	const reportSize = (): void =>
		report({
			type: 'size',
			width: viewport.width,
			height: viewport.height,
			contentHeight: document.documentElement?.scrollHeight ?? 0,
		});

	const build = (node: SerializedNode, skipChild: boolean): Node | null =>
		buildNodeWithSN(node, { doc: document, mirror, skipChild, hackCss: true, cache });

	function snapshot(data: Json): void {
		const root = data.node as SerializedNode & { childNodes?: SerializedNode[] };
		mirror = createMirror();
		cache = createCache();
		pointer = undefined;
		const html = (root.childNodes ?? []).find((child) => child.type === NODE_ELEMENT);
		if (html === undefined) throw new Error('snapshot has no document element');
		const element = build(html, false);
		if (element === null) throw new Error('snapshot could not be rebuilt');
		mirror.add(document, root);
		if (document.documentElement === null) document.appendChild(element);
		else document.replaceChild(element, document.documentElement);
		const offset = data.initialOffset as { left?: number; top?: number } | undefined;
		scrollTo(offset?.left ?? 0, offset?.top ?? 0);
	}

	function insert(add: AddedNode): boolean {
		const parentNode = mirror.getNode(add.parentId);
		if (parentNode === null) return false;
		const next = add.nextId === null || add.nextId === -1 ? null : mirror.getNode(add.nextId);
		if (add.nextId !== null && add.nextId !== -1 && next === null) return false;
		// The document's only child is its element; replace it instead of adding a second.
		if (parentNode === document) {
			const element = build(add.node, false);
			if (element !== null && add.node.type === NODE_ELEMENT) {
				if (document.documentElement === null) document.appendChild(element);
				else document.replaceChild(element, document.documentElement);
				pointer = undefined;
			}
			return true;
		}
		const node = build(add.node, false);
		if (node === null) return true;
		const target =
			(add.node as { isShadow?: boolean }).isShadow === true && (parentNode as Element).shadowRoot
				? ((parentNode as Element).shadowRoot as ShadowRoot)
				: parentNode;
		target.insertBefore(node, next !== null && next.parentNode === target ? next : null);
		return true;
	}

	function mutate(data: Json): void {
		for (const removal of (data.removes as { id: number; parentId: number }[] | undefined) ?? []) {
			const node = mirror.getNode(removal.id);
			if (node === null) continue;
			node.parentNode?.removeChild(node);
			mirror.removeNodeFromMap(node);
		}
		// An added node can name a sibling that is added later in the same list.
		let waiting = [...((data.adds as AddedNode[] | undefined) ?? [])];
		while (waiting.length > 0) {
			const blocked = waiting.filter((add) => !insert(add));
			if (blocked.length === waiting.length) throw new Error('added nodes could not be placed');
			waiting = blocked;
		}
		for (const text of (data.texts as { id: number; value: string | null }[] | undefined) ?? []) {
			const node = mirror.getNode(text.id);
			if (node !== null) node.textContent = text.value;
		}
		for (const change of (data.attributes as { id: number; attributes: Json }[] | undefined) ?? []) {
			const node = mirror.getNode(change.id);
			if (!(node instanceof Element)) continue;
			for (const [name, value] of Object.entries(change.attributes)) attribute(node, name, value);
		}
	}

	function attribute(node: Element, name: string, value: unknown): void {
		if (name.startsWith('on') || name.startsWith('rr_')) return;
		try {
			if (value === null) node.removeAttribute(name);
			else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
				node.setAttribute(name, String(value));
			else if (name === 'style' && typeof value === 'object') {
				const style = (node as HTMLElement).style;
				for (const [property, next] of Object.entries(value as Json)) {
					if (next === false) style.removeProperty(property);
					else if (Array.isArray(next)) style.setProperty(property, String(next[0]), String(next[1] ?? ''));
					else style.setProperty(property, String(next));
				}
			}
		} catch {
			// A name the DOM refuses is not worth losing the mirror over.
		}
	}

	function input(data: Json): void {
		const node = mirror.getNode(data.id as number);
		if (node instanceof HTMLInputElement && (node.type === 'checkbox' || node.type === 'radio'))
			node.checked = data.isChecked === true;
		else if (
			node instanceof HTMLInputElement ||
			node instanceof HTMLTextAreaElement ||
			node instanceof HTMLSelectElement
		)
			node.value = String(data.text ?? '');
	}

	function scroll(data: Json): void {
		const node = mirror.getNode(data.id as number);
		const x = Number(data.x) || 0;
		const y = Number(data.y) || 0;
		if (node === document || node === document.documentElement) scrollTo(x, y);
		else if (node instanceof Element) node.scrollTo(x, y);
	}

	function movePointer(data: Json): void {
		const positions = data.positions as { x: number; y: number }[] | undefined;
		const last = positions?.[positions.length - 1];
		if (last === undefined || document.documentElement === null) return;
		if (pointer === undefined || !pointer.isConnected) {
			pointer = document.createElement('div');
			pointer.setAttribute('aria-hidden', 'true');
			pointer.style.cssText =
				'position:fixed;left:0;top:0;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;' +
				'background:rgba(255,80,60,.75);box-shadow:0 0 0 2px rgba(255,255,255,.9);' +
				'pointer-events:none;z-index:2147483647;transition:transform 50ms linear';
			document.documentElement.appendChild(pointer);
		}
		pointer.style.transform = `translate(${last.x}px, ${last.y}px)`;
	}

	function sheetOf(data: Json): CSSStyleSheet | null {
		const node = typeof data.id === 'number' ? mirror.getNode(data.id) : null;
		return node instanceof HTMLStyleElement || node instanceof HTMLLinkElement ? node.sheet : null;
	}

	function styleSheetRule(data: Json): void {
		const sheet = sheetOf(data);
		if (sheet === null) return;
		for (const removal of (data.removes as { index: number | number[] }[] | undefined) ?? [])
			if (typeof removal.index === 'number') sheet.deleteRule(removal.index);
		for (const add of (data.adds as { rule: string; index?: number | number[] }[] | undefined) ?? [])
			sheet.insertRule(add.rule, typeof add.index === 'number' ? add.index : sheet.cssRules.length);
	}

	function styleDeclaration(data: Json): void {
		const sheet = sheetOf(data);
		const index = data.index as number[] | undefined;
		if (sheet === null || index === undefined || index.length !== 1) return;
		const rule = sheet.cssRules[index[0] as number];
		if (!(rule instanceof CSSStyleRule)) return;
		const set = data.set as { property: string; value: string; priority?: string } | undefined;
		const remove = data.remove as { property: string } | undefined;
		if (set !== undefined) rule.style.setProperty(set.property, set.value, set.priority ?? '');
		if (remove !== undefined) rule.style.removeProperty(remove.property);
	}

	function apply(event: { type: number; data: Json }): void {
		if (event.type === META) {
			viewport = { width: Number(event.data.width) || 0, height: Number(event.data.height) || 0 };
			return;
		}
		if (event.type === FULL_SNAPSHOT) {
			snapshot(event.data);
			return;
		}
		if (event.type !== INCREMENTAL) return;
		const source = event.data.source;
		if (source === SOURCE_MUTATION) mutate(event.data);
		else if (source === SOURCE_INPUT) input(event.data);
		else if (source === SOURCE_SCROLL) scroll(event.data);
		else if (source === SOURCE_MOUSE_MOVE || source === SOURCE_TOUCH_MOVE) movePointer(event.data);
		else if (source === SOURCE_VIEWPORT_RESIZE)
			viewport = { width: Number(event.data.width) || 0, height: Number(event.data.height) || 0 };
		else if (source === SOURCE_STYLE_SHEET_RULE) {
			try {
				styleSheetRule(event.data);
			} catch {
				// A rule this browser cannot parse leaves the mirror slightly off, not broken.
			}
		} else if (source === SOURCE_STYLE_DECLARATION) styleDeclaration(event.data);
	}

	addEventListener('message', (message) => {
		if (message.source !== parent) return;
		const control = (message.data as Record<string, MirrorReplicaControl> | null)?.[MIRROR_MESSAGE_KEY];
		if (typeof control !== 'object' || control === null || control.type !== 'apply') return;
		try {
			for (const event of JSON.parse(control.data) as { type: number; data: Json }[]) apply(event);
			reportSize();
		} catch {
			report({ type: 'failed' });
		}
	});

	report({ type: 'ready' });
})();
