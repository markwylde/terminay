import { execRemote, type SshChannel, type SshClient } from "./transport.js";
import { SshProviderError } from "./errors.js";

const HELPER_COMMAND = "terminay-target-helper agent-journal-v1";
const MAX_RESPONSE_BYTES = 262_144;
const MAX_RECORDS = 32;

export interface AgentJournalRequest {
  readonly sessionId: string;
  readonly proof: string;
  readonly cursor: number;
  readonly maxRecords: number;
  readonly maxBytes: number;
}

/** Invoke the versioned target helper over the same authenticated SSH
 * connection as the PTY. The helper owns process-descendant/open-writer proof;
 * this extension accepts no cwd, title, or newest-file heuristic. */
export async function observeCodexJournal(client:SshClient,request:AgentJournalRequest,signal?:AbortSignal):Promise<{sessionId:string;cursor:number;records:Readonly<Record<string,unknown>>[]}>{
  validateRequest(request);
  const channel=await execRemote(client,HELPER_COMMAND);
  const response=collectBounded(channel,signal);
  channel.write(`${JSON.stringify({protocol:1,provider:"codex",...request})}\n`);
  channel.end();
  return validateResponse(await response,request);
}

function collectBounded(channel:SshChannel,signal?:AbortSignal):Promise<string>{return new Promise((resolve,reject)=>{
  const chunks:Buffer[]=[];let bytes=0;let settled=false;
  const finish=(callback:(value:any)=>void,value:any)=>{if(settled)return;settled=true;signal?.removeEventListener("abort",abort);callback(value);};
  const abort=()=>{try{channel.end();}finally{finish(reject,new SshProviderError("cancelled","Remote agent observation was cancelled"));}};
  signal?.addEventListener("abort",abort,{once:true});
  channel.on("data",(chunk)=>{if(settled)return;const part=Buffer.from(chunk);bytes+=part.length;if(bytes>MAX_RESPONSE_BYTES){try{channel.end();}finally{finish(reject,new SshProviderError("invalid-input","Target helper response exceeded its bound"));}return;}chunks.push(part);});
  channel.stderr?.on("data",()=>undefined);
  channel.once("close",(code)=>code===0||code===undefined?finish(resolve,Buffer.concat(chunks).toString("utf8")):finish(reject,new SshProviderError("unsupported","Compatible target agent helper is unavailable")));
});}

function validateRequest(request:AgentJournalRequest):void{
  if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(request.sessionId)||!/^[A-Za-z0-9_-]{32,128}$/u.test(request.proof)||!Number.isSafeInteger(request.cursor)||request.cursor<0||request.maxRecords!==MAX_RECORDS||request.maxBytes!==MAX_RESPONSE_BYTES)throw new SshProviderError("invalid-input","Remote agent journal request is invalid");
}
function validateResponse(text:string,request:AgentJournalRequest):{sessionId:string;cursor:number;records:Readonly<Record<string,unknown>>[]}{
  let value:unknown;try{value=JSON.parse(text);}catch{throw new SshProviderError("unsupported","Target helper returned an incompatible response");}
  if(!value||typeof value!=="object"||Array.isArray(value))throw new SshProviderError("unsupported","Target helper returned an incompatible response");const result=value as Record<string,unknown>;
  if(result.protocol!==1||result.provider!=="codex"||result.sessionId!==request.sessionId||result.proof!==request.proof||!Number.isSafeInteger(result.cursor)||(result.cursor as number)<request.cursor||!Array.isArray(result.records)||result.records.length>MAX_RECORDS)throw new SshProviderError("permission-denied","Target helper could not prove the exact terminal journal writer");
  let bytes=0;const records:Readonly<Record<string,unknown>>[]=[];for(const record of result.records){if(!record||typeof record!=="object"||Array.isArray(record))throw new SshProviderError("unsupported","Target helper returned an invalid journal record");const encoded=JSON.stringify(record);bytes+=Buffer.byteLength(encoded);if(bytes>MAX_RESPONSE_BYTES)throw new SshProviderError("invalid-input","Target helper journal batch exceeded its bound");records.push(Object.freeze({...record as Record<string,unknown>}));}
  return{sessionId:request.sessionId,cursor:result.cursor as number,records};
}
