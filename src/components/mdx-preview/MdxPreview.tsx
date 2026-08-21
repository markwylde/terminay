import { useEffect, useRef } from 'react';
import { DesktopPreviewHost, SandboxedWebPreviewHost, type PreviewHost } from './PreviewHost';
import { PreviewStorageBroker, type PreviewStorageSnapshot } from './PreviewStorageBroker';

export type MdxPreviewMessage =
	| { readonly version: 1; readonly kind: 'ready'; readonly runtimeId: string }
	| { readonly version: 1; readonly kind: 'resize'; readonly runtimeId: string; readonly height: number }
	| { readonly version: 1; readonly kind: 'diagnostic'; readonly runtimeId: string; readonly message: string }
	| { readonly version: 1; readonly kind: 'open-document'; readonly runtimeId: string; readonly path: string }
	| { readonly version: 1; readonly kind: 'open-external'; readonly runtimeId: string; readonly url: string }
	| { readonly version: 1; readonly kind: 'download'; readonly runtimeId: string; readonly url: string; readonly filename?: string }
	| { readonly version: 1; readonly kind: 'storage'; readonly runtimeId: string; readonly entries: Record<string, string>; readonly cookie: string };

/** The web PreviewHost fallback. It intentionally uses an opaque-origin,
 * script-only iframe. This is more restrictive than the eventual dedicated
 * preview origin (no persistent storage/downloads), never weakens isolation,
 * and gives callers a clear capability boundary while that host is unavailable. */
export function MdxPreview({ runtimeId, bundle, storageKey, onMessage }: { readonly runtimeId: string; readonly bundle: Uint8Array; readonly storageKey: string; readonly onMessage?: (message: MdxPreviewMessage) => void }) {
	const frame = useRef<HTMLIFrameElement>(null);
	useEffect(() => {
		const copied = new Uint8Array(bundle.byteLength);
		copied.set(bundle);
		const source = URL.createObjectURL(new Blob([copied.buffer], { type: 'text/javascript' }));
		let ready = false;
		const timeout = window.setTimeout(() => {
			if (ready) return;
			frame.current?.setAttribute('src', 'about:blank');
			onMessage?.({ version: 1, kind: 'diagnostic', runtimeId, message: 'Preview did not become ready. Restart it to try again.' });
		}, 10_000);
		const listener = (event: MessageEvent<unknown>) => {
			if (event.source !== frame.current?.contentWindow || !isMessage(event.data, runtimeId)) return;
			if (event.data.kind === 'ready') { ready = true; window.clearTimeout(timeout); }
			if (event.data.kind === 'storage') new PreviewStorageBroker(window.localStorage).persist(storageKey, event.data);
			onMessage?.(event.data);
		};
		window.addEventListener('message', listener);
		let host: PreviewHost | undefined;
		if (frame.current !== null) { frame.current.srcdoc = documentFor(runtimeId, source, new PreviewStorageBroker(window.localStorage).snapshot(storageKey)); host = window.terminayHost === undefined ? new SandboxedWebPreviewHost(frame.current) : new DesktopPreviewHost(frame.current); }
		return () => { window.clearTimeout(timeout); host?.destroy(); window.removeEventListener('message', listener); URL.revokeObjectURL(source); };
	}, [bundle, onMessage, runtimeId, storageKey]);
	return <iframe ref={frame} title="MDX preview" sandbox="allow-scripts" referrerPolicy="no-referrer" />;
}
function documentFor(runtimeId: string, source: string, storage: PreviewStorageSnapshot): string {
	const id = JSON.stringify(runtimeId);
	const url = JSON.stringify(source);
	const snapshot = JSON.stringify(storage);
	return `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; connect-src https: http:; img-src https: http: data: blob:; style-src 'unsafe-inline' https: http:; font-src https: http: data:; media-src https: http: blob:"><body><div id="root"></div><script>const id=${id};const send=(kind,value={})=>parent.postMessage({version:1,kind,runtimeId:id,...value},'*');const state=${snapshot};const values=Object.assign(Object.create(null),state.entries);const persist=()=>send('storage',{entries:values,cookie:state.cookie});const store={getItem:k=>Object.prototype.hasOwnProperty.call(values,String(k))?values[String(k)]:null,setItem:(k,v)=>{values[String(k)]=String(v);persist()},removeItem:k=>{delete values[String(k)];persist()},clear:()=>{for(const k in values)delete values[k];persist()},key:i=>Object.keys(values)[i]||null,get length(){return Object.keys(values).length}};try{Object.defineProperty(window,'localStorage',{value:store});Object.defineProperty(window,'sessionStorage',{value:store});Object.defineProperty(document,'cookie',{get:()=>state.cookie,set:v=>{state.cookie=String(v).slice(0,4096);persist()}})}catch(e){send('diagnostic',{message:'Preview storage is unavailable'})}window.open=()=>null;addEventListener('error',e=>send('diagnostic',{message:String(e.message).slice(0,1024)}));addEventListener('unhandledrejection',e=>send('diagnostic',{message:String(e.reason).slice(0,1024)}));addEventListener('resize',()=>send('resize',{height:Math.min(100000,document.documentElement.scrollHeight)}));addEventListener('submit',e=>{if(!e.defaultPrevented)e.preventDefault()},true);addEventListener('click',e=>{const a=e.target&&e.target.closest&&e.target.closest('a[href]');if(a&&!e.defaultPrevented){e.preventDefault();const href=a.getAttribute('href')||'';if(a.hasAttribute('download')&&/^https?:/i.test(href))send('download',{url:href,filename:(a.getAttribute('download')||'').slice(0,128)});else if(/\\.mdx?(?:#.*)?$/i.test(href))send('open-document',{path:href.split('#')[0]});else if(/^https?:/i.test(href))send('open-external',{url:href})}},true);const s=document.createElement('script');s.onload=()=>send('ready');s.onerror=()=>send('diagnostic',{message:'Preview bundle failed to load'});s.src=${url};document.body.append(s)</script>`;
}
function isMessage(value: unknown, runtimeId: string): value is MdxPreviewMessage { if (typeof value !== 'object' || value === null) return false; const item = value as Record<string, unknown>; return item.version === 1 && item.runtimeId === runtimeId && (item.kind === 'ready' || (item.kind === 'diagnostic' && typeof item.message === 'string') || (item.kind === 'open-document' && typeof item.path === 'string' && item.path.length > 0 && !item.path.startsWith('/') && !item.path.includes('..')) || (item.kind === 'open-external' && typeof item.url === 'string' && /^https?:/iu.test(item.url)) || (item.kind === 'download' && typeof item.url === 'string' && /^https?:/iu.test(item.url) && (item.filename === undefined || typeof item.filename === 'string')) || (item.kind === 'storage' && typeof item.cookie === 'string' && typeof item.entries === 'object' && item.entries !== null && !Array.isArray(item.entries) && Object.entries(item.entries).every(([key, value]) => key.length <= 256 && typeof value === 'string' && value.length <= 4096)) || (item.kind === 'resize' && Number.isFinite(item.height))); }
