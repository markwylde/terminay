import type { PreviewStorageSnapshot } from './PreviewStorageBroker';

export type PreviewNavigation =
	| { readonly kind: 'fragment'; readonly hash: string }
	| { readonly kind: 'document'; readonly path: string }
	| { readonly kind: 'external'; readonly url: string }
	| { readonly kind: 'download'; readonly url: string; readonly filename?: string }
	| { readonly kind: 'blocked' };

export function classifyPreviewNavigation(
	href: string,
	download?: string | null,
): PreviewNavigation {
	if (typeof href !== 'string' || href.length === 0)
		return { kind: 'blocked' };
	if (href.startsWith('#')) return { kind: 'fragment', hash: href };
	if (/^https?:\/\//iu.test(href)) {
		if (typeof download === 'string')
			return { kind: 'download', url: href, filename: download };
		return { kind: 'external', url: href };
	}
	if (
		/^(?:javascript|data|file|blob|terminay):/iu.test(href) ||
		href.startsWith('/') ||
		href.includes('..')
	)
		return { kind: 'blocked' };
	if (/\.mdx?(?:[?#]|$)/iu.test(href)) {
		const path = href.replace(/[?#].*$/u, '');
		if (path.length === 0 || path.startsWith('.') || path.includes('..'))
			return { kind: 'blocked' };
		return { kind: 'document', path };
	}
	return { kind: 'blocked' };
}

export function previewGuestDocument(
	runtimeId: string,
	source: string,
	storage: PreviewStorageSnapshot,
): string {
	const id = JSON.stringify(runtimeId);
	const url = JSON.stringify(source);
	const snapshot = JSON.stringify(storage);
	return `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; connect-src https: http:; img-src https: http: data: blob:; style-src 'unsafe-inline' https: http:; font-src https: http: data:; media-src https: http: blob:"><body><div id="root"></div><script>
const id=${id};
const send=(kind,value={})=>parent.postMessage({version:1,kind,runtimeId:id,...value},'*');
const state=${snapshot};
const values=Object.assign(Object.create(null),state.entries);
const persist=()=>send('storage',{entries:values,cookie:state.cookie});
const store={
  getItem:k=>Object.prototype.hasOwnProperty.call(values,String(k))?values[String(k)]:null,
  setItem:(k,v)=>{values[String(k)]=String(v);persist()},
  removeItem:k=>{delete values[String(k)];persist()},
  clear:()=>{for (const key of Object.keys(values)) delete values[key];persist()},
  key:i=>Object.keys(values)[i]??null,
  get length(){return Object.keys(values).length}
};
Object.defineProperty(window,'localStorage',{configurable:false,value:store});
Object.defineProperty(window,'sessionStorage',{configurable:false,value:store});
Object.defineProperty(document,'cookie',{get:()=>state.cookie,set:(value)=>{state.cookie=String(value).slice(0,4096);persist()}});
window.open=function(){return null};
window.alert=function(){};
window.confirm=function(){return false};
window.prompt=function(){return null};
if (navigator.permissions) navigator.permissions.query=async()=>({state:'denied',onchange:null});
document.addEventListener('click',(event)=>{
  const link=event.target&&event.target.closest?event.target.closest('a[href]'):null;
  if (!link) return;
  const href=link.getAttribute('href')||'';
  if (href.startsWith('#')) return;
  event.preventDefault();
  if (/^https?:\\/\\//i.test(href)) {
    if (link.hasAttribute('download')) send('download',{url:href,filename:link.getAttribute('download')||undefined});
    else send('open-external',{url:href});
    return;
  }
  if (href.startsWith('/') || href.includes('..') || /^(javascript|data|file|blob):/i.test(href)) return;
  if (/\\.mdx?(?:[?#]|$)/i.test(href)) send('open-document',{path:href.replace(/[?#].*$/,'')});
},true);
document.addEventListener('submit',(event)=>{
  if (event.defaultPrevented) return;
  event.preventDefault();
},true);
window.addEventListener('beforeunload',(event)=>{event.preventDefault();event.returnValue='';});
const frame=document.createElement('iframe');
frame.addEventListener('load',()=>{try{frame.contentWindow.location.replace('about:blank')}catch{}});
send('ready');
const script=document.createElement('script');
script.src=${url};
script.type='text/javascript';
script.onerror=()=>send('diagnostic',{message:'Preview bundle failed to load.'});
document.body.append(script);
new ResizeObserver(()=>send('resize',{height:document.documentElement.scrollHeight||0})).observe(document.documentElement);
</script>`;
}
