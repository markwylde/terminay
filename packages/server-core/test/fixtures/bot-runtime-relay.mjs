import {PassThrough} from 'node:stream';
import {EventEmitter} from 'node:events';
/** Deterministic transport for scheduler tests. The bridge suite tests real Python framing. */
export function relayDriver(){const streams=new Map();return {async exec(_container,args){const ids=args[1]==='--kill-all'?[...streams.keys()]:[args[2]];for(const id of ids){streams.get(id)?.kill();streams.delete(id);}return '';},execStream(_container,args){const stream=new EventEmitter();stream.stdin=new PassThrough();stream.stdout=new PassThrough();stream.stderr=new PassThrough();stream.kill=()=>{stream.stdout.end();stream.stdin.destroy();stream.emit('close',0);};streams.set(args[1],stream);queueMicrotask(()=>stream.stdout.write('{"ready":true}\n'));return stream;}};}
